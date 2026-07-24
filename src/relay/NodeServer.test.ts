/**
 * Node WebSocket relay host tests (SARAH-NR-02)
 *
 * Runs under bun:test against the Node host (node:http + ws) so existing
 * suites can add a node-backed path before the Stage 4 runner migration.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Schema } from "effect"
import WebSocket from "ws"
import {
  startTestRelay,
  NodeHostDefaults,
  type RelayHandle,
} from "./backends/node/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { EventKind, type NostrEvent, type RelayMessage } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)

const ServiceLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

const connect = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    // Keep a permanent error listener so terminate/close during teardown
    // never surfaces as an unhandled ErrorEvent under bun:test.
    ws.on("error", () => {
      /* swallow post-open socket errors */
    })
    ws.once("open", () => resolve(ws))
    ws.once("error", (error) => reject(error))
  })

const waitForMessage = (
  ws: WebSocket,
  timeout = 3000,
  predicate: (msg: RelayMessage) => boolean = () => true
): Promise<RelayMessage> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for message")), timeout)
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as RelayMessage
      if (!predicate(msg)) return
      clearTimeout(timer)
      ws.off("message", onMessage)
      resolve(msg)
    }
    ws.on("message", onMessage)
  })

const createTestEvent = async (): Promise<NostrEvent> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const crypto = yield* CryptoService
      const events = yield* EventService
      const sk = yield* crypto.generatePrivateKey()
      return yield* events.createEvent(
        { kind: decodeKind(1), content: "hello node relay" },
        sk
      )
    }).pipe(Effect.provide(ServiceLayer))
  )

describe("Node RelayServer host", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 31000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  test("sends a proactive NIP-42 AUTH challenge on connect", async () => {
    const ws = await connect(port)
    const msg = await waitForMessage(ws, 3000, (m) => m[0] === "AUTH")
    expect(msg[0]).toBe("AUTH")
    expect(typeof msg[1]).toBe("string")
    expect((msg[1] as string).length).toBeGreaterThan(0)
    ws.close()
  })

  test("accepts EVENT and returns OK", async () => {
    const ws = await connect(port)
    // Drain AUTH
    await waitForMessage(ws, 3000, (m) => m[0] === "AUTH")

    const event = await createTestEvent()
    ws.send(JSON.stringify(["EVENT", event]))
    const ok = await waitForMessage(ws, 3000, (m) => m[0] === "OK")
    expect(ok[0]).toBe("OK")
    expect(ok[1]).toBe(event.id)
    expect(ok[2]).toBe(true)
    ws.close()
  })

  test("serves NIP-11 application/nostr+json", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { Accept: "application/nostr+json" },
    })
    expect(response.ok).toBe(true)
    expect(response.headers.get("Content-Type")).toBe("application/nostr+json")
    const info = (await response.json()) as { name?: string; supported_nips?: number[] }
    expect(info.name).toBeDefined()
    expect(info.supported_nips).toContain(1)
  })

  test("NIP-86 supportedmethods requires Authorization", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/nostr+json+rpc" },
      body: JSON.stringify({ method: "supportedmethods", params: [] }),
    })
    expect(response.status).toBe(401)
  })

  test("exposes connection discipline defaults", () => {
    expect(NodeHostDefaults.maxConnections).toBeGreaterThan(0)
    expect(NodeHostDefaults.heartbeatIntervalMs).toBeGreaterThan(0)
    expect(NodeHostDefaults.heartbeatMissLimit).toBeGreaterThan(0)
    expect(NodeHostDefaults.slowClientBufferedBytes).toBeGreaterThan(0)
  })
})

describe("Node RelayServer connection limit", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 32000 + Math.floor(Math.random() * 10000)
    const { makeMemoryRelayLayerWithNips, RelayServer } = await import(
      "./backends/node/index.js"
    )
    const layer = makeMemoryRelayLayerWithNips(undefined, {
      relayUrls: [`ws://127.0.0.1:${port}`],
      authRequired: false,
    })
    relay = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const server = yield* RelayServer
          return yield* server.start({ port, maxConnections: 1 })
        }),
        layer
      )
    )
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  test("rejects upgrades beyond maxConnections", async () => {
    const net = await import("node:net")
    const first = await connect(port)
    await waitForMessage(first, 3000, (m) => m[0] === "AUTH")

    // Real Node returns HTTP 503 bytes on the upgrade socket. Bun closes the
    // socket without delivering those bytes. Either outcome proves the limit.
    const outcome = await new Promise<"rejected">((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.write(
          "GET / HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n" +
            "\r\n"
        )
      })
      let data = ""
      socket.on("data", (chunk) => {
        data += chunk.toString("utf8")
        if (
          data.startsWith("HTTP/1.1 503") ||
          data.includes("\r\n\r\n")
        ) {
          socket.end()
          if (data.startsWith("HTTP/1.1 101")) {
            reject(new Error("second connection upgraded despite limit"))
            return
          }
          resolve("rejected")
        }
      })
      socket.on("close", () => resolve("rejected"))
      socket.on("error", () => resolve("rejected"))
      socket.setTimeout(3000, () => {
        socket.destroy()
        reject(new Error(`timeout; data=${JSON.stringify(data)}`))
      })
    })

    expect(outcome).toBe("rejected")
    await new Promise<void>((resolve) => {
      first.once("close", () => resolve())
      try {
        first.terminate()
      } catch {
        first.close()
      }
      setTimeout(resolve, 500)
    })
  })
})
