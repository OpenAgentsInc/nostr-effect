/**
 * NIP-18: Reposts Tests
 * Tests ported from nostr-tools for 100% parity
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import {
  REPOST_KIND,
  GENERIC_REPOST_KIND,
  Nip18ServiceLiveLayer,
  Nip18Service,
} from "./Nip18Service.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import type {
  NostrEvent,
  EventKind,
  EventId,
  PublicKey,
  UnixTimestamp,
  Signature,
  Tag,
  PrivateKey,
} from "../core/Schema.js"

const testPrivkey = "d217c1ff2f8a65c3e3a1740db3b9f58b8c848bb45e26d00ed4714e4a0f4ceecf" as PrivateKey
const relayUrl = "https://relay.example.com"

const createTestEvent = (kind: number = 1): NostrEvent => ({
  id: "abc123def456" as EventId,
  pubkey: "17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6571f2d0d0ca0" as PublicKey,
  created_at: 1617932115 as UnixTimestamp,
  kind: kind as EventKind,
  tags: [
    ["e", "replied event id"] as unknown as Tag,
    ["p", "replied event pubkey"] as unknown as Tag,
  ] as unknown as readonly Tag[],
  content: "Replied to a post",
  sig: "sig123" as Signature,
})

const runWithService = <E, A>(effect: Effect.Effect<A, E, Nip18Service | EventService | CryptoService>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const nip18Service = yield* Nip18ServiceLiveLayer
      return yield* Effect.provideService(effect, Nip18Service, nip18Service)
    }).pipe(Effect.provide(EventServiceLive), Effect.provide(CryptoServiceLive))
  )

describe("NIP-18: Reposts", () => {
  describe("REPOST_KIND", () => {
    test("should be kind 6", () => {
      expect(REPOST_KIND as number).toBe(6)
    })
  })

  describe("GENERIC_REPOST_KIND", () => {
    test("should be kind 16", () => {
      expect(GENERIC_REPOST_KIND as number).toBe(16)
    })
  })

  describe("createRepost", () => {
    test("should create a signed repost event from a minimal template", async () => {
      const repostedEvent = createTestEvent(1)
      const template = { created_at: 1617932115 as UnixTimestamp }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return yield* service.createRepost(template, repostedEvent, relayUrl, testPrivkey)
        })
      )

      expect(result.kind).toBe(REPOST_KIND)
      expect(result.content).toBe(JSON.stringify(repostedEvent))
      expect(typeof result.id).toBe("string")
      expect(typeof result.sig).toBe("string")
    })

    test("should include e tag for reposted event", async () => {
      const repostedEvent = createTestEvent(1)
      const template = { created_at: 1617932115 as UnixTimestamp }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return yield* service.createRepost(template, repostedEvent, relayUrl, testPrivkey)
        })
      )

      const eTags = result.tags.filter((t) => t[0] === "e")
      expect(eTags.some((t) => t[1] === repostedEvent.id && t[2] === relayUrl)).toBe(true)
    })

    test("should include p tag for reposted event author", async () => {
      const repostedEvent = createTestEvent(1)
      const template = { created_at: 1617932115 as UnixTimestamp }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return yield* service.createRepost(template, repostedEvent, relayUrl, testPrivkey)
        })
      )

      const pTags = result.tags.filter((t) => t[0] === "p")
      expect(pTags.some((t) => t[1] === repostedEvent.pubkey)).toBe(true)
    })

    test("should create generic repost for non-kind-1 events", async () => {
      const repostedEvent = createTestEvent(30009) // Badge definition
      const template = { created_at: 1617932115 as UnixTimestamp }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return yield* service.createRepost(template, repostedEvent, relayUrl, testPrivkey)
        })
      )

      expect(result.kind).toBe(GENERIC_REPOST_KIND)
      // Should include k tag
      const kTags = result.tags.filter((t) => t[0] === "k")
      expect(kTags.some((t) => t[1] === "30009")).toBe(true)
    })

    test("should create event with empty content for protected events", async () => {
      const protectedEvent: NostrEvent = {
        ...createTestEvent(1),
        tags: [["-"]] as unknown as readonly Tag[],
      }
      const template = { created_at: 1617932115 as UnixTimestamp }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return yield* service.createRepost(template, protectedEvent, relayUrl, testPrivkey)
        })
      )

      expect(result.content).toBe("")
    })

    test("should create event with empty content when template specifies", async () => {
      const repostedEvent = createTestEvent(1)
      const template = { created_at: 1617932115 as UnixTimestamp, content: "" as const }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return yield* service.createRepost(template, repostedEvent, relayUrl, testPrivkey)
        })
      )

      expect(result.content).toBe("")
    })
  })

  describe("getRepostedEventPointer", () => {
    test("should return undefined for non-repost events", async () => {
      const event = createTestEvent(1)

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return service.getRepostedEventPointer(event)
        })
      )

      expect(result).toBeUndefined()
    })

    test("should parse repost event pointer", async () => {
      const repostEvent: NostrEvent = {
        ...createTestEvent(),
        kind: REPOST_KIND,
        tags: [
          ["e", "reposted event id", relayUrl] as unknown as Tag,
          ["p", "reposted pubkey", relayUrl] as unknown as Tag,
        ] as unknown as readonly Tag[],
      }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return service.getRepostedEventPointer(repostEvent)
        })
      )

      expect(result).toBeDefined()
      expect(result!.id).toBe("reposted event id")
      expect(result!.author).toBe("reposted pubkey")
      expect(result!.relays).toContain(relayUrl)
    })

    test("should parse event with only e tag", async () => {
      const repostEvent: NostrEvent = {
        ...createTestEvent(),
        kind: REPOST_KIND,
        tags: [["e", "reposted event id", relayUrl] as unknown as Tag] as unknown as readonly Tag[],
      }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return service.getRepostedEventPointer(repostEvent)
        })
      )

      expect(result!.id).toBe("reposted event id")
      expect(result!.author).toBeUndefined()
      expect(result!.relays).toContain(relayUrl)
    })
  })

  describe("getRepostedEvent", () => {
    test("should return undefined for empty content", async () => {
      const repostEvent: NostrEvent = {
        ...createTestEvent(),
        kind: REPOST_KIND,
        content: "",
        tags: [
          ["e", "abc123def456", relayUrl] as unknown as Tag,
          ["p", "somepubkey"] as unknown as Tag,
        ] as unknown as readonly Tag[],
      }

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return yield* service.getRepostedEvent(repostEvent)
        })
      )

      expect(result).toBeUndefined()
    })

    test("should return undefined for non-repost events", async () => {
      const event = createTestEvent(1)

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* Nip18Service
          return yield* service.getRepostedEvent(event)
        })
      )

      expect(result).toBeUndefined()
    })
  })
})
