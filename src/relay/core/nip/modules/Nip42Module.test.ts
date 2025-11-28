/**
 * NIP-42 Module Tests
 */
import { describe, it, expect } from "bun:test"
import { Effect, Layer } from "effect"
import {
  verifyAuthEvent,
  generateChallenge,
  createNip42Module,
} from "./Nip42Module.js"
import { EventService, EventServiceLive } from "../../../../services/EventService.js"
import { CryptoServiceLive } from "../../../../services/CryptoService.js"
import {
  type NostrEvent,
  type EventKind,
  type PrivateKey,
  type Tag,
  type UnixTimestamp,
  AUTH_EVENT_KIND,
} from "../../../../core/Schema.js"
import type { PolicyDecision } from "../../policy/Policy.js"

// Test helpers
const testPrivateKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as PrivateKey

const runWithServices = <A, E>(
  effect: Effect.Effect<A, E, EventService>
): Promise<A> => {
  const layer = Layer.provide(EventServiceLive, CryptoServiceLive)
  return Effect.runPromise(Effect.provide(effect, layer)) as Promise<A>
}

const createAuthEvent = async (
  challenge: string,
  relayUrl: string,
  options: {
    privateKey?: PrivateKey
    kind?: number
    createdAt?: number
  } = {}
): Promise<NostrEvent> => {
  const layer = Layer.provide(EventServiceLive, CryptoServiceLive)

  const privKey = options.privateKey ?? testPrivateKey
  const kind = (options.kind ?? AUTH_EVENT_KIND) as EventKind

  const params: {
    kind: EventKind
    tags: Tag[]
    content: string
    created_at?: UnixTimestamp
  } = {
    kind,
    tags: [
      ["relay", relayUrl] as unknown as Tag,
      ["challenge", challenge] as unknown as Tag,
    ],
    content: "",
  }

  if (options.createdAt !== undefined) {
    params.created_at = options.createdAt as UnixTimestamp
  }

  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const eventService = yield* EventService
        return yield* eventService.createEvent(params, privKey)
      }),
      layer
    )
  )
}

describe("Nip42Module", () => {
  describe("generateChallenge", () => {
    it("should generate a unique challenge string", () => {
      const c1 = generateChallenge()
      const c2 = generateChallenge()
      expect(c1).not.toBe(c2)
      expect(c1.length).toBeGreaterThan(0)
    })
  })

  // Test parity with nostr-tools nip42.test.ts
  describe("auth event format (nostr-tools parity)", () => {
    it("should create auth event with correct format", async () => {
      const relayUrl = "wss://relay.example.com/"
      const challenge = "chachacha"
      const event = await createAuthEvent(challenge, relayUrl)

      // Matches nostr-tools nip42.test.ts assertions
      expect(event.tags).toHaveLength(2)
      const tag0 = event.tags[0]!
      const tag1 = event.tags[1]!
      expect(tag0[0]).toBe("relay")
      expect(tag0[1]).toBe(relayUrl)
      expect(tag1[0]).toBe("challenge")
      expect(tag1[1]).toBe(challenge)
      expect(event.kind as number).toBe(22242)
    })
  })

  describe("verifyAuthEvent", () => {
    const relayUrls = ["wss://relay.example.com"]
    const maxAuthAge = 600 // 10 minutes

    it("should accept valid auth event", async () => {
      const challenge = generateChallenge()
      const event = await createAuthEvent(challenge, "wss://relay.example.com")

      const result = await runWithServices(
        verifyAuthEvent(event, challenge, relayUrls, maxAuthAge)
      )

      expect(result.valid).toBe(true)
      expect(result.pubkey).toBeDefined()
    })

    it("should reject wrong kind", async () => {
      const challenge = generateChallenge()
      const event = await createAuthEvent(challenge, "wss://relay.example.com", {
        kind: 1, // Wrong kind
      })

      const result = await runWithServices(
        verifyAuthEvent(event, challenge, relayUrls, maxAuthAge)
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain("expected kind 22242")
    })

    it("should reject challenge mismatch", async () => {
      const challenge = generateChallenge()
      const wrongChallenge = generateChallenge()
      const event = await createAuthEvent(challenge, "wss://relay.example.com")

      const result = await runWithServices(
        verifyAuthEvent(event, wrongChallenge, relayUrls, maxAuthAge)
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain("challenge mismatch")
    })

    it("should reject relay URL mismatch", async () => {
      const challenge = generateChallenge()
      const event = await createAuthEvent(challenge, "wss://other-relay.com")

      const result = await runWithServices(
        verifyAuthEvent(event, challenge, relayUrls, maxAuthAge)
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain("relay URL mismatch")
    })

    it("should reject event too old", async () => {
      const challenge = generateChallenge()
      const oldTimestamp = Math.floor(Date.now() / 1000) - 1200 // 20 minutes ago
      const event = await createAuthEvent(challenge, "wss://relay.example.com", {
        createdAt: oldTimestamp,
      })

      const result = await runWithServices(
        verifyAuthEvent(event, challenge, relayUrls, maxAuthAge)
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain("too old")
    })

    it("should accept matching relay domain regardless of path", async () => {
      const challenge = generateChallenge()
      const event = await createAuthEvent(challenge, "wss://relay.example.com/nostr")

      const result = await runWithServices(
        verifyAuthEvent(event, challenge, relayUrls, maxAuthAge)
      )

      // Domain matches, so it should be valid
      expect(result.valid).toBe(true)
    })

    it("should support multiple relay URLs", async () => {
      const multiRelayUrls = [
        "wss://relay.example.com",
        "wss://backup.example.com",
      ]
      const challenge = generateChallenge()
      const event = await createAuthEvent(challenge, "wss://backup.example.com")

      const result = await runWithServices(
        verifyAuthEvent(event, challenge, multiRelayUrls, maxAuthAge)
      )

      expect(result.valid).toBe(true)
    })
  })

  describe("createNip42Module", () => {
    it("should create module with correct NIP number", () => {
      const module = createNip42Module({ relayUrls: ["wss://test.com"] })
      expect(module.nips).toContain(42)
      expect(module.id).toBe("nip-42")
    })

    it("should include AUTH_EVENT_KIND in handled kinds", () => {
      const module = createNip42Module({ relayUrls: ["wss://test.com"] })
      expect(module.kinds).toContain(AUTH_EVENT_KIND)
    })

    it("should set auth_required limitation when configured", () => {
      const module = createNip42Module({
        relayUrls: ["wss://test.com"],
        authRequired: true,
      })
      expect(module.limitations?.auth_required).toBe(true)
    })

    it("should have policy that shadows AUTH events", async () => {
      const module = createNip42Module({ relayUrls: ["wss://test.com"] })
      expect(module.policies.length).toBeGreaterThan(0)

      // The policy should shadow (not store) AUTH events
      const challenge = generateChallenge()
      const event = await createAuthEvent(challenge, "wss://test.com")

      const policy = module.policies[0]!
      // The rejectAuthKind policy doesn't require any services (Policy<never>)
      const result = await Effect.runPromise(
        policy({
          event,
          connectionId: "test",
          remoteAddress: undefined,
        }) as Effect.Effect<PolicyDecision>
      )

      expect(result._tag).toBe("Shadow")
    })

    it("should accept non-AUTH events", async () => {
      const module = createNip42Module({ relayUrls: ["wss://test.com"] })
      const policy = module.policies[0]!

      // Create a regular event (not AUTH)
      const layer = Layer.provide(EventServiceLive, CryptoServiceLive)
      const event = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const eventService = yield* EventService
            return yield* eventService.createEvent(
              {
                kind: 1 as EventKind,
                tags: [],
                content: "hello",
              },
              testPrivateKey
            )
          }),
          layer
        )
      )

      // The rejectAuthKind policy doesn't require any services (Policy<never>)
      const result = await Effect.runPromise(
        policy({
          event,
          connectionId: "test",
          remoteAddress: undefined,
        }) as Effect.Effect<PolicyDecision>
      )

      expect(result._tag).toBe("Accept")
    })
  })
})
