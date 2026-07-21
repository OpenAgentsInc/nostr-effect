/**
 * NIP-AA: Agent Authentication
 *
 * Defines how a relay that implements NIP-43 membership SHOULD handle
 * connection requests from agent keys that carry NIP-OA credentials. An agent
 * whose owner is a relay member MAY gain virtual membership by presenting a
 * NIP-OA `auth` tag during NIP-42 authentication (kind 22242).
 *
 * This module implements the relay verification algorithm (steps 1–6) as pure
 * Effect helpers. It reuses NIP-OA crypto for the `auth` tag but deliberately
 * does NOT evaluate `kind=` clauses at connection admission — only
 * `created_at</>` window clauses are checked (see NIP-AA §Kind Conditions).
 *
 * Error prefixes:
 * - Step 1 failures (malformed event / NIP-42): `invalid: <reason>`
 * - Steps 3–5 failures (credential / owner membership): `restricted: <reason>`
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-AA.md
 * @see NIP-OA (`OwnerAttestationService`), NIP-42 (`Nip42Module`)
 */
import { Effect } from "effect"
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import type { NostrEvent } from "./Schema.js"
import { AUTH_EVENT_KIND } from "./Schema.js"
import {
  AUTH_TAG_NAME,
  findAuthTag,
  parseConditions,
  type AuthTag,
} from "../services/OwnerAttestationService.js"

// =============================================================================
// Constants
// =============================================================================

/**
 * Recommended AUTH-event freshness window for NIP-AA (± seconds).
 * NIP-AA §Step 1: "A ±120-second window is RECOMMENDED."
 */
export const DEFAULT_MAX_AUTH_AGE_SECONDS = 120

// =============================================================================
// Result types
// =============================================================================

/** Direct membership grant (agent pubkey is already an active member). */
export interface AgentAuthMemberGrant {
  readonly ok: true
  readonly kind: "member"
  readonly agentPubkey: string
}

/**
 * Virtual membership grant — access derived from the owner's active
 * membership. MUST NOT create a persistent membership record for the agent.
 */
export interface AgentAuthVirtualGrant {
  readonly ok: true
  readonly kind: "virtual"
  readonly ownerPubkey: string
  readonly agentPubkey: string
}

/** Rejected AUTH attempt with a NIP-AA-prefixed error string. */
export interface AgentAuthReject {
  readonly ok: false
  /** Message with `invalid:` or `restricted:` prefix per the verification algorithm. */
  readonly error: string
}

export type AgentAuthResult =
  | AgentAuthMemberGrant
  | AgentAuthVirtualGrant
  | AgentAuthReject

// =============================================================================
// Params
// =============================================================================

export interface VerifyAgentAuthParams {
  /** The kind:22242 AUTH event presented by the client. */
  readonly authEvent: NostrEvent
  /** Challenge nonce previously issued to this connection. */
  readonly challenge: string
  /**
   * This relay's URL, or a list of acceptable URLs (e.g. dual-stack / aliases).
   * Matched against the AUTH event's `relay` tag (domain-level, per NIP-42).
   */
  readonly relayUrl: string | readonly string[]
  /**
   * Authoritative active-member lookup. Virtual members MUST return false.
   * NIP-43 kind:13534 advertisements are not themselves authoritative.
   */
  readonly isActiveMember: (pubkey: string) => boolean
  /**
   * Maximum absolute age of the AUTH event's `created_at` vs wall clock, in
   * seconds. Defaults to {@link DEFAULT_MAX_AUTH_AGE_SECONDS} (120).
   */
  readonly maxAuthAge?: number
  /**
   * Wall-clock override (unix seconds). Defaults to `Math.floor(Date.now()/1000)`.
   * Useful in tests.
   */
  readonly now?: number
}

// =============================================================================
// URL helpers (mirrors Nip42Module; kept local so core stays free of relay deps)
// =============================================================================

const normalizeRelayUrl = (url: string): string => {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase()
  } catch {
    return url.toLowerCase().replace(/\/$/, "")
  }
}

const urlsMatch = (url1: string, url2: string): boolean => {
  try {
    const parsed1 = new URL(url1)
    const parsed2 = new URL(url2)
    // NIP-42: domain match is sufficient for most cases
    return parsed1.host.toLowerCase() === parsed2.host.toLowerCase()
  } catch {
    return url1 === url2
  }
}

// =============================================================================
// Event crypto (sync NIP-01 id + BIP-340 sig)
// =============================================================================

const utf8Encoder = new TextEncoder()

const computeEventId = (event: NostrEvent): string => {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ])
  return bytesToHex(sha256(utf8Encoder.encode(serialized)))
}

const verifyEventIdAndSig = (event: NostrEvent): boolean => {
  try {
    if (!event.id || !event.pubkey || !event.sig) return false
    if (computeEventId(event) !== event.id) return false
    return schnorr.verify(
      hexToBytes(event.sig),
      hexToBytes(event.id),
      hexToBytes(event.pubkey)
    )
  } catch {
    return false
  }
}

// =============================================================================
// OA crypto (signature only — kind= clauses intentionally skipped)
// =============================================================================

const signedMessage = (agentPubkey: string, conditions: string): Uint8Array => {
  const preimage = `nostr:agent-auth:${agentPubkey}:${conditions}`
  return sha256(utf8Encoder.encode(preimage))
}

/**
 * Verify the owner Schnorr signature on a parsed `auth` tag for the given
 * agent pubkey. Does not evaluate condition clauses.
 */
const verifyOwnerSignature = (
  authTag: AuthTag,
  agentPubkey: string
): boolean => {
  try {
    const message = signedMessage(agentPubkey, authTag.conditions)
    return schnorr.verify(
      hexToBytes(authTag.sig),
      message,
      hexToBytes(authTag.ownerPubkey)
    )
  } catch {
    return false
  }
}

// =============================================================================
// Prefix helpers
// =============================================================================

const invalid = (reason: string): AgentAuthReject => ({
  ok: false,
  error: `invalid: ${reason}`,
})

const restricted = (reason: string): AgentAuthReject => ({
  ok: false,
  error: `restricted: ${reason}`,
})

// =============================================================================
// Verification algorithm (steps 1–6)
// =============================================================================

/**
 * Execute the NIP-AA relay verification algorithm against an AUTH event.
 *
 * Returns a structured result:
 * - `{ ok: true, kind: "member", ... }` when the agent is already an active member
 * - `{ ok: true, kind: "virtual", ownerPubkey, agentPubkey }` when NIP-OA credential + owner membership pass
 * - `{ ok: false, error }` with `invalid:` or `restricted:` prefix on failure
 *
 * `kind=` clauses in the credential are NOT evaluated at admission.
 */
export const verifyAgentAuth = (
  params: VerifyAgentAuthParams
): Effect.Effect<AgentAuthResult> =>
  Effect.gen(function* () {
    const {
      authEvent,
      challenge,
      isActiveMember,
      maxAuthAge = DEFAULT_MAX_AUTH_AGE_SECONDS,
    } = params
    const now = params.now ?? Math.floor(Date.now() / 1000)
    const relayUrls = Array.isArray(params.relayUrl)
      ? params.relayUrl
      : [params.relayUrl as string]

    // -------------------------------------------------------------------------
    // Step 1 — Standard NIP-42 verification
    // -------------------------------------------------------------------------
    if (authEvent.kind !== AUTH_EVENT_KIND) {
      return invalid(
        `expected kind ${AUTH_EVENT_KIND}, got ${authEvent.kind}`
      )
    }

    const age = Math.abs(now - authEvent.created_at)
    if (age > maxAuthAge) {
      return invalid(`auth event too old (${age}s > ${maxAuthAge}s)`)
    }

    const challengeTag = authEvent.tags.find((tag) => tag[0] === "challenge")
    if (!challengeTag || challengeTag[1] !== challenge) {
      return invalid("challenge mismatch")
    }

    const relayTag = authEvent.tags.find((tag) => tag[0] === "relay")
    if (!relayTag || !relayTag[1]) {
      return invalid("missing relay tag")
    }

    const eventRelayUrl = normalizeRelayUrl(relayTag[1])
    const normalizedRelayUrls = relayUrls.map(normalizeRelayUrl)
    if (!normalizedRelayUrls.some((url) => urlsMatch(url, eventRelayUrl))) {
      return invalid("relay URL mismatch")
    }

    if (!verifyEventIdAndSig(authEvent)) {
      return invalid("signature verification failed")
    }

    const agentPubkey = authEvent.pubkey

    // -------------------------------------------------------------------------
    // Step 2 — Direct membership check
    // -------------------------------------------------------------------------
    if (isActiveMember(agentPubkey)) {
      return {
        ok: true,
        kind: "member",
        agentPubkey,
      } satisfies AgentAuthMemberGrant
    }

    // -------------------------------------------------------------------------
    // Step 3 — NIP-OA credential extraction
    // -------------------------------------------------------------------------
    const authTags = authEvent.tags.filter((t) => t[0] === AUTH_TAG_NAME)
    if (authTags.length === 0) {
      return restricted("missing auth tag")
    }
    if (authTags.length > 1) {
      return restricted("multiple auth tags")
    }

    // -------------------------------------------------------------------------
    // Step 4 — NIP-OA credential verification (NIP-AA-specific)
    // -------------------------------------------------------------------------
    // Parse tag shape + conditions; surface malformed as restricted.
    const parseResult = yield* findAuthTag(authEvent.tags).pipe(
      Effect.map((tag) => ({ _tag: "ok" as const, tag })),
      Effect.catch((err) =>
        Effect.succeed({
          _tag: "err" as const,
          message: err.message,
        })
      )
    )
    if (parseResult._tag === "err") {
      return restricted(`invalid auth tag: ${parseResult.message}`)
    }
    const authTag = parseResult.tag

    // Self-attestation forbidden
    if (authTag.ownerPubkey === agentPubkey) {
      return restricted("self-attestation: owner key equals agent key")
    }

    // Schnorr signature over preimage (conditions used verbatim)
    if (!verifyOwnerSignature(authTag, agentPubkey)) {
      return restricted("auth tag signature verification failed")
    }

    // Evaluate created_at</> only — kind= is intentionally NOT checked at admission
    const clauses = yield* parseConditions(authTag.conditions).pipe(
      Effect.catch(() => Effect.succeed(null as null))
    )
    // parseConditions already succeeded inside findAuthTag/parseAuthTag, but
    // re-parse for the clause list; if somehow invalid, reject.
    if (clauses === null) {
      return restricted("invalid auth tag conditions")
    }

    for (const clause of clauses) {
      switch (clause._tag) {
        case "kind":
          // NIP-AA §Kind Conditions: not evaluated at connection admission.
          break
        case "created_at<":
          if (!(authEvent.created_at < clause.value)) {
            return restricted(
              `auth event created_at ${authEvent.created_at} does not satisfy created_at<${clause.value}`
            )
          }
          break
        case "created_at>":
          if (!(authEvent.created_at > clause.value)) {
            return restricted(
              `auth event created_at ${authEvent.created_at} does not satisfy created_at>${clause.value}`
            )
          }
          break
      }
    }

    // -------------------------------------------------------------------------
    // Step 5 — Owner membership check
    // -------------------------------------------------------------------------
    if (!isActiveMember(authTag.ownerPubkey)) {
      return restricted("owner is not an active member")
    }

    // -------------------------------------------------------------------------
    // Step 6 — Grant virtual membership
    // -------------------------------------------------------------------------
    return {
      ok: true,
      kind: "virtual",
      ownerPubkey: authTag.ownerPubkey,
      agentPubkey,
    } satisfies AgentAuthVirtualGrant
  })

/**
 * Convenience: run {@link verifyAgentAuth} and return the result synchronously.
 * Prefer the Effect form when composing with other Effect pipelines.
 */
export const verifyAgentAuthSync = (
  params: VerifyAgentAuthParams
): AgentAuthResult => Effect.runSync(verifyAgentAuth(params))
