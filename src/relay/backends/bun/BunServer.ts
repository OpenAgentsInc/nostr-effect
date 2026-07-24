/**
 * BunServer
 *
 * Thin Bun.serve adapter for the platform-agnostic RelayServer contract.
 * Wires together EventStore, SubscriptionManager, and MessageHandler.
 */
import { Effect, Layer } from "effect"
import { MessageHandler, type BroadcastMessage } from "../../core/MessageHandler.js"
import {
  RelayServer,
  type ConnectionData,
} from "../../core/RelayServer.js"
import { SubscriptionManager } from "../../core/SubscriptionManager.js"
import type { RelayMessage } from "../../../core/Schema.js"
import { type RelayInfo, defaultRelayInfo, mergeRelayInfo } from "../../core/RelayInfo.js"
import { Nip86AdminService } from "../../core/admin/Nip86AdminService.js"
import { unpackEventFromToken, validateEventFull, HTTP_AUTH_KIND } from "../../../core/Nip98.js"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"

export type {
  ConnectionData,
  LivekitConfig,
  RelayConfig,
  RelayHandle,
} from "../../core/RelayServer.js"
export { RelayServer } from "../../core/RelayServer.js"

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const messageHandler = yield* MessageHandler
  const admin = yield* Nip86AdminService
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
      // Build relay info from config
      const relayInfo = config.relayInfo
        ? mergeRelayInfo(config.relayInfo)
        : defaultRelayInfo
      // Mutable overlay for NIP-86 changes
      let currentRelayInfo: Partial<RelayInfo> = { ...relayInfo }

      // CORS headers for NIP-11 / NIP-29 LiveKit
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      }

      const livekit = config.livekit

      // Start Bun WebSocket server
      const server = Bun.serve({
        port: config.port,
        hostname: config.host ?? "0.0.0.0",

        async fetch(req, server) {
          // Upgrade HTTP to WebSocket
          const url = new URL(req.url)

          // CORS preflight
          if (req.method === "OPTIONS") {
            return new Response(null, {
              status: 204,
              headers: corsHeaders,
            })
          }

          // NIP-29 LiveKit: capability probe (204 = supported)
          if (
            req.method === "GET" &&
            url.pathname === "/.well-known/nip29/livekit" &&
            !req.headers.get("upgrade")
          ) {
            if (!livekit) {
              return new Response("LiveKit not configured", { status: 404, headers: corsHeaders })
            }
            return new Response(null, { status: 204, headers: corsHeaders })
          }

          // NIP-29 LiveKit: token endpoint for group (NIP-98 auth required)
          const livekitGroupMatch = url.pathname.match(
            /^\/\.well-known\/nip29\/livekit\/([^/]+)\/?$/
          )
          if (req.method === "GET" && livekitGroupMatch && !req.headers.get("upgrade")) {
            if (!livekit) {
              return new Response(JSON.stringify({ error: "livekit not configured" }), {
                status: 404,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              })
            }
            const groupId = decodeURIComponent(livekitGroupMatch[1]!)
            const auth = req.headers.get("authorization") ?? ""
            if (!auth) {
              return new Response("Unauthorized", { status: 401, headers: corsHeaders })
            }
            try {
              const event = await unpackEventFromToken(auth)
              if (Number(event.kind) !== Number(HTTP_AUTH_KIND)) {
                return new Response("Unauthorized", { status: 401, headers: corsHeaders })
              }
              const expectedUrl = `${url.origin}/.well-known/nip29/livekit/${encodeURIComponent(groupId)}`
              await validateEventFull(event, expectedUrl, "get")
              const token = mintLivekitJwt({
                pubkey: event.pubkey,
                groupId,
                secret: livekit.jwtSecret ?? "nostr-effect-dev-livekit",
                ttlSeconds: livekit.tokenTtlSeconds ?? 3600,
              })
              return new Response(
                JSON.stringify({ token, url: livekit.url, room: groupId }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json", ...corsHeaders },
                }
              )
            } catch {
              return new Response("Unauthorized", { status: 401, headers: corsHeaders })
            }
          }

          // NIP-11: Return relay info for HTTP GET /
          if (req.method === "GET" && url.pathname === "/" && !req.headers.get("upgrade")) {
            const accept = req.headers.get("accept") ?? ""
            if (accept.includes("application/nostr+json")) {
              // Return merged relay info (base + module-contributed + runtime admin overrides)
              const info = { ...relayInfo, ...currentRelayInfo }
              return new Response(JSON.stringify(info), {
                headers: {
                  "Content-Type": "application/nostr+json",
                  ...corsHeaders,
                },
              })
            }
          }

          // NIP-86: Management API (HTTP JSON-RPC over same URI)
          const ctype = (req.headers.get("content-type") ?? "").toLowerCase()
          if (ctype.includes("application/nostr+json+rpc")) {
            // Must include NIP-98 Authorization header
            const auth = req.headers.get("authorization") ?? ""
            if (!auth) return new Response("Unauthorized", { status: 401 })

            let payload: any
            try {
              payload = await req.json()
            } catch {
              return new Response(JSON.stringify({ result: null, error: "invalid json" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              })
            }

            try {
              const event = await unpackEventFromToken(auth)
              await validateEventFull(event, `${url.origin}${url.pathname}`, req.method.toLowerCase(), payload)
            } catch (e: any) {
              return new Response("Unauthorized", { status: 401 })
            }

            const method = payload?.method as string | undefined
            const params = (payload?.params as any[]) ?? []

            const respond = (result: unknown, status = 200, error?: string) =>
              new Response(JSON.stringify({ result, ...(error ? { error } : {}) }), {
                status,
                headers: { "Content-Type": "application/json" },
              })

            // Dispatch methods
            switch (method) {
              case "supportedmethods": {
                const methods = [
                  "banpubkey",
                  "listbannedpubkeys",
                  "allowpubkey",
                  "listallowedpubkeys",
                  "listeventsneedingmoderation",
                  "allowevent",
                  "banevent",
                  "listbannedevents",
                  "changerelayname",
                  "changerelaydescription",
                  "changerelayicon",
                  "allowkind",
                  "disallowkind",
                  "listallowedkinds",
                  "blockip",
                  "unblockip",
                  "listblockedips",
                ]
                return respond(methods)
              }

              case "banpubkey": {
                const [pubkey, reason] = params
                const ok = await Effect.runPromise(admin.banPubkey(String(pubkey ?? ""), reason ? String(reason) : undefined))
                return respond(ok)
              }
              case "listbannedpubkeys": {
                const list = await Effect.runPromise(admin.listBannedPubkeys())
                return respond(list)
              }
              case "allowpubkey": {
                const [pubkey, reason] = params
                const ok = await Effect.runPromise(admin.allowPubkey(String(pubkey ?? ""), reason ? String(reason) : undefined))
                return respond(ok)
              }
              case "listallowedpubkeys": {
                const list = await Effect.runPromise(admin.listAllowedPubkeys())
                return respond(list)
              }
              case "listeventsneedingmoderation": {
                const list = await Effect.runPromise(admin.listEventsNeedingModeration())
                return respond(list)
              }
              case "allowevent": {
                const [id, reason] = params
                const ok = await Effect.runPromise(admin.allowEvent(String(id ?? ""), reason ? String(reason) : undefined))
                return respond(ok)
              }
              case "banevent": {
                const [id, reason] = params
                const ok = await Effect.runPromise(admin.banEvent(String(id ?? ""), reason ? String(reason) : undefined))
                return respond(ok)
              }
              case "listbannedevents": {
                const list = await Effect.runPromise(admin.listBannedEvents())
                return respond(list)
              }
              case "changerelayname": {
                const [name] = params
                const ok = await Effect.runPromise(admin.changeRelayName(String(name ?? "")))
                // Update overlay for GET / NIP-11
                const info = await Effect.runPromise(admin.getRelayInfo())
                currentRelayInfo = { ...currentRelayInfo, ...info }
                return respond(ok)
              }
              case "changerelaydescription": {
                const [desc] = params
                const ok = await Effect.runPromise(admin.changeRelayDescription(String(desc ?? "")))
                const info = await Effect.runPromise(admin.getRelayInfo())
                currentRelayInfo = { ...currentRelayInfo, ...info }
                return respond(ok)
              }
              case "changerelayicon": {
                const [icon] = params
                const ok = await Effect.runPromise(admin.changeRelayIcon(String(icon ?? "")))
                const info = await Effect.runPromise(admin.getRelayInfo())
                currentRelayInfo = { ...currentRelayInfo, ...info }
                return respond(ok)
              }
              case "allowkind": {
                const [kind] = params
                const ok = await Effect.runPromise(admin.allowKind(Number(kind)))
                return respond(ok)
              }
              case "disallowkind": {
                const [kind] = params
                const ok = await Effect.runPromise(admin.disallowKind(Number(kind)))
                return respond(ok)
              }
              case "listallowedkinds": {
                const list = await Effect.runPromise(admin.listAllowedKinds())
                return respond(list)
              }
              case "blockip": {
                const [ip, reason] = params
                const ok = await Effect.runPromise(admin.blockIp(String(ip ?? ""), reason ? String(reason) : undefined))
                return respond(ok)
              }
              case "unblockip": {
                const [ip] = params
                const ok = await Effect.runPromise(admin.unblockIp(String(ip ?? "")))
                return respond(ok)
              }
              case "listblockedips": {
                const list = await Effect.runPromise(admin.listBlockedIps())
                return respond(list)
              }
              default:
                return respond(null, 400, "unsupported method")
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
            const result = Effect.runSync(
              messageHandler.handleRaw(data.connectionId, raw).pipe(
                Effect.catch((error) =>
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
            Effect.runSync(subscriptionManager.removeConnection(data.connectionId))

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
// NIP-29 LiveKit JWT (minimal HS256 for dev/test)
// Spec: sub MUST start with lowercase hex pubkey (first 64 chars)
// =============================================================================

const b64url = (data: Uint8Array | string): string => {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function mintLivekitJwt(params: {
  readonly pubkey: string
  readonly groupId: string
  readonly secret: string
  readonly ttlSeconds?: number
}): string {
  const header = { alg: "HS256", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const random = bytesToHex(sha256(new TextEncoder().encode(`${params.pubkey}:${now}`))).slice(0, 8)
  const payload = {
    // NIP-29: first 64 chars of sub = lowercase hex pubkey
    sub: `${params.pubkey.toLowerCase()}_${random}`,
    video: {
      roomJoin: true,
      room: params.groupId,
    },
    iat: now,
    exp: now + (params.ttlSeconds ?? 3600),
    nbf: now,
  }
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const signingInput = `${h}.${p}`
  const sig = hmac(sha256, new TextEncoder().encode(params.secret), new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64url(sig)}`
}

// =============================================================================
// Service Layer
// =============================================================================

export const RelayServerLive = Layer.effect(RelayServer, make)
