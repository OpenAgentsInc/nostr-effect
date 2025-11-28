import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import {
  Accept,
  Reject,
  Shadow,
  all,
  any,
  when,
  forKinds,
  exceptKinds,
  accept,
  reject,
  shadow,
  type PolicyContext,
} from "./Policy"
import {
  maxContentLength,
  maxTags,
  maxTagValueLength,
  maxFutureSeconds,
  maxPastSeconds,
  allowKinds,
  blockKinds,
  allowPubkeys,
  blockPubkeys,
  verifySignature,
} from "./BuiltInPolicies"
import { PolicyPipeline, PolicyPipelineLive, PolicyPipelinePermissive } from "./PolicyPipeline"
import { EventService, EventServiceLive } from "../../services/EventService"
import { CryptoService, CryptoServiceLive } from "../../services/CryptoService"
import { EventKind, Tag, type NostrEvent, type UnixTimestamp } from "../../core/Schema"

// Test fixtures
const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

const createTestEvent = (overrides: Partial<NostrEvent> = {}): NostrEvent => ({
  id: "a".repeat(64) as NostrEvent["id"],
  pubkey: "b".repeat(64) as NostrEvent["pubkey"],
  created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
  kind: decodeKind(1),
  tags: [],
  content: "Hello Nostr!",
  sig: "c".repeat(128) as NostrEvent["sig"],
  ...overrides,
})

const createTestContext = (event: NostrEvent): PolicyContext => ({
  event,
  connectionId: "conn-1",
  remoteAddress: "127.0.0.1",
})

describe("Policy", () => {
  describe("Decision Constructors", () => {
    test("Accept has correct tag", () => {
      expect(Accept._tag).toBe("Accept")
    })

    test("Reject has correct tag and reason", () => {
      const decision = Reject("test reason")
      expect(decision._tag).toBe("Reject")
      if (decision._tag === "Reject") {
        expect(decision.reason).toBe("test reason")
      }
    })

    test("Shadow has correct tag", () => {
      expect(Shadow._tag).toBe("Shadow")
    })
  })

  describe("Basic Policies", () => {
    test("accept always accepts", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const decision = await Effect.runPromise(accept(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("reject always rejects with reason", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const decision = await Effect.runPromise(reject("blocked")(ctx))
      expect(decision._tag).toBe("Reject")
      expect(decision).toEqual(Reject("blocked"))
    })

    test("shadow always shadows", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const decision = await Effect.runPromise(shadow(ctx))
      expect(decision._tag).toBe("Shadow")
    })
  })

  describe("all combinator", () => {
    test("returns Accept when all policies accept", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const policy = all(accept, accept, accept)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("short-circuits on first Reject", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const policy = all(accept, reject("first"), reject("second"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision).toEqual(Reject("first"))
    })

    test("short-circuits on Shadow", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const policy = all(accept, shadow, reject("never"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Shadow")
    })
  })

  describe("any combinator", () => {
    test("returns Accept on first Accept", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const policy = any(reject("a"), accept, reject("c"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("returns last Reject if all reject", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const policy = any(reject("first"), reject("last"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision).toEqual(Reject("last"))
    })

    test("returns Shadow if encountered", async () => {
      const event = createTestEvent()
      const ctx = createTestContext(event)
      const policy = any(reject("a"), shadow, accept)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Shadow")
    })
  })

  describe("when combinator", () => {
    test("applies policy when predicate is true", async () => {
      const event = createTestEvent({ kind: decodeKind(1) })
      const ctx = createTestContext(event)
      const policy = when((ctx) => ctx.event.kind === 1, reject("kind 1 blocked"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision).toEqual(Reject("kind 1 blocked"))
    })

    test("accepts when predicate is false", async () => {
      const event = createTestEvent({ kind: decodeKind(2) })
      const ctx = createTestContext(event)
      const policy = when((ctx) => ctx.event.kind === 1, reject("kind 1 blocked"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })
  })

  describe("forKinds combinator", () => {
    test("applies policy for matching kinds", async () => {
      const event = createTestEvent({ kind: decodeKind(4) })
      const ctx = createTestContext(event)
      const policy = forKinds([4, 5], reject("DM blocked"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision).toEqual(Reject("DM blocked"))
    })

    test("accepts for non-matching kinds", async () => {
      const event = createTestEvent({ kind: decodeKind(1) })
      const ctx = createTestContext(event)
      const policy = forKinds([4, 5], reject("DM blocked"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })
  })

  describe("exceptKinds combinator", () => {
    test("applies policy for non-matching kinds", async () => {
      const event = createTestEvent({ kind: decodeKind(1) })
      const ctx = createTestContext(event)
      const policy = exceptKinds([0], reject("not metadata"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision).toEqual(Reject("not metadata"))
    })

    test("accepts for matching kinds", async () => {
      const event = createTestEvent({ kind: decodeKind(0) })
      const ctx = createTestContext(event)
      const policy = exceptKinds([0], reject("not metadata"))
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })
  })
})

describe("BuiltInPolicies", () => {
  describe("maxContentLength", () => {
    test("accepts content under limit", async () => {
      const event = createTestEvent({ content: "short" })
      const ctx = createTestContext(event)
      const policy = maxContentLength(1000)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects content over limit", async () => {
      const event = createTestEvent({ content: "x".repeat(100) })
      const ctx = createTestContext(event)
      const policy = maxContentLength(50)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })

    test("handles unicode correctly (byte length)", async () => {
      const event = createTestEvent({ content: "🎉".repeat(10) }) // 4 bytes each
      const ctx = createTestContext(event)
      const policy = maxContentLength(30)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject") // 40 bytes > 30
    })
  })

  describe("maxTags", () => {
    test("accepts tags under limit", async () => {
      const event = createTestEvent({ tags: [decodeTag(["p", "a".repeat(64)])] })
      const ctx = createTestContext(event)
      const policy = maxTags(10)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects tags over limit", async () => {
      const tags = Array.from({ length: 15 }, () => decodeTag(["p", "a".repeat(64)]))
      const event = createTestEvent({ tags })
      const ctx = createTestContext(event)
      const policy = maxTags(10)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })
  })

  describe("maxTagValueLength", () => {
    test("accepts short tag values", async () => {
      const event = createTestEvent({ tags: [decodeTag(["p", "short"])] })
      const ctx = createTestContext(event)
      const policy = maxTagValueLength(100)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects long tag values", async () => {
      const event = createTestEvent({ tags: [decodeTag(["p", "x".repeat(200)])] })
      const ctx = createTestContext(event)
      const policy = maxTagValueLength(100)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })
  })

  describe("maxFutureSeconds", () => {
    test("accepts events with current timestamp", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = createTestEvent({ created_at: now as UnixTimestamp })
      const ctx = createTestContext(event)
      const policy = maxFutureSeconds(60)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects events too far in future", async () => {
      const now = Math.floor(Date.now() / 1000)
      const future = now + 3600 // 1 hour in future
      const event = createTestEvent({ created_at: future as UnixTimestamp })
      const ctx = createTestContext(event)
      const policy = maxFutureSeconds(60)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })
  })

  describe("maxPastSeconds", () => {
    test("accepts recent events", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = createTestEvent({ created_at: now as UnixTimestamp })
      const ctx = createTestContext(event)
      const policy = maxPastSeconds(3600)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects events too far in past", async () => {
      const now = Math.floor(Date.now() / 1000)
      const past = now - 7200 // 2 hours ago
      const event = createTestEvent({ created_at: past as UnixTimestamp })
      const ctx = createTestContext(event)
      const policy = maxPastSeconds(3600)
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })
  })

  describe("allowKinds", () => {
    test("accepts allowed kinds", async () => {
      const event = createTestEvent({ kind: decodeKind(1) })
      const ctx = createTestContext(event)
      const policy = allowKinds([1, 7])
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects disallowed kinds", async () => {
      const event = createTestEvent({ kind: decodeKind(4) })
      const ctx = createTestContext(event)
      const policy = allowKinds([1, 7])
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })
  })

  describe("blockKinds", () => {
    test("accepts non-blocked kinds", async () => {
      const event = createTestEvent({ kind: decodeKind(1) })
      const ctx = createTestContext(event)
      const policy = blockKinds([4, 1984])
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects blocked kinds", async () => {
      const event = createTestEvent({ kind: decodeKind(4) })
      const ctx = createTestContext(event)
      const policy = blockKinds([4, 1984])
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })
  })

  describe("allowPubkeys", () => {
    test("accepts whitelisted pubkeys", async () => {
      const pubkey = "b".repeat(64)
      const event = createTestEvent({ pubkey: pubkey as NostrEvent["pubkey"] })
      const ctx = createTestContext(event)
      const policy = allowPubkeys([pubkey])
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects non-whitelisted pubkeys", async () => {
      const event = createTestEvent({ pubkey: "x".repeat(64) as NostrEvent["pubkey"] })
      const ctx = createTestContext(event)
      const policy = allowPubkeys(["a".repeat(64)])
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })
  })

  describe("blockPubkeys", () => {
    test("accepts non-blocked pubkeys", async () => {
      const event = createTestEvent({ pubkey: "b".repeat(64) as NostrEvent["pubkey"] })
      const ctx = createTestContext(event)
      const policy = blockPubkeys(["a".repeat(64)])
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Accept")
    })

    test("rejects blocked pubkeys", async () => {
      const blocked = "x".repeat(64)
      const event = createTestEvent({ pubkey: blocked as NostrEvent["pubkey"] })
      const ctx = createTestContext(event)
      const policy = blockPubkeys([blocked])
      const decision = await Effect.runPromise(policy(ctx))
      expect(decision._tag).toBe("Reject")
    })
  })

  describe("verifySignature", () => {
    const TestLayer = EventServiceLive.pipe(Layer.provide(CryptoServiceLive))

    test("accepts valid signed event", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey = yield* crypto.generatePrivateKey()

          const event = yield* events.createEvent(
            { kind: decodeKind(1), content: "Valid event" },
            privateKey
          )

          const ctx: PolicyContext = {
            event,
            connectionId: "conn-1",
            remoteAddress: "127.0.0.1",
          }

          // verifySignature returns Effect requiring EventService
          return yield* verifySignature(ctx)
        }).pipe(Effect.provide(Layer.merge(TestLayer, CryptoServiceLive)))
      )

      expect(result._tag).toBe("Accept")
    })

    test("rejects event with invalid signature", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const privateKey = yield* crypto.generatePrivateKey()

          const event = yield* events.createEvent(
            { kind: decodeKind(1), content: "Original" },
            privateKey
          )

          // Tamper with content (invalidates signature)
          const tampered: NostrEvent = { ...event, content: "Tampered" }

          const ctx: PolicyContext = {
            event: tampered,
            connectionId: "conn-1",
            remoteAddress: "127.0.0.1",
          }

          return yield* verifySignature(ctx)
        }).pipe(Effect.provide(Layer.merge(TestLayer, CryptoServiceLive)))
      )

      expect(result._tag).toBe("Reject")
    })
  })
})

describe("PolicyPipeline", () => {
  // Full layer stack: PolicyPipeline depends on EventService which depends on CryptoService
  const FullTestLayer = PolicyPipelineLive.pipe(
    Layer.provideMerge(EventServiceLive),
    Layer.provideMerge(CryptoServiceLive)
  )

  test("accepts valid events through default pipeline", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const crypto = yield* CryptoService
        const events = yield* EventService
        const pipeline = yield* PolicyPipeline
        const privateKey = yield* crypto.generatePrivateKey()

        const event = yield* events.createEvent(
          { kind: decodeKind(1), content: "Valid event" },
          privateKey
        )

        return yield* pipeline.evaluate(event, "conn-1", "127.0.0.1")
      }).pipe(Effect.provide(FullTestLayer))
    )

    expect(result._tag).toBe("Accept")
  })

  test("rejects event with invalid signature", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* PolicyPipeline

        // Fake event with bad signature
        const badEvent = createTestEvent()

        return yield* pipeline.evaluate(badEvent, "conn-1", "127.0.0.1")
      }).pipe(Effect.provide(FullTestLayer))
    )

    expect(result._tag).toBe("Reject")
  })

  test("rejects event exceeding content length", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const crypto = yield* CryptoService
        const events = yield* EventService
        const pipeline = yield* PolicyPipeline
        const privateKey = yield* crypto.generatePrivateKey()

        const event = yield* events.createEvent(
          {
            kind: decodeKind(1),
            content: "x".repeat(100 * 1024), // 100KB > 64KB limit
          },
          privateKey
        )

        return yield* pipeline.evaluate(event, "conn-1")
      }).pipe(Effect.provide(FullTestLayer))
    )

    expect(result._tag).toBe("Reject")
  })

  test("permissive pipeline accepts everything", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* PolicyPipeline

        // Invalid event that would normally be rejected
        const badEvent = createTestEvent()

        return yield* pipeline.evaluate(badEvent, "conn-1")
      }).pipe(Effect.provide(PolicyPipelinePermissive))
    )

    expect(result._tag).toBe("Accept")
  })
})
