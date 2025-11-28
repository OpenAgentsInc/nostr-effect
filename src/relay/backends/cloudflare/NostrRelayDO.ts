/**
 * NostrRelayDO - Durable Object for Nostr Relay
 *
 * Implements a NIP-01 compliant relay using Cloudflare Durable Objects.
 * Uses WebSocket Hibernation API for efficient idle connection handling.
 */
/// <reference types="@cloudflare/workers-types" />

import { Effect, Layer, Runtime, pipe } from "effect"
import { DoSqliteStoreLive, initDoSchema, type SqlStorage } from "./DoSqliteStore.js"
import { MessageHandler, MessageHandlerLive } from "../../core/MessageHandler.js"
import { SubscriptionManager, SubscriptionManagerLive } from "../../core/SubscriptionManager.js"
import { PolicyPipelineLive } from "../../core/policy/PolicyPipeline.js"
import { mergeRelayInfo, type RelayInfo } from "../../core/RelayInfo.js"
import { EventServiceLive } from "../../../services/EventService.js"
import { CryptoServiceLive } from "../../../services/CryptoService.js"
import type { RelayMessage } from "../../../core/Schema.js"
import type { BroadcastMessage } from "../../core/MessageHandler.js"

// =============================================================================
// Types
// =============================================================================

export interface Env {
  NOSTR_RELAY: DurableObjectNamespace
  // Optional relay configuration via environment variables
  RELAY_NAME?: string
  RELAY_DESCRIPTION?: string
  RELAY_PUBKEY?: string
  RELAY_CONTACT?: string
}

// =============================================================================
// Durable Object Class
// =============================================================================

export class NostrRelayDO implements DurableObject {
  private readonly sql: SqlStorage
  private readonly relayInfo: RelayInfo
  private readonly layers: Layer.Layer<MessageHandler | SubscriptionManager>
  private runtime: Runtime.Runtime<MessageHandler | SubscriptionManager> | null = null

  // Connection counter for generating unique IDs
  private connectionCounter = 0

  constructor(
    private readonly state: DurableObjectState,
    env: Env
  ) {
    // Get SQL storage from DO state
    this.sql = state.storage.sql as SqlStorage

    // Initialize schema on first construction
    initDoSchema(this.sql)

    // Build relay info from environment
    this.relayInfo = mergeRelayInfo({
      name: env.RELAY_NAME ?? "nostr-effect relay (Cloudflare)",
      description: env.RELAY_DESCRIPTION ?? "A Nostr relay running on Cloudflare Durable Objects",
      pubkey: env.RELAY_PUBKEY,
      contact: env.RELAY_CONTACT,
    })

    // Build Effect layer stack
    this.layers = pipe(
      MessageHandlerLive,
      Layer.provideMerge(SubscriptionManagerLive),
      Layer.provide(PolicyPipelineLive),
      Layer.provide(DoSqliteStoreLive(this.sql)),
      Layer.provide(EventServiceLive),
      Layer.provide(CryptoServiceLive)
    )
  }

  /**
   * Get or create the Effect runtime
   */
  private getRuntime(): Runtime.Runtime<MessageHandler | SubscriptionManager> {
    if (!this.runtime) {
      this.runtime = Effect.runSync(
        Layer.toRuntime(this.layers).pipe(Effect.scoped)
      )
    }
    return this.runtime
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    this.connectionCounter++
    return `conn_${Date.now()}_${this.connectionCounter}`
  }

  /**
   * Get connection ID from WebSocket tags
   */
  private getConnectionId(ws: WebSocket): string | undefined {
    const tags = this.state.getTags(ws)
    return tags[0] // Connection ID is stored as the first tag
  }

  /**
   * Get WebSocket by connection ID
   */
  private getWebSocketByConnectionId(connectionId: string): WebSocket | undefined {
    const sockets = this.state.getWebSockets(connectionId)
    return sockets[0]
  }

  /**
   * Handle incoming HTTP requests
   * - WebSocket upgrade for relay protocol
   * - HTTP GET for NIP-11 relay info
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: this.corsHeaders(),
      })
    }

    // NIP-11: Return relay info for HTTP GET /
    if (
      request.method === "GET" &&
      url.pathname === "/" &&
      !request.headers.get("upgrade")
    ) {
      const accept = request.headers.get("accept") ?? ""
      if (accept.includes("application/nostr+json")) {
        return new Response(JSON.stringify(this.relayInfo), {
          headers: {
            "Content-Type": "application/nostr+json",
            ...this.corsHeaders(),
          },
        })
      }
      // Return simple text for browsers
      return new Response(`${this.relayInfo.name}\n\nConnect via WebSocket for Nostr relay`, {
        headers: { "Content-Type": "text/plain" },
      })
    }

    // WebSocket upgrade
    if (request.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]

      const connectionId = this.generateConnectionId()

      // Accept the WebSocket with hibernation support
      // Use connection ID as a tag to retrieve it later
      this.state.acceptWebSocket(server, [connectionId])

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    return new Response("Expected WebSocket or application/nostr+json request", {
      status: 400,
    })
  }

  /**
   * WebSocket message handler (Hibernation API)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const connectionId = this.getConnectionId(ws)
    if (!connectionId) {
      ws.close(1011, "Unknown connection")
      return
    }

    const raw = typeof message === "string" ? message : new TextDecoder().decode(message)

    try {
      const runtime = this.getRuntime()
      const result = await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const handler = yield* MessageHandler
          return yield* handler.handleRaw(connectionId, raw)
        }).pipe(
          Effect.catchAll((error) =>
            Effect.succeed({
              responses: [["NOTICE", `error: ${error.message}`] as RelayMessage],
              broadcasts: [] as readonly BroadcastMessage[],
            })
          )
        )
      )

      // Send responses to this connection
      for (const response of result.responses) {
        ws.send(JSON.stringify(response))
      }

      // Broadcast to matching subscriptions
      this.broadcastEvents(result.broadcasts)
    } catch (error) {
      ws.send(JSON.stringify(["NOTICE", `internal error: ${(error as Error).message}`]))
    }
  }

  /**
   * WebSocket close handler (Hibernation API)
   */
  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    const connectionId = this.getConnectionId(ws)
    if (!connectionId) return

    // Clean up subscriptions
    try {
      const runtime = this.getRuntime()
      await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const subManager = yield* SubscriptionManager
          yield* subManager.removeConnection(connectionId)
        })
      )
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * WebSocket error handler (Hibernation API)
   */
  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error("WebSocket error:", error)
  }

  /**
   * Broadcast events to matching subscriptions
   */
  private broadcastEvents(broadcasts: readonly BroadcastMessage[]): void {
    for (const broadcast of broadcasts) {
      const ws = this.getWebSocketByConnectionId(broadcast.connectionId)
      if (ws) {
        const message: RelayMessage = [
          "EVENT",
          broadcast.subscriptionId,
          broadcast.event,
        ] as RelayMessage
        try {
          ws.send(JSON.stringify(message))
        } catch {
          // Connection may have closed, hibernation API handles cleanup
        }
      }
    }
  }

  /**
   * CORS headers for NIP-11 compliance
   */
  private corsHeaders(): Record<string, string> {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    }
  }
}
