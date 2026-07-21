/**
 * AgentAuthService
 *
 * NIP-AA: Agent Authentication (client side).
 *
 * Builds NIP-42 AUTH events (kind 22242) that carry a NIP-OA `auth` tag so an
 * agent can obtain virtual membership on a NIP-43 membership-enforcing relay
 * when its owner is an active member.
 *
 * Flow:
 * 1. Owner signs a NIP-OA `auth` tag for the agent (via OwnerAttestationService).
 * 2. Agent builds a kind:22242 event with `relay` + `challenge` tags and the
 *    single `auth` tag, then signs with the agent secret key.
 * 3. Relay runs `verifyAgentAuth` (see `src/core/NipAA.ts`).
 *
 * This NIP reuses kind 22242 — it defines no new event kinds.
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-AA.md
 */
import { Context, Effect, Layer } from "effect"
import { EventService } from "../services/EventService.js"
import {
  AUTH_TAG_NAME,
  authTagToArray,
  signAuthTag,
  type AuthTag,
  Nip0aError,
} from "../services/OwnerAttestationService.js"
import {
  type NostrEvent,
  type PrivateKey,
  type Tag,
  type UnixTimestamp,
  AUTH_EVENT_KIND,
} from "../core/Schema.js"
import type { CryptoError, InvalidPrivateKey } from "../core/Errors.js"
import { CLIENT_AUTH_KIND, type EventTemplate } from "../core/Nip42.js"

// =============================================================================
// Types
// =============================================================================

export interface BuildAuthEventParams {
  /** Challenge nonce from the relay's AUTH message. */
  readonly challenge: string
  /** Relay URL to bind the AUTH event to (NIP-42 `relay` tag). */
  readonly relayUrl: string
  /** Agent secret key (signs the kind:22242 event). */
  readonly agentSeckey: PrivateKey
  /**
   * Pre-signed NIP-OA `auth` tag (parsed or raw 4-element array).
   * Exactly one such tag is attached to the AUTH event.
   */
  readonly ownerAuthTag: AuthTag | ReadonlyArray<string>
  /** Optional created_at override (unix seconds). Defaults to now. */
  readonly createdAt?: UnixTimestamp | number
}

export interface SignOwnerAuthParams {
  /** Agent public key that the owner is authorizing. */
  readonly agentPubkey: string
  /** NIP-OA conditions string (signed verbatim). Empty string is valid. */
  readonly conditions: string
  /** Owner secret key that signs the attestation. */
  readonly ownerSeckey: string
}

// =============================================================================
// Pure helpers
// =============================================================================

/** Convert a parsed or wire-form auth tag into the 4-element wire array. */
const toAuthTagWire = (
  authTag: AuthTag | ReadonlyArray<string>
): [string, string, string, string] => {
  if (Array.isArray(authTag)) {
    const arr = authTag as ReadonlyArray<string>
    return [AUTH_TAG_NAME, arr[1] ?? "", arr[2] ?? "", arr[3] ?? ""]
  }
  return authTagToArray(authTag as AuthTag)
}

/**
 * Attach exactly one NIP-OA `auth` tag to a tag list intended for a NIP-42
 * AUTH event. Replaces any existing `auth` tags so the result always has
 * exactly one.
 *
 * Does not validate the tag cryptographically — that is the relay's job.
 */
export const attachOwnerAttestation = (
  authEventTags: ReadonlyArray<ReadonlyArray<string>>,
  authTag: AuthTag | ReadonlyArray<string>
): string[][] => {
  const wire = toAuthTagWire(authTag)
  return [
    ...authEventTags.filter((t) => t[0] !== AUTH_TAG_NAME).map((t) => [...t]),
    wire,
  ]
}

/**
 * Build an unsigned NIP-42 AUTH event template with relay + challenge tags
 * and exactly one NIP-OA `auth` tag attached.
 */
export const makeAgentAuthTemplate = (
  relayUrl: string,
  challenge: string,
  ownerAuthTag: AuthTag | ReadonlyArray<string>,
  createdAt?: number
): EventTemplate => {
  const baseTags: string[][] = [
    ["relay", relayUrl],
    ["challenge", challenge],
  ]
  const tags = attachOwnerAttestation(baseTags, ownerAuthTag)
  return {
    kind: CLIENT_AUTH_KIND,
    created_at: (createdAt ?? Math.floor(Date.now() / 1000)) as UnixTimestamp,
    tags,
    content: "",
  }
}

// =============================================================================
// Service interface
// =============================================================================

export interface AgentAuthService {
  readonly _tag: "AgentAuthService"

  /**
   * Build and sign a kind:22242 AUTH event carrying a NIP-OA `auth` tag.
   * The agent secret key signs the event; the owner previously signed the tag.
   */
  buildAuthEvent(
    params: BuildAuthEventParams
  ): Effect.Effect<NostrEvent, CryptoError | InvalidPrivateKey | Nip0aError>

  /**
   * Produce a NIP-OA `auth` tag authorizing `agentPubkey` under `conditions`,
   * signed by the owner. Convenience wrapper around OwnerAttestationService.sign.
   */
  signOwnerAuth(
    params: SignOwnerAuthParams
  ): Effect.Effect<AuthTag, Nip0aError>

  /**
   * Attach a NIP-OA `auth` tag to AUTH event tags (exactly one `auth` tag).
   */
  attachOwnerAttestation(
    authEventTags: ReadonlyArray<ReadonlyArray<string>>,
    authTag: AuthTag | ReadonlyArray<string>
  ): string[][]
}

// =============================================================================
// Service tag
// =============================================================================

export const AgentAuthService = Context.Service<AgentAuthService>(
  "AgentAuthService"
)

// =============================================================================
// Implementation
// =============================================================================

const normalizeAuthTagWire = (
  ownerAuthTag: AuthTag | ReadonlyArray<string>
): Effect.Effect<ReadonlyArray<string>, Nip0aError> => {
  // Raw 4-element wire tag
  if (Array.isArray(ownerAuthTag)) {
    const arr = ownerAuthTag as ReadonlyArray<string>
    if (arr.length !== 4 || arr[0] !== AUTH_TAG_NAME) {
      return Effect.fail(
        new Nip0aError({
          reason: "malformed_tag",
          message: `ownerAuthTag must be ["auth", owner, conditions, sig], got length ${arr.length}`,
        })
      )
    }
    return Effect.succeed(arr)
  }
  // Parsed AuthTag
  return Effect.succeed(authTagToArray(ownerAuthTag as AuthTag))
}

const make = Effect.gen(function* () {
  const eventService = yield* EventService

  const buildAuthEvent: AgentAuthService["buildAuthEvent"] = (params) =>
    Effect.gen(function* () {
      const wire = yield* normalizeAuthTagWire(params.ownerAuthTag)
      const template = makeAgentAuthTemplate(
        params.relayUrl,
        params.challenge,
        wire,
        params.createdAt !== undefined ? Number(params.createdAt) : undefined
      )
      return yield* eventService.createEvent(
        {
          kind: AUTH_EVENT_KIND,
          content: template.content,
          tags: template.tags as unknown as Tag[],
          created_at: template.created_at,
        },
        params.agentSeckey
      )
    })

  const signOwnerAuth: AgentAuthService["signOwnerAuth"] = (params) =>
    signAuthTag(params.agentPubkey, params.conditions, params.ownerSeckey)

  return {
    _tag: "AgentAuthService" as const,
    buildAuthEvent,
    signOwnerAuth,
    attachOwnerAttestation,
  } satisfies AgentAuthService
})

// =============================================================================
// Layer
// =============================================================================

export const AgentAuthServiceLive = Layer.effect(AgentAuthService, make)
