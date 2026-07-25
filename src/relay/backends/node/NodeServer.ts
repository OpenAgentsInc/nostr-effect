/**
 * NodeServer
 *
 * Thin node:http + ws adapter for the platform-agnostic RelayServer contract.
 * Mirrors BunServer HTTP routes (NIP-11, NIP-86, NIP-29 LiveKit) and carries
 * the connection discipline the core assumes: connection limit, proactive
 * NIP-42 AUTH challenge, heartbeat with miss limit, and slow-client policy.
 *
 * No Bun.* APIs and no bun: imports.
 */
import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Effect, Layer, Option } from "effect"
import { WebSocketServer, WebSocket } from "ws"
import { MessageHandler, type BroadcastMessage } from "../../core/MessageHandler.js"
import {
  RelayServer,
  type ConnectionData,
} from "../../core/RelayServer.js"
import { SubscriptionManager } from "../../core/SubscriptionManager.js"
import { AuthService } from "../../core/AuthService.js"
import { ConnectionManager } from "../../core/ConnectionManager.js"
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
// Host defaults
// =============================================================================

const DEFAULT_MAX_CONNECTIONS = 10_000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_HEARTBEAT_MISS_LIMIT = 2
const DEFAULT_SLOW_CLIENT_BUFFERED_BYTES = 1_048_576

// =============================================================================
// Service Implementation
// =============================================================================

type TrackedSocket = {
  readonly ws: WebSocket
  readonly send: (msg: string) => void
  heartbeatTimer: ReturnType<typeof setInterval> | undefined
  missedPongs: number
}

const make = Effect.gen(function* () {
  const messageHandler = yield* MessageHandler
  const admin = yield* Nip86AdminService
  const subscriptionManager = yield* SubscriptionManager
  const authOption = yield* Effect.serviceOption(AuthService)
  const connectionManagerOption = yield* Effect.serviceOption(ConnectionManager)

  let connectionCounter = 0
  const generateConnectionId = (): string => {
    connectionCounter++
    return `conn_${Date.now()}_${connectionCounter}`
  }

  const connections = new Map<string, TrackedSocket>()

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
      const relayInfo = config.relayInfo
        ? mergeRelayInfo(config.relayInfo)
        : defaultRelayInfo
      let currentRelayInfo: Partial<RelayInfo> = { ...relayInfo }

      const maxConnections = config.maxConnections ?? DEFAULT_MAX_CONNECTIONS
      const heartbeatIntervalMs =
        config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
      const heartbeatMissLimit =
        config.heartbeatMissLimit ?? DEFAULT_HEARTBEAT_MISS_LIMIT
      const slowClientBufferedBytes =
        config.slowClientBufferedBytes ?? DEFAULT_SLOW_CLIENT_BUFFERED_BYTES

      const corsHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      }

      const livekit = config.livekit
      const hostname = config.host ?? "0.0.0.0"

      const writeJson = (
        res: ServerResponse,
        status: number,
        body: unknown,
        extraHeaders: Record<string, string> = {}
      ) => {
        const payload = JSON.stringify(body)
        res.writeHead(status, {
          "Content-Type": "application/json",
          ...extraHeaders,
        })
        res.end(payload)
      }

      const writeText = (
        res: ServerResponse,
        status: number,
        body: string,
        extraHeaders: Record<string, string> = {}
      ) => {
        res.writeHead(status, extraHeaders)
        res.end(body)
      }

      const readBody = async (req: IncomingMessage): Promise<Buffer> => {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
        }
        return Buffer.concat(chunks)
      }

      const requestUrl = (req: IncomingMessage): URL => {
        const host = req.headers.host ?? `${hostname}:${config.port}`
        return new URL(req.url ?? "/", `http://${host}`)
      }

      const handleHttp = async (
        req: IncomingMessage,
        res: ServerResponse
      ): Promise<void> => {
        const url = requestUrl(req)
        const method = (req.method ?? "GET").toUpperCase()

        if (method === "OPTIONS") {
          res.writeHead(204, corsHeaders)
          res.end()
          return
        }

        // NIP-29 LiveKit: capability probe (204 = supported)
        if (
          method === "GET" &&
          url.pathname === "/.well-known/nip29/livekit" &&
          (req.headers.upgrade ?? "").toLowerCase() !== "websocket"
        ) {
          if (!livekit) {
            writeText(res, 404, "LiveKit not configured", corsHeaders)
            return
          }
          res.writeHead(204, corsHeaders)
          res.end()
          return
        }

        // NIP-29 LiveKit: token endpoint for group (NIP-98 auth required)
        const livekitGroupMatch = url.pathname.match(
          /^\/\.well-known\/nip29\/livekit\/([^/]+)\/?$/
        )
        if (
          method === "GET" &&
          livekitGroupMatch &&
          (req.headers.upgrade ?? "").toLowerCase() !== "websocket"
        ) {
          if (!livekit) {
            writeJson(
              res,
              404,
              { error: "livekit not configured" },
              corsHeaders
            )
            return
          }
          const groupId = decodeURIComponent(livekitGroupMatch[1]!)
          const auth = req.headers.authorization ?? ""
          if (!auth) {
            writeText(res, 401, "Unauthorized", corsHeaders)
            return
          }
          try {
            const event = await unpackEventFromToken(auth)
            if (Number(event.kind) !== Number(HTTP_AUTH_KIND)) {
              writeText(res, 401, "Unauthorized", corsHeaders)
              return
            }
            const expectedUrl = `${url.origin}/.well-known/nip29/livekit/${encodeURIComponent(groupId)}`
            await validateEventFull(event, expectedUrl, "get")
            const token = mintLivekitJwt({
              pubkey: event.pubkey,
              groupId,
              secret: livekit.jwtSecret ?? "nostr-effect-dev-livekit",
              ttlSeconds: livekit.tokenTtlSeconds ?? 3600,
            })
            writeJson(
              res,
              200,
              { token, url: livekit.url, room: groupId },
              corsHeaders
            )
          } catch {
            writeText(res, 401, "Unauthorized", corsHeaders)
          }
          return
        }

        // NIP-11: Return relay info for HTTP GET /
        if (
          method === "GET" &&
          url.pathname === "/" &&
          (req.headers.upgrade ?? "").toLowerCase() !== "websocket"
        ) {
          const accept = req.headers.accept ?? ""
          if (accept.includes("application/nostr+json")) {
            const info = { ...relayInfo, ...currentRelayInfo }
            writeJson(res, 200, info, {
              "Content-Type": "application/nostr+json",
              ...corsHeaders,
            })
            return
          }
        }

        // NIP-86: Management API (HTTP JSON-RPC over same URI)
        const ctype = (req.headers["content-type"] ?? "").toLowerCase()
        if (ctype.includes("application/nostr+json+rpc")) {
          const auth = req.headers.authorization ?? ""
          if (!auth) {
            writeText(res, 401, "Unauthorized")
            return
          }

          let payload: any
          try {
            const raw = await readBody(req)
            payload = JSON.parse(raw.toString("utf8"))
          } catch {
            writeJson(res, 400, { result: null, error: "invalid json" })
            return
          }

          try {
            const event = await unpackEventFromToken(auth)
            await validateEventFull(
              event,
              `${url.origin}${url.pathname}`,
              method.toLowerCase(),
              payload
            )
          } catch {
            writeText(res, 401, "Unauthorized")
            return
          }

          const rpcMethod = payload?.method as string | undefined
          const params = (payload?.params as any[]) ?? []

          const respond = (result: unknown, status = 200, error?: string) =>
            writeJson(res, status, {
              result,
              ...(error ? { error } : {}),
            })

          switch (rpcMethod) {
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
              respond(methods)
              return
            }
            case "banpubkey": {
              const [pubkey, reason] = params
              const ok = await Effect.runPromise(
                admin.banPubkey(
                  String(pubkey ?? ""),
                  reason ? String(reason) : undefined
                )
              )
              respond(ok)
              return
            }
            case "listbannedpubkeys": {
              respond(await Effect.runPromise(admin.listBannedPubkeys()))
              return
            }
            case "allowpubkey": {
              const [pubkey, reason] = params
              const ok = await Effect.runPromise(
                admin.allowPubkey(
                  String(pubkey ?? ""),
                  reason ? String(reason) : undefined
                )
              )
              respond(ok)
              return
            }
            case "listallowedpubkeys": {
              respond(await Effect.runPromise(admin.listAllowedPubkeys()))
              return
            }
            case "listeventsneedingmoderation": {
              respond(
                await Effect.runPromise(admin.listEventsNeedingModeration())
              )
              return
            }
            case "allowevent": {
              const [id, reason] = params
              const ok = await Effect.runPromise(
                admin.allowEvent(
                  String(id ?? ""),
                  reason ? String(reason) : undefined
                )
              )
              respond(ok)
              return
            }
            case "banevent": {
              const [id, reason] = params
              const ok = await Effect.runPromise(
                admin.banEvent(
                  String(id ?? ""),
                  reason ? String(reason) : undefined
                )
              )
              respond(ok)
              return
            }
            case "listbannedevents": {
              respond(await Effect.runPromise(admin.listBannedEvents()))
              return
            }
            case "changerelayname": {
              const [name] = params
              const ok = await Effect.runPromise(
                admin.changeRelayName(String(name ?? ""))
              )
              const info = await Effect.runPromise(admin.getRelayInfo())
              currentRelayInfo = { ...currentRelayInfo, ...info }
              respond(ok)
              return
            }
            case "changerelaydescription": {
              const [desc] = params
              const ok = await Effect.runPromise(
                admin.changeRelayDescription(String(desc ?? ""))
              )
              const info = await Effect.runPromise(admin.getRelayInfo())
              currentRelayInfo = { ...currentRelayInfo, ...info }
              respond(ok)
              return
            }
            case "changerelayicon": {
              const [icon] = params
              const ok = await Effect.runPromise(
                admin.changeRelayIcon(String(icon ?? ""))
              )
              const info = await Effect.runPromise(admin.getRelayInfo())
              currentRelayInfo = { ...currentRelayInfo, ...info }
              respond(ok)
              return
            }
            case "allowkind": {
              const [kind] = params
              respond(await Effect.runPromise(admin.allowKind(Number(kind))))
              return
            }
            case "disallowkind": {
              const [kind] = params
              respond(await Effect.runPromise(admin.disallowKind(Number(kind))))
              return
            }
            case "listallowedkinds": {
              respond(await Effect.runPromise(admin.listAllowedKinds()))
              return
            }
            case "blockip": {
              const [ip, reason] = params
              const ok = await Effect.runPromise(
                admin.blockIp(
                  String(ip ?? ""),
                  reason ? String(reason) : undefined
                )
              )
              respond(ok)
              return
            }
            case "unblockip": {
              const [ip] = params
              respond(
                await Effect.runPromise(admin.unblockIp(String(ip ?? "")))
              )
              return
            }
            case "listblockedips": {
              respond(await Effect.runPromise(admin.listBlockedIps()))
              return
            }
            default:
              respond(null, 400, "unsupported method")
              return
          }
        }

        writeText(res, 400, "Expected WebSocket upgrade or NIP-11/NIP-86 request")
      }

      const makeBoundedSend = (ws: WebSocket): ((msg: string) => void) => {
        return (msg: string) => {
          if (ws.readyState !== WebSocket.OPEN) return
          if (ws.bufferedAmount > slowClientBufferedBytes) {
            ws.close(1008, "slow consumer")
            return
          }
          ws.send(msg)
        }
      }

      const clearHeartbeat = (tracked: TrackedSocket): void => {
        if (tracked.heartbeatTimer !== undefined) {
          clearInterval(tracked.heartbeatTimer)
          tracked.heartbeatTimer = undefined
        }
      }

      const attachHeartbeat = (tracked: TrackedSocket): void => {
        if (heartbeatIntervalMs <= 0) return
        tracked.heartbeatTimer = setInterval(() => {
          if (tracked.ws.readyState !== WebSocket.OPEN) {
            clearHeartbeat(tracked)
            return
          }
          if (tracked.missedPongs >= heartbeatMissLimit) {
            tracked.ws.terminate()
            return
          }
          tracked.missedPongs += 1
          tracked.ws.ping()
        }, heartbeatIntervalMs)
        // Unref so heartbeats do not keep the process alive after stop()
        tracked.heartbeatTimer.unref?.()
      }

      const remoteAddressOf = (req: IncomingMessage): string | undefined => {
        const forwarded = req.headers["x-forwarded-for"]
        if (typeof forwarded === "string" && forwarded.length > 0) {
          return forwarded.split(",")[0]?.trim()
        }
        return req.socket.remoteAddress
      }

      const server = http.createServer((req, res) => {
        void handleHttp(req, res).catch((error: unknown) => {
          if (!res.headersSent) {
            writeText(
              res,
              500,
              `internal error: ${error instanceof Error ? error.message : String(error)}`
            )
          } else {
            res.end()
          }
        })
      })

      const wss = new WebSocketServer({ noServer: true })

      server.on("upgrade", (req, socket, head) => {
        if (connections.size >= maxConnections) {
          socket.write(
            "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
          )
          socket.end()
          return
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req)
        })
      })

      wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        const connectionId = generateConnectionId()
        const _connectionData = { connectionId } satisfies ConnectionData
        void _connectionData

        const send = makeBoundedSend(ws)
        const tracked: TrackedSocket = {
          ws,
          send,
          missedPongs: 0,
          heartbeatTimer: undefined,
        }
        connections.set(connectionId, tracked)

        // Per-connection serialized work queue.
        //
        // `handleRaw` is asynchronous whenever it reaches the event store, so it
        // cannot run under `Effect.runSync`: that raises `AsyncFiberError`,
        // which escapes the `ws` emitter and terminates the process. A relay
        // must also never reorder frames from one client, so every unit of work
        // chains onto the previous one rather than racing it.
        let queue: Promise<void> = Promise.resolve()
        const enqueue = (work: () => Promise<void>): void => {
          queue = queue.then(work).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            try {
              send(JSON.stringify(["NOTICE", `error: ${message}`]))
            } catch {
              // The socket is already gone; nothing further to report.
            }
          })
        }

        // Register connection + proactive NIP-42 AUTH challenge when services exist.
        if (Option.isSome(connectionManagerOption)) {
          const remoteAddress = remoteAddressOf(req)
          enqueue(async () => {
            await Effect.runPromise(
              connectionManagerOption.value.connect({
                id: connectionId,
                ...(remoteAddress !== undefined ? { remoteAddress } : {}),
              })
            )
          })
        }
        if (Option.isSome(authOption)) {
          enqueue(async () => {
            const challenge = await Effect.runPromise(
              authOption.value.createChallenge(connectionId)
            )
            const authMessage = authOption.value.buildAuthMessage(challenge)
            send(JSON.stringify(authMessage))
          })
        }

        attachHeartbeat(tracked)

        ws.on("pong", () => {
          tracked.missedPongs = 0
        })

        ws.on("message", (message, isBinary) => {
          const raw = isBinary
            ? Buffer.from(message as Buffer).toString("utf8")
            : typeof message === "string"
              ? message
              : Buffer.from(message as Buffer).toString("utf8")

          enqueue(async () => {
            const result = await Effect.runPromise(
              messageHandler.handleRaw(connectionId, raw).pipe(
                Effect.catch((error) =>
                  Effect.succeed({
                    responses: [
                      ["NOTICE", `error: ${error.message}`] as RelayMessage,
                    ],
                    broadcasts: [],
                  })
                )
              )
            )

            for (const response of result.responses) {
              send(JSON.stringify(response))
            }
            broadcastEvent(result.broadcasts)
          })
        })

        const cleanup = () => {
          clearHeartbeat(tracked)
          connections.delete(connectionId)
          // Teardown is asynchronous for the same reason as inbound work, and it
          // must run after any in-flight frame for this connection.
          enqueue(async () => {
            await Effect.runPromise(
              subscriptionManager.removeConnection(connectionId)
            )
            if (Option.isSome(connectionManagerOption)) {
              await Effect.runPromise(
                connectionManagerOption.value.disconnect(connectionId)
              )
            }
          })
        }

        ws.on("close", cleanup)
        ws.on("error", () => {
          // close will follow; ensure cleanup if needed
          if (connections.has(connectionId)) cleanup()
        })
      })

      const boundPort = yield* Effect.promise(
        () =>
          new Promise<number>((resolve, reject) => {
            server.once("error", reject)
            server.listen(config.port, hostname, () => {
              const address = server.address()
              if (address && typeof address === "object") {
                resolve(address.port)
              } else {
                resolve(config.port)
              }
            })
          })
      )

      return {
        port: boundPort,
        stop: () =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                // Best-effort teardown: tests and local hosts must not hang
                // or throw if the HTTP server is already closed.
                let settled = false
                const finish = () => {
                  if (settled) return
                  settled = true
                  resolve()
                }

                for (const tracked of connections.values()) {
                  clearHeartbeat(tracked)
                  try {
                    tracked.ws.terminate()
                  } catch {
                    // ignore
                  }
                }
                connections.clear()

                try {
                  wss.close()
                } catch {
                  // ignore
                }

                if (typeof server.closeAllConnections === "function") {
                  try {
                    server.closeAllConnections()
                  } catch {
                    // ignore
                  }
                }

                if (!server.listening) {
                  finish()
                  return
                }

                try {
                  server.close(() => finish())
                } catch {
                  finish()
                }
                setTimeout(finish, 1000).unref?.()
              })
          ),
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
// NIP-29 LiveKit JWT (minimal HS256 for dev/test) — same as Bun host
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
  const random = bytesToHex(
    sha256(new TextEncoder().encode(`${params.pubkey}:${now}`))
  ).slice(0, 8)
  const payload = {
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
  const sig = hmac(
    sha256,
    new TextEncoder().encode(params.secret),
    new TextEncoder().encode(signingInput)
  )
  return `${signingInput}.${b64url(sig)}`
}

// =============================================================================
// Service Layer
// =============================================================================

export const RelayServerLive = Layer.effect(RelayServer, make)

/** Exported for tests that need to assert host defaults. */
export const NodeHostDefaults = {
  maxConnections: DEFAULT_MAX_CONNECTIONS,
  heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
  heartbeatMissLimit: DEFAULT_HEARTBEAT_MISS_LIMIT,
  slowClientBufferedBytes: DEFAULT_SLOW_CLIENT_BUFFERED_BYTES,
} as const
