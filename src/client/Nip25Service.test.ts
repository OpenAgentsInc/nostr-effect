/**
 * NIP-25: Reactions Tests
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { Nip25Service, Nip25ServiceLive, REACTION_KIND } from "./Nip25Service.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import type { NostrEvent, EventKind, EventId, PublicKey, UnixTimestamp, Signature, Tag, PrivateKey } from "../core/Schema.js"

const testPrivkey = "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a" as PrivateKey

const createTestEvent = (): NostrEvent => ({
  id: "abc123def456" as EventId,
  pubkey: "17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6571f2d0d0ca0" as PublicKey,
  created_at: 1234567890 as UnixTimestamp,
  kind: 1 as EventKind,
  tags: [
    ["e", "previousevent"] as unknown as Tag,
    ["p", "previouspubkey"] as unknown as Tag,
  ] as unknown as readonly Tag[],
  content: "Hello, world!",
  sig: "sig123" as Signature,
})

describe("NIP-25: Reactions", () => {
  describe("REACTION_KIND", () => {
    test("should be kind 7", () => {
      expect(REACTION_KIND as number).toBe(7)
    })
  })

  describe("createReaction", () => {
    const runWithService = <E, A>(effect: Effect.Effect<A, E, Nip25Service | EventService | CryptoService>) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(Nip25ServiceLive),
          Effect.provide(EventServiceLive),
          Effect.provide(CryptoServiceLive)
        )
      )

    test("should create reaction with default content", async () => {
      const reactedEvent = createTestEvent()

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return yield* service.createReaction({ reactedEvent }, testPrivkey)
        })
      )

      expect(result.kind).toBe(REACTION_KIND)
      expect(result.content).toBe("+")
    })

    test("should create reaction with custom content", async () => {
      const reactedEvent = createTestEvent()

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return yield* service.createReaction({ reactedEvent, content: "🤙" }, testPrivkey)
        })
      )

      expect(result.content).toBe("🤙")
    })

    test("should include e tag for reacted event", async () => {
      const reactedEvent = createTestEvent()

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return yield* service.createReaction({ reactedEvent }, testPrivkey)
        })
      )

      const eTags = result.tags.filter((t) => t[0] === "e")
      expect(eTags.some((t) => t[1] === reactedEvent.id)).toBe(true)
    })

    test("should include p tag for reacted event author", async () => {
      const reactedEvent = createTestEvent()

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return yield* service.createReaction({ reactedEvent }, testPrivkey)
        })
      )

      const pTags = result.tags.filter((t) => t[0] === "p")
      expect(pTags.some((t) => t[1] === reactedEvent.pubkey)).toBe(true)
    })

    test("should inherit e and p tags from reacted event", async () => {
      const reactedEvent = createTestEvent()

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return yield* service.createReaction({ reactedEvent }, testPrivkey)
        })
      )

      const eTags = result.tags.filter((t) => t[0] === "e")
      const pTags = result.tags.filter((t) => t[0] === "p")

      // Should have both inherited and new tags
      expect(eTags.length).toBeGreaterThanOrEqual(2)
      expect(pTags.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("getReactedEventPointer", () => {
    const runWithService = <E, A>(effect: Effect.Effect<A, E, Nip25Service | EventService | CryptoService>) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(Nip25ServiceLive),
          Effect.provide(EventServiceLive),
          Effect.provide(CryptoServiceLive)
        )
      )

    test("should return undefined for non-reaction events", async () => {
      const event = createTestEvent() // kind 1 already

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return service.getReactedEventPointer(event)
        })
      )

      expect(result).toBeUndefined()
    })

    test("should extract pointer from valid reaction", async () => {
      const reactionEvent: NostrEvent = {
        ...createTestEvent(),
        kind: REACTION_KIND,
        content: "+",
        tags: [
          ["e", "eventid123", "wss://relay.example.com"] as unknown as Tag,
          ["p", "pubkey123", "wss://relay.example.com"] as unknown as Tag,
        ] as unknown as readonly Tag[],
      }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return service.getReactedEventPointer(reactionEvent)
        })
      )

      expect(result).toBeDefined()
      expect(result!.id).toBe("eventid123")
      expect(result!.author).toBe("pubkey123")
      expect(result!.relays).toContain("wss://relay.example.com")
    })

    test("should use last e and p tags", async () => {
      const reactionEvent: NostrEvent = {
        ...createTestEvent(),
        kind: REACTION_KIND,
        content: "+",
        tags: [
          ["e", "inherited1"] as unknown as Tag,
          ["p", "inherited1"] as unknown as Tag,
          ["e", "inherited2"] as unknown as Tag,
          ["p", "inherited2"] as unknown as Tag,
          ["e", "targetid"] as unknown as Tag,
          ["p", "targetpubkey"] as unknown as Tag,
        ] as unknown as readonly Tag[],
      }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return service.getReactedEventPointer(reactionEvent)
        })
      )

      expect(result!.id).toBe("targetid")
      expect(result!.author).toBe("targetpubkey")
    })

    test("should return undefined if missing e or p tag", async () => {
      const eventMissingP: NostrEvent = {
        ...createTestEvent(),
        kind: REACTION_KIND,
        tags: [["e", "eventid"]] as unknown as readonly Tag[],
      }

      const eventMissingE: NostrEvent = {
        ...createTestEvent(),
        kind: REACTION_KIND,
        tags: [["p", "pubkey"]] as unknown as readonly Tag[],
      }

      const result1 = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return service.getReactedEventPointer(eventMissingP)
        })
      )

      const result2 = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip25Service
          return service.getReactedEventPointer(eventMissingE)
        })
      )

      expect(result1).toBeUndefined()
      expect(result2).toBeUndefined()
    })
  })
})
