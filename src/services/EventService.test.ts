import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import { EventService, EventServiceLive } from "./EventService"
import { CryptoService, CryptoServiceLive } from "./CryptoService"
import { EventKind, Tag, type NostrEvent, type UnixTimestamp } from "../core/Schema"

const TestLayer = EventServiceLive.pipe(Layer.provide(CryptoServiceLive))

const runWithServices = <A, E>(
  effect: Effect.Effect<A, E, EventService>
): Promise<A> => Effect.runPromise(Effect.provide(effect, TestLayer))

// Helper to decode branded types
const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

describe("EventService", () => {
  describe("createEvent", () => {
    test("creates valid signed event", async () => {
      const event = await runWithServices(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey = yield* crypto.generatePrivateKey()

          return yield* events.createEvent(
            {
              kind: decodeKind(1),
              content: "Hello Nostr!",
            },
            privateKey
          )
        }).pipe(Effect.provide(CryptoServiceLive))
      )

      // Check event structure
      expect(event.id).toHaveLength(64)
      expect(event.pubkey).toHaveLength(64)
      expect(event.sig).toHaveLength(128)
      expect(event.kind).toBe(decodeKind(1))
      expect(event.content).toBe("Hello Nostr!")
      expect(Array.isArray(event.tags)).toBe(true)
      expect(typeof event.created_at).toBe("number")
    })

    test("creates event with tags", async () => {
      const event = await runWithServices(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey = yield* crypto.generatePrivateKey()

          const tag1 = decodeTag(["e", "a".repeat(64)])
          const tag2 = decodeTag(["p", "b".repeat(64)])

          return yield* events.createEvent(
            {
              kind: decodeKind(1),
              content: "Reply",
              tags: [tag1, tag2],
            },
            privateKey
          )
        }).pipe(Effect.provide(CryptoServiceLive))
      )

      expect(event.tags).toHaveLength(2)
      expect(event.tags[0]?.[0]).toBe("e")
      expect(event.tags[1]?.[0]).toBe("p")
    })

    test("uses provided timestamp", async () => {
      const fixedTime = 1700000000 as UnixTimestamp

      const event = await runWithServices(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey = yield* crypto.generatePrivateKey()

          return yield* events.createEvent(
            {
              kind: decodeKind(1),
              content: "Fixed time",
              created_at: fixedTime,
            },
            privateKey
          )
        }).pipe(Effect.provide(CryptoServiceLive))
      )

      expect(event.created_at).toBe(fixedTime)
    })
  })

  describe("verifyEvent", () => {
    test("verifies valid event", async () => {
      const isValid = await runWithServices(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey = yield* crypto.generatePrivateKey()

          const event = yield* events.createEvent(
            {
              kind: decodeKind(1),
              content: "Test event",
            },
            privateKey
          )

          return yield* events.verifyEvent(event)
        }).pipe(Effect.provide(CryptoServiceLive))
      )

      expect(isValid).toBe(true)
    })

    test("rejects event with wrong content", async () => {
      const isValid = await runWithServices(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey = yield* crypto.generatePrivateKey()

          const event = yield* events.createEvent(
            {
              kind: decodeKind(1),
              content: "Original",
            },
            privateKey
          )

          // Tamper with content
          const tampered: NostrEvent = {
            ...event,
            content: "Tampered",
          }

          return yield* events.verifyEvent(tampered)
        }).pipe(Effect.provide(CryptoServiceLive))
      )

      expect(isValid).toBe(false)
    })

    test("rejects event with wrong signature", async () => {
      const isValid = await runWithServices(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey1 = yield* crypto.generatePrivateKey()
          const privateKey2 = yield* crypto.generatePrivateKey()

          const event1 = yield* events.createEvent(
            {
              kind: decodeKind(1),
              content: "Event 1",
            },
            privateKey1
          )

          const event2 = yield* events.createEvent(
            {
              kind: decodeKind(1),
              content: "Event 2",
            },
            privateKey2
          )

          // Use signature from different event
          const tampered: NostrEvent = {
            ...event1,
            sig: event2.sig,
          }

          return yield* events.verifyEvent(tampered)
        }).pipe(Effect.provide(CryptoServiceLive))
      )

      expect(isValid).toBe(false)
    })
  })

  describe("computeEventId", () => {
    test("produces consistent IDs", async () => {
      const result = await runWithServices(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey = yield* crypto.generatePrivateKey()
          const pubkey = yield* crypto.getPublicKey(privateKey)

          const created_at = 1700000000 as UnixTimestamp
          const kind = decodeKind(1)
          const tags: Tag[] = []
          const content = "Test"

          const id1 = yield* events.computeEventId(
            pubkey,
            created_at,
            kind,
            tags,
            content
          )

          const id2 = yield* events.computeEventId(
            pubkey,
            created_at,
            kind,
            tags,
            content
          )

          return { id1, id2 }
        }).pipe(Effect.provide(CryptoServiceLive))
      )

      expect(result.id1).toBe(result.id2)
      expect(result.id1).toHaveLength(64)
    })
  })
})
