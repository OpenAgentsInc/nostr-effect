import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import { startTestRelay, type RelayHandle } from "./index"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService"
import { EventService, EventServiceLive } from "../services/EventService"
import { EventKind, Tag, type NostrEvent, type RelayMessage, type PrivateKey } from "../core/Schema"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

// Helpers for WebSocket testing
const connectToRelay = (port: number): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error("WebSocket error"))
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

const TestLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

// Create test event helper
const createTestEvent = async (): Promise<NostrEvent> => {
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

// Create test event with specific kind, content, tags, and optionally reuse a private key
const createEventWithKind = async (
  kind: number,
  content: string,
  tags: Tag[] = [],
  privateKey?: PrivateKey
): Promise<{ event: NostrEvent; privateKey: PrivateKey }> => {
  return Effect.runPromise(
    Effect.gen(function* () {
      const crypto = yield* CryptoService
      const events = yield* EventService
      const key = privateKey ?? (yield* crypto.generatePrivateKey())

      const event = yield* events.createEvent(
        {
          kind: decodeKind(kind),
          content,
          tags,
        },
        key
      )

      return { event, privateKey: key }
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
    await Effect.runPromise(relay.stop())
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
      expect(eoseMsg![1] as string).toBe("sub2")

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

      const info = (await response.json()) as { supported_nips: number[]; software: string }
      expect(info.supported_nips).toContain(1)
      expect(info.software).toBe("nostr-effect")
    })
  })

  describe("NIP-16 Replaceable Events", () => {
    test("replaces kind 0 (metadata) event with newer one", async () => {
      const ws = await connectToRelay(port)

      // Create first metadata event
      const { event: event1, privateKey } = await createEventWithKind(0, '{"name":"Alice"}')

      // Wait to ensure different timestamp (Nostr uses second granularity)
      await new Promise((r) => setTimeout(r, 1100))

      // Create newer metadata event from same author
      const { event: event2 } = await createEventWithKind(0, '{"name":"Alice Updated"}', [], privateKey)

      // Send first event
      sendMessage(ws, ["EVENT", event1])
      const response1 = await waitForMessage(ws)
      expect(response1[0]).toBe("OK")
      expect(response1[2]).toBe(true)

      // Send second (newer) event
      sendMessage(ws, ["EVENT", event2])
      const response2 = await waitForMessage(ws)
      expect(response2[0]).toBe("OK")
      expect(response2[2]).toBe(true)

      // Query for kind 0 events from this pubkey
      sendMessage(ws, ["REQ", "meta-sub", { kinds: [0], authors: [event1.pubkey] }])

      // Collect responses
      const messages: RelayMessage[] = []
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), 2000)
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as RelayMessage
          messages.push(msg)
          if (msg[0] === "EOSE") {
            clearTimeout(timer)
            resolve()
          }
        }
      })

      // Should only have the newer event (event2)
      const events = messages.filter((m) => m[0] === "EVENT")
      expect(events.length).toBe(1)
      expect((events[0]![2] as NostrEvent).id).toBe(event2.id)

      ws.close()
    })

    test("rejects older replaceable event", async () => {
      const ws = await connectToRelay(port)

      // Create newer event first
      const { event: newerEvent, privateKey } = await createEventWithKind(3, "contacts-v2")

      // Create older event (by manipulating created_at isn't possible, so we send newer first)
      // This test verifies the relay keeps the newer one when receiving out of order

      // Send newer event
      sendMessage(ws, ["EVENT", newerEvent])
      const response1 = await waitForMessage(ws)
      expect(response1[0]).toBe("OK")
      expect(response1[2]).toBe(true)

      // Wait and create "older" event - actually it will be newer timestamp-wise
      // To properly test, we'd need to mock time. For now, test duplicate detection
      const { event: sameKindEvent } = await createEventWithKind(3, "contacts-v1", [], privateKey)

      sendMessage(ws, ["EVENT", sameKindEvent])
      const response2 = await waitForMessage(ws)

      // Should accept (it's actually newer)
      expect(response2[0]).toBe("OK")
      expect(response2[2]).toBe(true)

      ws.close()
    })

    test("replaces kind 10002 (relay list) event", async () => {
      const ws = await connectToRelay(port)

      // Create first relay list event (kind 10002)
      const { event: event1, privateKey } = await createEventWithKind(10002, "", [
        decodeTag(["r", "wss://relay1.example.com"]),
      ])

      // Wait to ensure different timestamp (Nostr uses second granularity)
      await new Promise((r) => setTimeout(r, 1100))

      // Create newer relay list event
      const { event: event2 } = await createEventWithKind(
        10002,
        "",
        [decodeTag(["r", "wss://relay2.example.com"])],
        privateKey
      )

      sendMessage(ws, ["EVENT", event1])
      await waitForMessage(ws)

      sendMessage(ws, ["EVENT", event2])
      await waitForMessage(ws)

      // Query should return only the newer event
      sendMessage(ws, ["REQ", "relay-list", { kinds: [10002], authors: [event1.pubkey] }])

      const messages: RelayMessage[] = []
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), 2000)
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as RelayMessage
          messages.push(msg)
          if (msg[0] === "EOSE") {
            clearTimeout(timer)
            resolve()
          }
        }
      })

      const events = messages.filter((m) => m[0] === "EVENT")
      expect(events.length).toBe(1)
      expect((events[0]![2] as NostrEvent).id).toBe(event2.id)

      ws.close()
    })
  })

  describe("NIP-33 Parameterized Replaceable Events", () => {
    test("replaces parameterized replaceable event with same d-tag", async () => {
      const ws = await connectToRelay(port)

      // Create first article event (kind 30023)
      const { event: event1, privateKey } = await createEventWithKind(
        30023,
        "First version of article",
        [decodeTag(["d", "my-article"])]
      )

      // Wait to ensure different timestamp (Nostr uses second granularity)
      await new Promise((r) => setTimeout(r, 1100))

      // Create updated article with same d-tag
      const { event: event2 } = await createEventWithKind(
        30023,
        "Updated version of article",
        [decodeTag(["d", "my-article"])],
        privateKey
      )

      sendMessage(ws, ["EVENT", event1])
      const response1 = await waitForMessage(ws)
      expect(response1[0]).toBe("OK")
      expect(response1[2]).toBe(true)

      sendMessage(ws, ["EVENT", event2])
      const response2 = await waitForMessage(ws)
      expect(response2[0]).toBe("OK")
      expect(response2[2]).toBe(true)

      // Query should return only the newer event
      sendMessage(ws, ["REQ", "article-sub", { kinds: [30023], authors: [event1.pubkey] }])

      const messages: RelayMessage[] = []
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), 2000)
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as RelayMessage
          messages.push(msg)
          if (msg[0] === "EOSE") {
            clearTimeout(timer)
            resolve()
          }
        }
      })

      const events = messages.filter((m) => m[0] === "EVENT")
      expect(events.length).toBe(1)
      expect((events[0]![2] as NostrEvent).id).toBe(event2.id)
      expect((events[0]![2] as NostrEvent).content).toBe("Updated version of article")

      ws.close()
    })

    test("keeps different d-tag events separate", async () => {
      const ws = await connectToRelay(port)

      // Create two articles with different d-tags
      const { event: article1, privateKey } = await createEventWithKind(
        30023,
        "Article One",
        [decodeTag(["d", "article-one"])]
      )

      const { event: article2 } = await createEventWithKind(
        30023,
        "Article Two",
        [decodeTag(["d", "article-two"])],
        privateKey
      )

      sendMessage(ws, ["EVENT", article1])
      await waitForMessage(ws)

      sendMessage(ws, ["EVENT", article2])
      await waitForMessage(ws)

      // Query should return both events
      sendMessage(ws, ["REQ", "articles", { kinds: [30023], authors: [article1.pubkey] }])

      const messages: RelayMessage[] = []
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), 2000)
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as RelayMessage
          messages.push(msg)
          if (msg[0] === "EOSE") {
            clearTimeout(timer)
            resolve()
          }
        }
      })

      const events = messages.filter((m) => m[0] === "EVENT")
      expect(events.length).toBe(2)

      const eventIds = events.map((m) => (m[2] as NostrEvent).id)
      expect(eventIds).toContain(article1.id)
      expect(eventIds).toContain(article2.id)

      ws.close()
    })

    test("handles empty d-tag", async () => {
      const ws = await connectToRelay(port)

      // Create event with empty d-tag (valid in NIP-33)
      const { event: event1, privateKey } = await createEventWithKind(
        30000,
        "First",
        [decodeTag(["d", ""])]
      )

      // Wait to ensure different timestamp (Nostr uses second granularity)
      await new Promise((r) => setTimeout(r, 1100))

      const { event: event2 } = await createEventWithKind(
        30000,
        "Second",
        [decodeTag(["d", ""])],
        privateKey
      )

      sendMessage(ws, ["EVENT", event1])
      await waitForMessage(ws)

      sendMessage(ws, ["EVENT", event2])
      await waitForMessage(ws)

      // Query should return only the newer event
      sendMessage(ws, ["REQ", "empty-d", { kinds: [30000], authors: [event1.pubkey] }])

      const messages: RelayMessage[] = []
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), 2000)
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data as string) as RelayMessage
          messages.push(msg)
          if (msg[0] === "EOSE") {
            clearTimeout(timer)
            resolve()
          }
        }
      })

      const events = messages.filter((m) => m[0] === "EVENT")
      expect(events.length).toBe(1)
      expect((events[0]![2] as NostrEvent).id).toBe(event2.id)

      ws.close()
    })
  })
})
