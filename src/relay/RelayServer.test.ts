import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import { startTestRelay, type RelayHandle } from "./index"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService"
import { EventService, EventServiceLive } from "../services/EventService"
import { EventKind, type NostrEvent, type RelayMessage } from "../core/Schema"

const decodeKind = Schema.decodeSync(EventKind)

// Helpers for WebSocket testing
const connectToRelay = (port: number): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    ws.onopen = () => resolve(ws)
    ws.onerror = (e) => reject(new Error("WebSocket error"))
  })
}

const sendMessage = (ws: WebSocket, message: unknown): void => {
  ws.send(JSON.stringify(message))
}

const waitForMessage = (ws: WebSocket, timeout = 2000): Promise<RelayMessage> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), timeout)
    ws.onmessage = (event) => {
      clearTimeout(timer)
      resolve(JSON.parse(event.data as string))
    }
  })
}

const waitForMessages = (
  ws: WebSocket,
  count: number,
  timeout = 5000
): Promise<RelayMessage[]> => {
  return new Promise((resolve, reject) => {
    const messages: RelayMessage[] = []
    const timer = setTimeout(() => reject(new Error("Timeout")), timeout)

    ws.onmessage = (event) => {
      messages.push(JSON.parse(event.data as string))
      if (messages.length >= count) {
        clearTimeout(timer)
        resolve(messages)
      }
    }
  })
}

// Create test event helper
const createTestEvent = async (): Promise<NostrEvent> => {
  const TestLayer = Layer.merge(
    CryptoServiceLive,
    EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
  )

  return Effect.runPromise(
    Effect.gen(function* () {
      const crypto = yield* CryptoService
      const events = yield* EventService
      const privateKey = yield* crypto.generatePrivateKey()

      return yield* events.createEvent(
        {
          kind: decodeKind(1),
          content: "Hello from test!",
        },
        privateKey
      )
    }).pipe(Effect.provide(TestLayer))
  )
}

describe("RelayServer", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    // Find an available port
    port = 10000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await relay.stop()
  })

  describe("WebSocket connection", () => {
    test("accepts WebSocket connections", async () => {
      const ws = await connectToRelay(port)
      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })
  })

  describe("EVENT message", () => {
    test("returns OK for valid event", async () => {
      const ws = await connectToRelay(port)
      const event = await createTestEvent()

      sendMessage(ws, ["EVENT", event])
      const response = await waitForMessage(ws)

      expect(response[0]).toBe("OK")
      expect(response[1]).toBe(event.id)
      expect(response[2]).toBe(true)

      ws.close()
    })

    test("returns OK for duplicate event", async () => {
      const ws = await connectToRelay(port)
      const event = await createTestEvent()

      // Send same event twice
      sendMessage(ws, ["EVENT", event])
      const response1 = await waitForMessage(ws)

      sendMessage(ws, ["EVENT", event])
      const response2 = await waitForMessage(ws)

      expect(response1[0]).toBe("OK")
      expect(response1[2]).toBe(true)

      expect(response2[0]).toBe("OK")
      expect(response2[2]).toBe(true)
      expect((response2[3] as string).includes("duplicate")).toBe(true)

      ws.close()
    })

    test("rejects invalid event", async () => {
      const ws = await connectToRelay(port)
      const event = await createTestEvent()

      // Tamper with content to invalidate signature
      const tampered = {
        ...event,
        content: "Tampered content",
      }

      sendMessage(ws, ["EVENT", tampered])
      const response = await waitForMessage(ws)

      expect(response[0]).toBe("OK")
      expect(response[2]).toBe(false)
      expect((response[3] as string).includes("invalid")).toBe(true)

      ws.close()
    })
  })

  describe("REQ message", () => {
    test("returns EOSE for empty subscription", async () => {
      const ws = await connectToRelay(port)

      // Subscribe with filter that won't match anything (kind 65535 is valid but rarely used)
      sendMessage(ws, ["REQ", "sub1", { kinds: [65535] }])
      const response = await waitForMessage(ws)

      expect(response[0]).toBe("EOSE")
      expect(response[1]).toBe("sub1")

      ws.close()
    })

    test("returns matching events then EOSE", async () => {
      const ws = await connectToRelay(port)
      const event = await createTestEvent()

      // Store event first
      sendMessage(ws, ["EVENT", event])
      await waitForMessage(ws) // Wait for OK

      // Subscribe for kind 1 - collect until EOSE
      sendMessage(ws, ["REQ", "sub2", { kinds: [1] }])

      const messages: RelayMessage[] = []
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout waiting for EOSE")), 5000)
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as RelayMessage
          messages.push(msg)
          if (msg[0] === "EOSE") {
            clearTimeout(timer)
            resolve()
          }
        }
      })

      // Should have at least one EVENT (ours) and EOSE
      const eventMsgs = messages.filter((m) => m[0] === "EVENT")
      const eoseMsg = messages.find((m) => m[0] === "EOSE")

      expect(eventMsgs.length).toBeGreaterThanOrEqual(1)
      expect(eventMsgs.some((m) => (m[2] as NostrEvent).id === event.id)).toBe(true)

      expect(eoseMsg).toBeDefined()
      expect(eoseMsg![1]).toBe("sub2")

      ws.close()
    })
  })

  describe("CLOSE message", () => {
    test("closes subscription", async () => {
      const ws = await connectToRelay(port)

      // Create subscription
      sendMessage(ws, ["REQ", "sub3", { kinds: [1] }])
      await waitForMessage(ws) // Wait for EOSE

      // Close subscription (no response expected)
      sendMessage(ws, ["CLOSE", "sub3"])

      // Small delay to ensure close is processed
      await new Promise((r) => setTimeout(r, 100))

      ws.close()
    })
  })

  describe("Event broadcasting", () => {
    test("broadcasts events to matching subscriptions", async () => {
      // Connect two clients
      const ws1 = await connectToRelay(port)
      const ws2 = await connectToRelay(port)

      // Client 2 subscribes to kind 1
      sendMessage(ws2, ["REQ", "broadcast-sub", { kinds: [1] }])

      // Wait for subscription EOSE and set up broadcast listener
      const broadcastPromise = new Promise<RelayMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Broadcast timeout")), 5000)
        let gotEose = false

        ws2.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as RelayMessage
          if (msg[0] === "EOSE") {
            gotEose = true
          } else if (gotEose && msg[0] === "EVENT") {
            // This is the broadcast (after EOSE)
            clearTimeout(timer)
            resolve(msg)
          }
        }
      })

      // Give time for subscription to be set up
      await new Promise((r) => setTimeout(r, 100))

      // Client 1 publishes event
      const event = await createTestEvent()
      sendMessage(ws1, ["EVENT", event])

      // Client 1 should receive OK
      const ws1Response = await waitForMessage(ws1)
      expect(ws1Response[0]).toBe("OK")

      // Client 2 should receive broadcast
      const ws2Broadcast = await broadcastPromise
      expect(ws2Broadcast[0]).toBe("EVENT")
      expect(ws2Broadcast[1]).toBe("broadcast-sub")
      expect((ws2Broadcast[2] as NostrEvent).id).toBe(event.id)

      ws1.close()
      ws2.close()
    })
  })

  describe("NIP-11 relay info", () => {
    test("returns relay info for application/nostr+json", async () => {
      const response = await fetch(`http://localhost:${port}/`, {
        headers: { Accept: "application/nostr+json" },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("application/nostr+json")

      const info = await response.json()
      expect(info.supported_nips).toContain(1)
      expect(info.software).toBe("nostr-effect")
    })
  })
})
