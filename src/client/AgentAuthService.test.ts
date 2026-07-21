/**
 * Tests for AgentAuthService (NIP-AA client helpers).
 */
import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import {
  AgentAuthService,
  AgentAuthServiceLive,
  attachOwnerAttestation,
  makeAgentAuthTemplate,
} from "./AgentAuthService.js"
import {
  authTagToArray,
  signAuthTag,
  AUTH_TAG_NAME,
} from "../services/OwnerAttestationService.js"
import { EventServiceLive } from "../services/EventService.js"
import { CryptoServiceLive } from "../services/CryptoService.js"
import { verifyAgentAuth } from "../core/NipAA.js"
import type { PrivateKey, PublicKey } from "../core/Schema.js"
import { AUTH_EVENT_KIND } from "../core/Schema.js"

const OWNER_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000001"
const OWNER_PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const AGENT_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000002" as PrivateKey
const AGENT_PUBKEY =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5" as PublicKey

const RELAY_URL = "wss://relay.example.com"
const CHALLENGE = "agent-auth-challenge"

const fullLayer = AgentAuthServiceLive.pipe(
  Layer.provide(EventServiceLive),
  Layer.provide(CryptoServiceLive)
)

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, AgentAuthService>
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, fullLayer)) as Promise<A>

describe("AgentAuthService", () => {
  describe("attachOwnerAttestation", () => {
    test("appends exactly one auth tag", async () => {
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "kind=1", OWNER_SECKEY)
      )
      const tags = attachOwnerAttestation(
        [
          ["relay", RELAY_URL],
          ["challenge", CHALLENGE],
        ],
        tag
      )
      expect(tags).toHaveLength(3)
      expect(tags[0]).toEqual(["relay", RELAY_URL])
      expect(tags[1]).toEqual(["challenge", CHALLENGE])
      expect(tags[2]).toEqual(authTagToArray(tag))
    })

    test("replaces existing auth tags so only one remains", async () => {
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "", OWNER_SECKEY)
      )
      const tags = attachOwnerAttestation(
        [
          ["relay", RELAY_URL],
          ["auth", "old", "c", "s"],
          ["challenge", CHALLENGE],
          ["auth", "other", "c2", "s2"],
        ],
        authTagToArray(tag)
      )
      const authTags = tags.filter((t) => t[0] === AUTH_TAG_NAME)
      expect(authTags).toHaveLength(1)
      expect(authTags[0]).toEqual(authTagToArray(tag))
      expect(tags.find((t) => t[0] === "relay")).toEqual(["relay", RELAY_URL])
      expect(tags.find((t) => t[0] === "challenge")).toEqual([
        "challenge",
        CHALLENGE,
      ])
    })
  })

  describe("makeAgentAuthTemplate", () => {
    test("builds kind 22242 template with relay, challenge, and auth tags", async () => {
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "kind=1", OWNER_SECKEY)
      )
      const template = makeAgentAuthTemplate(
        RELAY_URL,
        CHALLENGE,
        tag,
        1_713_956_400
      )
      expect(template.kind as number).toBe(22242)
      expect(template.created_at as number).toBe(1_713_956_400)
      expect(template.content).toBe("")
      expect(template.tags).toHaveLength(3)
      expect(template.tags[0]).toEqual(["relay", RELAY_URL])
      expect(template.tags[1]).toEqual(["challenge", CHALLENGE])
      expect(template.tags[2]?.[0]).toBe("auth")
    })
  })

  describe("buildAuthEvent", () => {
    test("signs a kind 22242 event that passes verifyAgentAuth", async () => {
      const now = Math.floor(Date.now() / 1000)
      const event = await runWithService(
        Effect.gen(function* () {
          const svc = yield* AgentAuthService
          const authTag = yield* svc.signOwnerAuth({
            agentPubkey: AGENT_PUBKEY,
            conditions: "kind=1",
            ownerSeckey: OWNER_SECKEY,
          })
          return yield* svc.buildAuthEvent({
            challenge: CHALLENGE,
            relayUrl: RELAY_URL,
            agentSeckey: AGENT_SECKEY,
            ownerAuthTag: authTag,
            createdAt: now,
          })
        })
      )

      expect(event.kind as number).toBe(AUTH_EVENT_KIND as number)
      expect(event.pubkey).toBe(AGENT_PUBKEY)
      expect(event.tags.filter((t) => t[0] === "auth")).toHaveLength(1)
      expect(event.tags.find((t) => t[0] === "relay")?.[1]).toBe(RELAY_URL)
      expect(event.tags.find((t) => t[0] === "challenge")?.[1]).toBe(
        CHALLENGE
      )

      const result = await Effect.runPromise(
        verifyAgentAuth({
          authEvent: event,
          challenge: CHALLENGE,
          relayUrl: RELAY_URL,
          isActiveMember: (pk) => pk === OWNER_PUBKEY,
          now,
        })
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.kind).toBe("virtual")
        if (result.kind === "virtual") {
          expect(result.ownerPubkey).toBe(OWNER_PUBKEY)
          expect(result.agentPubkey).toBe(AGENT_PUBKEY)
        }
      }
    })

    test("accepts raw wire-form ownerAuthTag", async () => {
      const now = Math.floor(Date.now() / 1000)
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "", OWNER_SECKEY)
      )
      const event = await runWithService(
        Effect.gen(function* () {
          const svc = yield* AgentAuthService
          return yield* svc.buildAuthEvent({
            challenge: CHALLENGE,
            relayUrl: RELAY_URL,
            agentSeckey: AGENT_SECKEY,
            ownerAuthTag: authTagToArray(tag),
            createdAt: now,
          })
        })
      )
      expect(event.tags.some((t) => t[0] === "auth")).toBe(true)
    })
  })
})
