/**
 * Node WebSocket relay host tests (SARAH-NR-02)
 *
 * Runs under vite-plus/test against the Node host (node:http + ws) so existing
 * suites can add a node-backed path before the Stage 4 runner migration.
 */
import { describe, test, expect, beforeAll, afterAll } from "vite-plus/test"
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

/**
 * Buffered ws client. The Node host may send AUTH on open before the test
 * attaches a waiter; the `ws` package does not queue those frames.
 */
type BufferedSocket = {
  readonly ws: WebSocket
  waitForMessage: (
    timeout?: number,
    predicate?: (msg: RelayMessage) => boolean
  ) => Promise<RelayMessage>
  close: () => void
}

const connect = (port: number): Promise<BufferedSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const queue: RelayMessage[] = []
    const waiters: Array<{
      predicate: (msg: RelayMessage) => boolean
      resolve: (msg: RelayMessage) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }> = []

    // Keep a permanent error listener so terminate/close during teardown
    // never surfaces as an unhandled ErrorEvent under vite-plus/test.
    ws.on("error", () => {
      /* swallow post-open socket errors */
    })
    ws.on("message", (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as RelayMessage
      const idx = waiters.findIndex((w) => w.predicate(msg))
      if (idx >= 0) {
        const [waiter] = waiters.splice(idx, 1)
        if (!waiter) return
        clearTimeout(waiter.timer)
        waiter.resolve(msg)
        return
      }
      queue.push(msg)
    })

    const waitForMessage = (
      timeout = 3000,
      predicate: (msg: RelayMessage) => boolean = () => true
    ): Promise<RelayMessage> => {
      const queuedIdx = queue.findIndex(predicate)
      if (queuedIdx >= 0) {
        const [msg] = queue.splice(queuedIdx, 1)
        return Promise.resolve(msg as RelayMessage)
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const i = waiters.findIndex((w) => w.timer === timer)
          if (i >= 0) waiters.splice(i, 1)
          rej(new Error("Timeout waiting for message"))
        }, timeout)
        waiters.push({ predicate, resolve: res, reject: rej, timer })
      })
    }

    ws.once("open", () =>
      resolve({
        ws,
        waitForMessage,
        close: () => {
          try {
            ws.terminate()
          } catch {
            ws.close()
          }
        },
      })
    )
    ws.once("error", (error) => reject(error))
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
    const client = await connect(port)
    const msg = await client.waitForMessage(3000, (m) => m[0] === "AUTH")
    expect(msg[0]).toBe("AUTH")
    expect(typeof msg[1]).toBe("string")
    expect((msg[1] as string).length).toBeGreaterThan(0)
    client.close()
  })

  test("accepts EVENT and returns OK", async () => {
    const client = await connect(port)
    // Drain AUTH
    await client.waitForMessage(3000, (m) => m[0] === "AUTH")

    const event = await createTestEvent()
    client.ws.send(JSON.stringify(["EVENT", event]))
    const ok = await client.waitForMessage(3000, (m) => m[0] === "OK")
    expect(ok[0]).toBe("OK")
    expect(ok[1]).toBe(event.id)
    expect(ok[2]).toBe(true)
    client.close()
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
    await first.waitForMessage(3000, (m) => m[0] === "AUTH")

    // Real Node returns HTTP 503 bytes on the upgrade socket when the
    // connection limit is hit. Either 503 or a hard close proves the limit.
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
      first.ws.once("close", () => resolve())
      first.close()
      setTimeout(resolve, 500)
    })
  })
})
