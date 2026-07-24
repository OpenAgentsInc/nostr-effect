/**
 * Tests for NIP-AA (Agent Authentication) verification algorithm.
 *
 * Covers: virtual membership happy path, missing/bad auth, non-member owner,
 * direct member bypass, and kind= not evaluated at admission.
 */
import { test, expect, describe } from "vite-plus/test"
import { Effect, Layer } from "effect"
import { schnorr } from "@noble/curves/secp256k1"
import { bytesToHex } from "@noble/hashes/utils"
import {
  verifyAgentAuth,
  verifyAgentAuthSync,
  DEFAULT_MAX_AUTH_AGE_SECONDS,
  type AgentAuthResult,
} from "./NipAA.js"
import {
  authTagToArray,
  signAuthTag,
} from "../services/OwnerAttestationService.js"
import {
  EventService,
  EventServiceLive,
} from "../services/EventService.js"
import { CryptoServiceLive } from "../services/CryptoService.js"
import {
  type NostrEvent,
  type PrivateKey,
  type Tag,
  type UnixTimestamp,
  type EventKind,
  AUTH_EVENT_KIND,
} from "./Schema.js"

// -----------------------------------------------------------------------------
// Spec vectors (NIP-OA / NIP-AA)
// -----------------------------------------------------------------------------

const OWNER_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000001"
const OWNER_PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const AGENT_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000002" as PrivateKey
const AGENT_PUBKEY =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"

const RELAY_URL = "wss://relay.example.com"
const CHALLENGE = "test-challenge-nonce-aa"

const serviceLayer = Layer.provide(EventServiceLive, CryptoServiceLive)

const createAuthEvent = async (options: {
  privateKey?: PrivateKey
  challenge?: string
  relayUrl?: string
  tags?: Tag[]
  createdAt?: number
  kind?: number
}): Promise<NostrEvent> => {
  const privKey = options.privateKey ?? AGENT_SECKEY
  const challenge = options.challenge ?? CHALLENGE
  const relayUrl = options.relayUrl ?? RELAY_URL
  const kind = (options.kind ?? AUTH_EVENT_KIND) as EventKind

  const baseTags: Tag[] = options.tags ?? ([
    ["relay", relayUrl],
    ["challenge", challenge],
  ] as unknown as Tag[])

  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const eventService = yield* EventService
        return yield* eventService.createEvent(
          {
            kind,
            tags: baseTags,
            content: "",
            ...(options.createdAt !== undefined
              ? { created_at: options.createdAt as UnixTimestamp }
              : {}),
          },
          privKey
        )
      }),
      serviceLayer
    )
  )
}

const runVerify = (
  params: Parameters<typeof verifyAgentAuth>[0]
): Promise<AgentAuthResult> => Effect.runPromise(verifyAgentAuth(params))

describe("NipAA", () => {
  test("DEFAULT_MAX_AUTH_AGE_SECONDS is 120 (NIP-AA recommendation)", () => {
    expect(DEFAULT_MAX_AUTH_AGE_SECONDS).toBe(120)
  })

  test("agent pubkey matches vector secret", () => {
    const derived = bytesToHex(
      schnorr.getPublicKey(
        Uint8Array.from(Buffer.from(AGENT_SECKEY, "hex"))
      )
    )
    expect(derived).toBe(AGENT_PUBKEY)
  })

  // ---------------------------------------------------------------------------
  // Happy path — virtual membership
  // ---------------------------------------------------------------------------

  describe("virtual membership (happy path)", () => {
    test("grants virtual membership when owner is active member", async () => {
      const now = 1_713_956_400
      const conditions = `kind=1&created_at<${now + 600}`
      const authTag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, conditions, OWNER_SECKEY)
      )
      const event = await createAuthEvent({
        createdAt: now,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          authTagToArray(authTag),
        ] as unknown as Tag[],
      })

      const members = new Set([OWNER_PUBKEY])
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk) => members.has(pk),
        now,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.kind).toBe("virtual")
        if (result.kind === "virtual") {
          expect(result.ownerPubkey).toBe(OWNER_PUBKEY)
          expect(result.agentPubkey).toBe(AGENT_PUBKEY)
        }
      }
    })

    test("verifyAgentAuthSync matches async form", async () => {
      const now = 1_713_956_400
      const authTag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "created_at<" + (now + 1000), OWNER_SECKEY)
      )
      const event = await createAuthEvent({
        createdAt: now,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          authTagToArray(authTag),
        ] as unknown as Tag[],
      })
      const params = {
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk: string) => pk === OWNER_PUBKEY,
        now,
      }
      expect(verifyAgentAuthSync(params)).toEqual(
        await runVerify(params)
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Step 2 — direct member bypass
  // ---------------------------------------------------------------------------

  describe("direct member bypass", () => {
    test("grants member access without auth tag when agent is active member", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = await createAuthEvent({ createdAt: now })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk) => pk === AGENT_PUBKEY,
        now,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.kind).toBe("member")
        expect(result.agentPubkey).toBe(AGENT_PUBKEY)
      }
    })

    test("member path ignores invalid extra auth tags", async () => {
      // Step 2 short-circuits before credential checks
      const now = Math.floor(Date.now() / 1000)
      const event = await createAuthEvent({
        createdAt: now,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          ["auth", "deadbeef", "kind=1", "00".repeat(64)],
        ] as unknown as Tag[],
      })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk) => pk === AGENT_PUBKEY,
        now,
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.kind).toBe("member")
    })
  })

  // ---------------------------------------------------------------------------
  // Step 3 — missing / multiple auth tags
  // ---------------------------------------------------------------------------

  describe("credential extraction", () => {
    test("rejects missing auth tag with restricted: prefix", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = await createAuthEvent({ createdAt: now })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: () => false,
        now,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("restricted:")).toBe(true)
        expect(result.error).toContain("missing auth tag")
      }
    })

    test("rejects multiple auth tags", async () => {
      const now = Math.floor(Date.now() / 1000)
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "", OWNER_SECKEY)
      )
      const wire = authTagToArray(tag)
      const event = await createAuthEvent({
        createdAt: now,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          wire,
          wire,
        ] as unknown as Tag[],
      })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk) => pk === OWNER_PUBKEY,
        now,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("restricted:")).toBe(true)
        expect(result.error).toContain("multiple auth tags")
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Step 4 — bad signature / self-attestation / conditions window
  // ---------------------------------------------------------------------------

  describe("credential verification", () => {
    test("rejects bad auth tag signature", async () => {
      const now = Math.floor(Date.now() / 1000)
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "", OWNER_SECKEY)
      )
      // Tamper with the signature
      const bad = authTagToArray(tag)
      bad[3] = "ff".repeat(64)
      const event = await createAuthEvent({
        createdAt: now,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          bad,
        ] as unknown as Tag[],
      })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk) => pk === OWNER_PUBKEY,
        now,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("restricted:")).toBe(true)
        expect(result.error).toContain("signature")
      }
    })

    test("rejects when created_at window is violated", async () => {
      // Spec example: created_at=1713957001 with created_at<1713957000
      const deadline = 1_713_957_000
      const createdAt = deadline + 1
      const conditions = `created_at<${deadline}`
      const authTag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, conditions, OWNER_SECKEY)
      )
      const event = await createAuthEvent({
        createdAt,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          authTagToArray(authTag),
        ] as unknown as Tag[],
      })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk) => pk === OWNER_PUBKEY,
        now: createdAt,
        maxAuthAge: 600,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("restricted:")).toBe(true)
        expect(result.error).toContain("created_at")
      }
    })

    test("kind= is NOT required at admission (kind=1 credential grants access)", async () => {
      // AUTH event is kind 22242, but credential has kind=1 — still accepted
      const now = Math.floor(Date.now() / 1000)
      const authTag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "kind=1", OWNER_SECKEY)
      )
      const event = await createAuthEvent({
        createdAt: now,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          authTagToArray(authTag),
        ] as unknown as Tag[],
      })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk) => pk === OWNER_PUBKEY,
        now,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.kind).toBe("virtual")
      }
    })

    test("kind=1&kind=7 (unsatisfiable conjunct) still grants connection access", async () => {
      const now = Math.floor(Date.now() / 1000)
      const authTag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "kind=1&kind=7", OWNER_SECKEY)
      )
      const event = await createAuthEvent({
        createdAt: now,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          authTagToArray(authTag),
        ] as unknown as Tag[],
      })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: (pk) => pk === OWNER_PUBKEY,
        now,
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.kind).toBe("virtual")
    })
  })

  // ---------------------------------------------------------------------------
  // Step 5 — owner membership
  // ---------------------------------------------------------------------------

  describe("owner membership", () => {
    test("rejects when owner is not an active member", async () => {
      const now = Math.floor(Date.now() / 1000)
      const authTag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "", OWNER_SECKEY)
      )
      const event = await createAuthEvent({
        createdAt: now,
        tags: [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
          authTagToArray(authTag),
        ] as unknown as Tag[],
      })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: () => false,
        now,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("restricted:")).toBe(true)
        expect(result.error).toContain("owner is not an active member")
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Step 1 — NIP-42 failures use invalid: prefix
  // ---------------------------------------------------------------------------

  describe("NIP-42 failures", () => {
    test("challenge mismatch → invalid:", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = await createAuthEvent({ createdAt: now })
      const result = await runVerify({
        authEvent: event,
        challenge: "wrong-challenge",
        relayUrl: RELAY_URL,
        isActiveMember: () => false,
        now,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("invalid:")).toBe(true)
        expect(result.error).toContain("challenge")
      }
    })

    test("stale created_at → invalid:", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = await createAuthEvent({ createdAt: now - 1000 })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: () => false,
        now,
        maxAuthAge: 120,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("invalid:")).toBe(true)
        expect(result.error).toContain("too old")
      }
    })

    test("wrong kind → invalid:", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = await createAuthEvent({ createdAt: now, kind: 1 })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: () => false,
        now,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("invalid:")).toBe(true)
      }
    })

    test("relay URL mismatch → invalid:", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = await createAuthEvent({
        createdAt: now,
        relayUrl: "wss://other.example.com",
      })
      const result = await runVerify({
        authEvent: event,
        challenge: CHALLENGE,
        relayUrl: RELAY_URL,
        isActiveMember: () => false,
        now,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.startsWith("invalid:")).toBe(true)
        expect(result.error).toContain("relay")
      }
    })
  })
})
