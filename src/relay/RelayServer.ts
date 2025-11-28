/**
 * RelayServer
 *
 * WebSocket server using Bun.serve for NIP-01 relay protocol.
 * Wires together EventStore, SubscriptionManager, and MessageHandler.
 */
import { Context, Effect, Layer, Runtime } from "effect"
import { MessageHandler, type BroadcastMessage } from "./MessageHandler.js"
import { SubscriptionManager } from "./SubscriptionManager.js"
import type { RelayMessage } from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

export interface RelayConfig {
  readonly port: number
  readonly host?: string
  readonly dbPath?: string
}

export interface ConnectionData {
  readonly connectionId: string
}

// =============================================================================
// Service Interface
// =============================================================================

export interface RelayServer {
  readonly _tag: "RelayServer"

  /**
   * Start the relay server
   */
  start(config: RelayConfig): Effect.Effect<RelayHandle>

  /**
   * Get connection count
   */
  connectionCount(): Effect.Effect<number>
}

export interface RelayHandle {
  readonly port: number
  readonly stop: () => Effect.Effect<void>
}

// =============================================================================
// Service Tag
// =============================================================================

export const RelayServer = Context.GenericTag<RelayServer>("RelayServer")

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const messageHandler = yield* MessageHandler
  const subscriptionManager = yield* SubscriptionManager

  // Connection ID generation (encapsulated, not global)
  let connectionCounter = 0
  const generateConnectionId = (): string => {
    connectionCounter++
    return `conn_${Date.now()}_${connectionCounter}`
  }

  // Track active WebSocket connections for broadcasting
  const connections = new Map<string, { ws: unknown; send: (msg: string) => void }>()

  const sendToConnection = (connectionId: string, message: RelayMessage): void => {
    const conn = connections.get(connectionId)
    if (conn) {
      conn.send(JSON.stringify(message))
    }
  }

  const broadcastEvent = (broadcasts: readonly BroadcastMessage[]): void => {
    for (const broadcast of broadcasts) {
      const message: RelayMessage = [
        "EVENT",
        broadcast.subscriptionId,
        broadcast.event,
      ] as RelayMessage
      sendToConnection(broadcast.connectionId, message)
    }
  }

  const start: RelayServer["start"] = (config) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>()
      const runSync = Runtime.runSync(runtime)

      // Start Bun WebSocket server
      const server = Bun.serve({
        port: config.port,
        hostname: config.host ?? "0.0.0.0",

        fetch(req, server) {
          // Upgrade HTTP to WebSocket
          const url = new URL(req.url)

          // NIP-11: Return relay info for HTTP GET /
          if (req.method === "GET" && url.pathname === "/" && !req.headers.get("upgrade")) {
            const accept = req.headers.get("accept") ?? ""
            if (accept.includes("application/nostr+json")) {
              return new Response(
                JSON.stringify({
                  name: "nostr-effect relay",
                  description: "Effect-based Nostr relay",
                  supported_nips: [1],
                  software: "nostr-effect",
                  version: "0.0.1",
                }),
                {
                  headers: {
                    "Content-Type": "application/nostr+json",
                    "Access-Control-Allow-Origin": "*",
                  },
                }
              )
            }
          }

          // Upgrade WebSocket
          const connectionId = generateConnectionId()
          const success = server.upgrade(req, {
            data: { connectionId } satisfies ConnectionData,
          })

          if (success) {
            return undefined
          }

          return new Response("WebSocket upgrade failed", { status: 400 })
        },

        websocket: {
          open(ws) {
            const data = ws.data as ConnectionData
            connections.set(data.connectionId, {
              ws,
              send: (msg: string) => ws.send(msg),
            })
          },

          message(ws, message) {
            const data = ws.data as ConnectionData
            const raw = typeof message === "string" ? message : message.toString()

            // Handle message using Effect runtime
            const result = runSync(
              messageHandler.handleRaw(data.connectionId, raw).pipe(
                Effect.catchAll((error) =>
                  Effect.succeed({
                    responses: [["NOTICE", `error: ${error.message}`] as RelayMessage],
                    broadcasts: [],
                  })
                )
              )
            )

            // Send responses to this connection
            for (const response of result.responses) {
              ws.send(JSON.stringify(response))
            }

            // Broadcast to other connections
            broadcastEvent(result.broadcasts)
          },

          close(ws) {
            const data = ws.data as ConnectionData

            // Clean up subscriptions
            runSync(subscriptionManager.removeConnection(data.connectionId))

            // Remove from connection map
            connections.delete(data.connectionId)
          },

          drain(_ws) {
            // Handle backpressure - optional
          },
        },
      })

      return {
        port: server.port,
        stop: () =>
          Effect.sync(() => {
            server.stop()
            connections.clear()
          }),
      }
    })

  const connectionCount: RelayServer["connectionCount"] = () =>
    Effect.sync(() => connections.size)

  return {
    _tag: "RelayServer" as const,
    start,
    connectionCount,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

export const RelayServerLive = Layer.effect(RelayServer, make)
