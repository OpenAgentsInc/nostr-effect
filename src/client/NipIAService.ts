/**
 * NipIAService
 *
 * NIP-IA: Identity Archival.
 *
 * Relay-scoped protocol for archiving and unarchiving identities. An archived
 * identity is a pubkey the relay says should be hidden from active-member and
 * autocomplete surfaces on that relay, while preserving historical events and
 * without implying global reputation.
 *
 * Event families:
 * - user-signed requests: `kind:9035` archive, `kind:9036` unarchive
 * - relay-signed deltas: `kind:8002` archived, `kind:8003` unarchived
 * - relay-signed snapshot: `kind:13535` archived identities list (replaceable)
 *
 * Requests and relay projections carry NIP-70 `-` tags. Owner-of-agent requests
 * reuse NIP-OA `auth` tags; verification substitutes the **target** pubkey into
 * the NIP-OA preimage (not the request signer).
 *
 * This module implements client builders/parsers and verification of
 * relay-signed projections. A full relay authorization state machine is out of
 * scope here (relays MAY accept requests under local policy).
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-IA.md
 */
import { Context, Effect, Layer, Schema } from "effect"
import { EventService } from "../services/EventService.js"
import {
  OwnerAttestationService,
  authTagToArray,
  parseConditions,
  type AuthTag,
  type Nip0aError,
} from "../services/OwnerAttestationService.js"
import {
  EventKind,
  Tag,
  type NostrEvent,
  type PrivateKey,
} from "../core/Schema.js"
import {
  ArchiveRequest as ArchiveRequestKind,
  UnarchiveRequest as UnarchiveRequestKind,
  ArchivedIdentity as ArchivedIdentityKind,
  UnarchivedIdentity as UnarchivedIdentityKind,
  ArchivedIdentitiesList as ArchivedIdentitiesListKind,
} from "../wrappers/kinds.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

// =============================================================================
// Constants
// =============================================================================

/** Archive request kind (user/agent-signed). */
export const ARCHIVE_REQUEST_KIND = ArchiveRequestKind // 9035
/** Unarchive request kind (user/agent-signed). */
export const UNARCHIVE_REQUEST_KIND = UnarchiveRequestKind // 9036
/** Archived-identity delta kind (relay-signed). */
export const ARCHIVED_IDENTITY_KIND = ArchivedIdentityKind // 8002
/** Unarchived-identity delta kind (relay-signed). */
export const UNARCHIVED_IDENTITY_KIND = UnarchivedIdentityKind // 8003
/** Archived identities list snapshot kind (relay-signed, replaceable). */
export const ARCHIVED_IDENTITIES_LIST_KIND = ArchivedIdentitiesListKind // 13535

/** NIP-70 protected-event marker tag name. */
export const NIP70_TAG = "-"

/** Consent paths accepted on relay deltas. */
export const CONSENT_PATHS = ["self", "owner", "admin", "relay"] as const
export type ConsentPath = (typeof CONSENT_PATHS)[number]

/** Suggested machine-readable reason codes (non-exhaustive). */
export const REASON_CODES = [
  "rotated",
  "retired",
  "bot-rebuilt",
  "left-organization",
  "spam",
  "returned",
] as const
export type ReasonCode = (typeof REASON_CODES)[number] | string

const HEX64 = /^[0-9a-f]{64}$/

// =============================================================================
// Errors
// =============================================================================

/**
 * Tagged error channel for NIP-IA build/parse/verify failures.
 *
 * - `malformed`: missing/duplicate tags, invalid hex, wrong kind, etc.
 * - `unauthorized`: owner-of-agent proof failed policy checks
 * - `wrong_signer`: event not signed by the expected relay identity
 * - `unprotected`: missing NIP-70 `-` tag
 */
export class NipIaError extends Schema.TaggedErrorClass<NipIaError>()(
  "NipIaError",
  {
    reason: Schema.Literals([
      "malformed",
      "unauthorized",
      "wrong_signer",
      "unprotected",
    ]),
    message: Schema.String,
  }
) {}

const malformed = (message: string): NipIaError =>
  new NipIaError({ reason: "malformed", message })

const unauthorized = (message: string): NipIaError =>
  new NipIaError({ reason: "unauthorized", message })

const wrongSigner = (message: string): NipIaError =>
  new NipIaError({ reason: "wrong_signer", message })

const unprotected = (message: string): NipIaError =>
  new NipIaError({ reason: "unprotected", message })

// =============================================================================
// Types
// =============================================================================

/** Parsed consent tag from a relay delta. */
export interface ConsentTag {
  readonly path: ConsentPath
  /** Actor or owner pubkey when present (required for self/owner/admin). */
  readonly actorPubkey?: string | undefined
}

/** Optional fields shared by archive/unarchive requests. */
export interface RequestOptions {
  /** Target pubkey being archived/unarchived (64-char lowercase hex). */
  readonly target: string
  /** Optional human-readable reason in `content`. */
  readonly content?: string | undefined
  /** Optional machine-readable reason code tag. */
  readonly reason?: string | undefined
  /**
   * Replacement pubkey for key rotation (archive only). MUST be valid hex and
   * MUST NOT equal the target.
   */
  readonly replacedBy?: string | undefined
  /**
   * Pre-built NIP-OA `auth` tag for owner-of-agent requests. Prefer
   * {@link OwnerAttestationService.sign}.
   */
  readonly authTag?: AuthTag | ReadonlyArray<string> | undefined
  /** Override `created_at` (seconds). Defaults to now when signed. */
  readonly createdAt?: number | undefined
}

/** Options for building a relay-signed archive/unarchive delta. */
export interface DeltaOptions {
  readonly target: string
  readonly consent: ConsentTag
  /** Request event id that caused this delta, when applicable. */
  readonly requestEventId?: string | undefined
  readonly content?: string | undefined
  readonly reason?: string | undefined
  /** Replacement pubkey (archive deltas only). */
  readonly replacedBy?: string | undefined
  readonly createdAt?: number | undefined
}

/** Options for building a relay-signed archived-identities snapshot. */
export interface SnapshotOptions {
  /** Pubkeys currently archived on this relay. */
  readonly archived: readonly string[]
  readonly content?: string | undefined
  readonly createdAt?: number | undefined
}

/** Parsed archive/unarchive request. */
export interface ParsedArchiveRequest {
  readonly kind: typeof ARCHIVE_REQUEST_KIND | typeof UNARCHIVE_REQUEST_KIND
  readonly actor: string
  readonly target: string
  readonly content: string
  readonly reason?: string | undefined
  readonly replacedBy?: string | undefined
  readonly authTag?: AuthTag | undefined
  readonly event: NostrEvent
}

/** Parsed relay delta (`8002` / `8003`). */
export interface ParsedArchiveDelta {
  readonly kind: typeof ARCHIVED_IDENTITY_KIND | typeof UNARCHIVED_IDENTITY_KIND
  readonly relayPubkey: string
  readonly target: string
  readonly consent: ConsentTag
  readonly requestEventId?: string | undefined
  readonly content: string
  readonly reason?: string | undefined
  readonly replacedBy?: string | undefined
  readonly event: NostrEvent
}

/** Parsed relay snapshot (`13535`). */
export interface ParsedArchiveSnapshot {
  readonly kind: typeof ARCHIVED_IDENTITIES_LIST_KIND
  readonly relayPubkey: string
  readonly archived: readonly string[]
  readonly content: string
  readonly event: NostrEvent
}

/** Unsigned event template (kind/content/tags/created_at). */
export interface NipIaEventTemplate {
  readonly kind: number
  readonly content: string
  readonly tags: string[][]
  readonly created_at: number
}


// =============================================================================
// Pure helpers
// =============================================================================

/** True when `value` is a 64-character lowercase hex pubkey/id. */
const isHex64 = (value: string): boolean => HEX64.test(value)

/** True when the event carries exactly one NIP-70 `-` tag. */
export const hasNip70Tag = (
  tags: readonly (readonly string[])[]
): boolean => tags.filter((t) => t[0] === NIP70_TAG).length === 1

/** Extract the single `p` tag value, or fail if missing/ambiguous/invalid. */
export const extractSinglePTag = (
  tags: readonly (readonly string[])[]
): Effect.Effect<string, NipIaError> => {
  const pTags = tags.filter((t) => t[0] === "p" && t[1] !== undefined)
  if (pTags.length === 0) {
    return Effect.fail(malformed("exactly one p tag is required (got 0)"))
  }
  if (pTags.length > 1) {
    return Effect.fail(
      malformed(`exactly one p tag is required (got ${pTags.length})`)
    )
  }
  const pubkey = pTags[0]![1]!
  if (!isHex64(pubkey)) {
    return Effect.fail(
      malformed("p tag value must be 64-character lowercase hex")
    )
  }
  return Effect.succeed(pubkey)
}

/** Extract all bare `p` tag values (for snapshots); skips invalid entries. */
export const extractArchivePTags = (
  tags: readonly (readonly string[])[]
): readonly string[] => {
  const out: string[] = []
  for (const t of tags) {
    if (t[0] === "p" && t[1] !== undefined && isHex64(t[1])) {
      out.push(t[1])
    }
  }
  return out
}

/** Parse a `consent` tag: `["consent", path, actor?]`. */
export const parseConsentTag = (
  tags: readonly (readonly string[])[]
): Effect.Effect<ConsentTag, NipIaError> => {
  const consentTags = tags.filter((t) => t[0] === "consent")
  if (consentTags.length !== 1) {
    return Effect.fail(
      malformed(
        `exactly one consent tag is required (got ${consentTags.length})`
      )
    )
  }
  const tag = consentTags[0]!
  const path = tag[1]
  if (
    path !== "self" &&
    path !== "owner" &&
    path !== "admin" &&
    path !== "relay"
  ) {
    return Effect.fail(
      malformed(
        `consent path must be self|owner|admin|relay, got ${JSON.stringify(path)}`
      )
    )
  }
  const actorPubkey = tag[2]
  if (actorPubkey !== undefined && actorPubkey !== "" && !isHex64(actorPubkey)) {
    return Effect.fail(
      malformed("consent actor pubkey must be 64-character lowercase hex")
    )
  }
  if (path !== "relay" && (actorPubkey === undefined || actorPubkey === "")) {
    // Spec: self third element if present MUST equal target; owner/admin MUST
    // identify the actor. We require actor for non-relay paths for auditability.
    return Effect.fail(
      malformed(`consent=${path} requires an actor/owner pubkey`)
    )
  }
  return Effect.succeed(
    actorPubkey && actorPubkey !== ""
      ? { path, actorPubkey }
      : { path }
  )
}

/** First `reason` tag value, if any. */
export const extractReason = (
  tags: readonly (readonly string[])[]
): string | undefined => {
  const tag = tags.find((t) => t[0] === "reason" && t[1] !== undefined)
  return tag?.[1]
}

/** First `replaced-by` tag value, if any. */
export const extractReplacedBy = (
  tags: readonly (readonly string[])[]
): string | undefined => {
  const tag = tags.find((t) => t[0] === "replaced-by" && t[1] !== undefined)
  return tag?.[1]
}

/** First unmarked `e` tag (request reference on deltas). */
export const extractRequestEventId = (
  tags: readonly (readonly string[])[]
): string | undefined => {
  for (const t of tags) {
    if (t[0] !== "e" || t[1] === undefined) continue
    // Marked proof refs use ["e", id, "", "proof", ...]; skip those.
    if (t[3] === "proof") continue
    if (isHex64(t[1])) return t[1]
  }
  return undefined
}

/**
 * Normalize an AuthTag or wire array into a wire `auth` tag array.
 */
export const normalizeAuthTagArray = (
  auth: AuthTag | ReadonlyArray<string>
): Effect.Effect<ReadonlyArray<string>, NipIaError> => {
  if (Array.isArray(auth)) {
    if (auth.length !== 4 || auth[0] !== "auth") {
      return Effect.fail(
        malformed('auth tag must be ["auth", owner, conditions, sig]')
      )
    }
    return Effect.succeed(auth)
  }
  const tag = auth as AuthTag
  return Effect.succeed(authTagToArray(tag))
}

/**
 * Build tags for a `kind:9035` / `kind:9036` request.
 *
 * Always includes NIP-70 `-` and a single `p` target. Optional reason,
 * replaced-by (archive), and NIP-OA auth.
 */
export const buildRequestTags = (
  options: RequestOptions & { readonly allowReplacedBy: boolean }
): Effect.Effect<string[][], NipIaError> =>
  Effect.gen(function* () {
    if (!isHex64(options.target)) {
      return yield* Effect.fail(
        malformed("target must be 64-character lowercase hex")
      )
    }
    if (options.replacedBy !== undefined) {
      if (!options.allowReplacedBy) {
        return yield* Effect.fail(
          malformed("replaced-by has no meaning on unarchive requests")
        )
      }
      if (!isHex64(options.replacedBy)) {
        return yield* Effect.fail(
          malformed("replaced-by must be 64-character lowercase hex")
        )
      }
      if (options.replacedBy === options.target) {
        return yield* Effect.fail(
          malformed("replaced-by MUST NOT equal the target")
        )
      }
    }

    const tags: string[][] = [[NIP70_TAG], ["p", options.target]]
    if (options.reason !== undefined) {
      tags.push(["reason", options.reason])
    }
    if (options.replacedBy !== undefined) {
      tags.push(["replaced-by", options.replacedBy])
    }
    if (options.authTag !== undefined) {
      const auth = yield* normalizeAuthTagArray(options.authTag)
      tags.push([...auth])
    }
    return tags
  })

/** Build an unsigned archive request template (`kind:9035`). */
export const buildArchiveRequestTemplate = (
  options: RequestOptions
): Effect.Effect<NipIaEventTemplate, NipIaError> =>
  Effect.gen(function* () {
    const tags = yield* buildRequestTags({ ...options, allowReplacedBy: true })
    return {
      kind: ARCHIVE_REQUEST_KIND,
      content: options.content ?? "",
      tags,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
    }
  })

/** Build an unsigned unarchive request template (`kind:9036`). */
export const buildUnarchiveRequestTemplate = (
  options: RequestOptions
): Effect.Effect<NipIaEventTemplate, NipIaError> =>
  Effect.gen(function* () {
    const tags = yield* buildRequestTags({
      ...options,
      allowReplacedBy: false,
    })
    return {
      kind: UNARCHIVE_REQUEST_KIND,
      content: options.content ?? "",
      tags,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
    }
  })

/** Build an unsigned archive delta template (`kind:8002`). */
export const buildArchivedDeltaTemplate = (
  options: DeltaOptions
): Effect.Effect<NipIaEventTemplate, NipIaError> =>
  Effect.gen(function* () {
    if (!isHex64(options.target)) {
      return yield* Effect.fail(
        malformed("target must be 64-character lowercase hex")
      )
    }
    if (
      options.consent.path !== "self" &&
      options.consent.path !== "owner" &&
      options.consent.path !== "admin" &&
      options.consent.path !== "relay"
    ) {
      return yield* Effect.fail(malformed("invalid consent path"))
    }
    if (options.requestEventId !== undefined && !isHex64(options.requestEventId)) {
      return yield* Effect.fail(
        malformed("requestEventId must be 64-character lowercase hex")
      )
    }
    if (options.replacedBy !== undefined) {
      if (!isHex64(options.replacedBy)) {
        return yield* Effect.fail(
          malformed("replaced-by must be 64-character lowercase hex")
        )
      }
      if (options.replacedBy === options.target) {
        return yield* Effect.fail(
          malformed("replaced-by MUST NOT equal the target")
        )
      }
    }

    const tags: string[][] = [[NIP70_TAG], ["p", options.target]]
    if (options.consent.actorPubkey) {
      tags.push(["consent", options.consent.path, options.consent.actorPubkey])
    } else {
      tags.push(["consent", options.consent.path])
    }
    if (options.requestEventId !== undefined) {
      tags.push(["e", options.requestEventId])
    }
    if (options.reason !== undefined) {
      tags.push(["reason", options.reason])
    }
    if (options.replacedBy !== undefined) {
      tags.push(["replaced-by", options.replacedBy])
    }
    return {
      kind: ARCHIVED_IDENTITY_KIND,
      content: options.content ?? "",
      tags,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
    }
  })

/** Build an unsigned unarchive delta template (`kind:8003`). */
export const buildUnarchivedDeltaTemplate = (
  options: DeltaOptions
): Effect.Effect<NipIaEventTemplate, NipIaError> =>
  Effect.gen(function* () {
    if (!isHex64(options.target)) {
      return yield* Effect.fail(
        malformed("target must be 64-character lowercase hex")
      )
    }
    if (options.requestEventId !== undefined && !isHex64(options.requestEventId)) {
      return yield* Effect.fail(
        malformed("requestEventId must be 64-character lowercase hex")
      )
    }
    if (options.replacedBy !== undefined) {
      return yield* Effect.fail(
        malformed("replaced-by has no meaning on unarchive deltas")
      )
    }

    const tags: string[][] = [[NIP70_TAG], ["p", options.target]]
    if (options.consent.actorPubkey) {
      tags.push(["consent", options.consent.path, options.consent.actorPubkey])
    } else {
      tags.push(["consent", options.consent.path])
    }
    if (options.requestEventId !== undefined) {
      tags.push(["e", options.requestEventId])
    }
    if (options.reason !== undefined) {
      tags.push(["reason", options.reason])
    }
    return {
      kind: UNARCHIVED_IDENTITY_KIND,
      content: options.content ?? "",
      tags,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
    }
  })

/** Build an unsigned archived-identities list snapshot (`kind:13535`). */
export const buildArchiveSnapshotTemplate = (
  options: SnapshotOptions
): Effect.Effect<NipIaEventTemplate, NipIaError> =>
  Effect.gen(function* () {
    const tags: string[][] = [[NIP70_TAG]]
    for (const pk of options.archived) {
      if (!isHex64(pk)) {
        return yield* Effect.fail(
          malformed(
            `archived pubkey must be 64-character lowercase hex: ${pk}`
          )
        )
      }
      tags.push(["p", pk])
    }
    return {
      kind: ARCHIVED_IDENTITIES_LIST_KIND,
      content: options.content ?? "",
      tags,
      created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
    }
  })

// =============================================================================
// Parsers
// =============================================================================

const requireNip70 = (
  tags: readonly (readonly string[])[]
): Effect.Effect<void, NipIaError> =>
  hasNip70Tag(tags)
    ? Effect.void
    : Effect.fail(unprotected("NIP-70 - tag is required"))

/** Parse a `kind:9035` or `kind:9036` request event. */
export const parseArchiveRequest = (
  event: NostrEvent
): Effect.Effect<ParsedArchiveRequest, NipIaError> =>
  Effect.gen(function* () {
    const kind = Number(event.kind)
    if (kind !== ARCHIVE_REQUEST_KIND && kind !== UNARCHIVE_REQUEST_KIND) {
      return yield* Effect.fail(
        malformed(
          `expected kind ${ARCHIVE_REQUEST_KIND} or ${UNARCHIVE_REQUEST_KIND}, got ${kind}`
        )
      )
    }
    yield* requireNip70(event.tags)
    const target = yield* extractSinglePTag(event.tags)
    const reason = extractReason(event.tags)
    const replacedBy = extractReplacedBy(event.tags)
    if (replacedBy !== undefined) {
      if (kind === UNARCHIVE_REQUEST_KIND) {
        // Spec: SHOULD NOT be used; still parse but keep value for callers.
      }
      if (!isHex64(replacedBy)) {
        return yield* Effect.fail(
          malformed("replaced-by must be 64-character lowercase hex")
        )
      }
      if (replacedBy === target) {
        return yield* Effect.fail(
          malformed("replaced-by MUST NOT equal the target")
        )
      }
    }

    // Optional single auth tag (NIP-OA). Multiple auth tags → no valid tag.
    const authTags = event.tags.filter((t) => t[0] === "auth")
    let authTag: AuthTag | undefined
    if (authTags.length === 1) {
      // Defer full parse/verify to OwnerAttestationService when needed; do a
      // structural check here so parse fails closed on obvious garbage.
      const raw = authTags[0]!
      if (raw.length !== 4) {
        return yield* Effect.fail(
          malformed("auth tag must have exactly 4 elements")
        )
      }
      if (!isHex64(raw[1]!) || !/^[0-9a-f]{128}$/.test(raw[3]!)) {
        return yield* Effect.fail(
          malformed("auth tag owner/sig must be lowercase hex")
        )
      }
      authTag = {
        ownerPubkey: raw[1]!,
        conditions: raw[2]!,
        sig: raw[3]!,
      }
    } else if (authTags.length > 1) {
      return yield* Effect.fail(
        malformed("more than one auth tag; treated as no valid tag")
      )
    }

    return {
      kind: kind as
        | typeof ARCHIVE_REQUEST_KIND
        | typeof UNARCHIVE_REQUEST_KIND,
      actor: event.pubkey,
      target,
      content: event.content,
      reason,
      replacedBy,
      authTag,
      event,
    }
  })

/** Parse a `kind:8002` or `kind:8003` relay delta. */
export const parseArchiveDelta = (
  event: NostrEvent
): Effect.Effect<ParsedArchiveDelta, NipIaError> =>
  Effect.gen(function* () {
    const kind = Number(event.kind)
    if (kind !== ARCHIVED_IDENTITY_KIND && kind !== UNARCHIVED_IDENTITY_KIND) {
      return yield* Effect.fail(
        malformed(
          `expected kind ${ARCHIVED_IDENTITY_KIND} or ${UNARCHIVED_IDENTITY_KIND}, got ${kind}`
        )
      )
    }
    yield* requireNip70(event.tags)
    const target = yield* extractSinglePTag(event.tags)
    const consent = yield* parseConsentTag(event.tags)
    if (consent.path === "self" && consent.actorPubkey !== undefined) {
      if (consent.actorPubkey !== target) {
        return yield* Effect.fail(
          malformed("consent=self actor MUST equal the target when present")
        )
      }
    }
    const replacedBy = extractReplacedBy(event.tags)
    if (replacedBy !== undefined) {
      if (!isHex64(replacedBy)) {
        return yield* Effect.fail(
          malformed("replaced-by must be 64-character lowercase hex")
        )
      }
      if (replacedBy === target) {
        return yield* Effect.fail(
          malformed("replaced-by MUST NOT equal the target")
        )
      }
    }
    return {
      kind: kind as
        | typeof ARCHIVED_IDENTITY_KIND
        | typeof UNARCHIVED_IDENTITY_KIND,
      relayPubkey: event.pubkey,
      target,
      consent,
      requestEventId: extractRequestEventId(event.tags),
      content: event.content,
      reason: extractReason(event.tags),
      replacedBy,
      event,
    }
  })

/** Parse a `kind:13535` archived identities list. */
export const parseArchiveSnapshot = (
  event: NostrEvent
): Effect.Effect<ParsedArchiveSnapshot, NipIaError> =>
  Effect.gen(function* () {
    const kind = Number(event.kind)
    if (kind !== ARCHIVED_IDENTITIES_LIST_KIND) {
      return yield* Effect.fail(
        malformed(
          `expected kind ${ARCHIVED_IDENTITIES_LIST_KIND}, got ${kind}`
        )
      )
    }
    yield* requireNip70(event.tags)
    return {
      kind: ARCHIVED_IDENTITIES_LIST_KIND,
      relayPubkey: event.pubkey,
      archived: extractArchivePTags(event.tags),
      content: event.content,
      event,
    }
  })

// =============================================================================
// Verification helpers
// =============================================================================

/**
 * Verify that a relay-signed projection (`8002`/`8003`/`13535`) is authored by
 * the relay identity and well-formed. Does **not** re-check NIP-01 signatures
 * (call `EventService.verifyEvent` separately when needed).
 */
export const verifyRelayProjection = (
  event: NostrEvent,
  relayIdentity: string
): Effect.Effect<
  ParsedArchiveDelta | ParsedArchiveSnapshot,
  NipIaError
> =>
  Effect.gen(function* () {
    if (!isHex64(relayIdentity)) {
      return yield* Effect.fail(
        malformed("relayIdentity must be 64-character lowercase hex")
      )
    }
    if (event.pubkey !== relayIdentity) {
      return yield* Effect.fail(
        wrongSigner(
          "NIP-IA relay event is not signed by the relay NIP-11 self key"
        )
      )
    }
    const kind = Number(event.kind)
    if (kind === ARCHIVED_IDENTITIES_LIST_KIND) {
      return yield* parseArchiveSnapshot(event)
    }
    if (kind === ARCHIVED_IDENTITY_KIND || kind === UNARCHIVED_IDENTITY_KIND) {
      return yield* parseArchiveDelta(event)
    }
    return yield* Effect.fail(
      malformed(
        `not a NIP-IA relay projection kind (got ${kind})`
      )
    )
  })

/**
 * Verify a request-borne NIP-OA owner-of-agent proof on an archive/unarchive
 * request.
 *
 * Per NIP-IA:
 * 1. Exactly one four-element `auth` tag
 * 2. Owner in the tag equals the request actor (`event.pubkey`)
 * 3. NIP-OA preimage uses the **target** (from `p`), not the actor
 * 4. Schnorr verifies under the owner key
 * 5. Conditions are syntactically valid
 * 6. `created_at</>` clauses are evaluated against the request `created_at`
 * 7. `kind=` clauses MUST NOT deny the request (ignored)
 *
 * Self requests (`actor == target`) should not use this path for consent
 * selection; callers check self first.
 */
export const verifyRequestBorneOwnerAuth = (
  event: NostrEvent,
  target: string,
  oa: {
    readonly verify: (
      authTag: ReadonlyArray<string>,
      agentPubkey: string
    ) => Effect.Effect<boolean, Nip0aError>
  }
): Effect.Effect<AuthTag, NipIaError | Nip0aError> =>
  Effect.gen(function* () {
    if (!isHex64(target)) {
      return yield* Effect.fail(
        malformed("target must be 64-character lowercase hex")
      )
    }
    const authTags = event.tags.filter((t) => t[0] === "auth")
    if (authTags.length !== 1) {
      return yield* Effect.fail(
        unauthorized(
          `owner-of-agent request requires exactly one auth tag (got ${authTags.length})`
        )
      )
    }
    const raw = authTags[0]!
    if (raw.length !== 4) {
      return yield* Effect.fail(
        unauthorized("auth tag must have exactly 4 elements")
      )
    }
    const ownerPubkey = raw[1]!
    const conditions = raw[2]!
    if (ownerPubkey !== event.pubkey) {
      return yield* Effect.fail(
        unauthorized("auth owner pubkey must equal the request actor")
      )
    }

    // Crypto verify with TARGET as agent pubkey (NIP-IA gotcha).
    const ok = yield* oa.verify(raw, target)
    if (!ok) {
      return yield* Effect.fail(
        unauthorized("NIP-OA owner signature does not verify for target")
      )
    }

    // Evaluate only time clauses against the request's created_at.
    // kind= is intentionally ignored for NIP-IA authorization.
    const clauses = yield* parseConditions(conditions)
    for (const clause of clauses) {
      switch (clause._tag) {
        case "kind":
          break
        case "created_at<":
          if (!(event.created_at < clause.value)) {
            return yield* Effect.fail(
              unauthorized(
                `request created_at ${event.created_at} does not satisfy created_at<${clause.value}`
              )
            )
          }
          break
        case "created_at>":
          if (!(event.created_at > clause.value)) {
            return yield* Effect.fail(
              unauthorized(
                `request created_at ${event.created_at} does not satisfy created_at>${clause.value}`
              )
            )
          }
          break
      }
    }

    return {
      ownerPubkey,
      conditions,
      sig: raw[3]!,
    }
  })

/**
 * Infer the consent path for a well-formed request under the RECOMMENDED
 * policy profile (self / owner via request-borne OA). Admin and profile-
 * attestation paths require relay context and are not decided here.
 *
 * Returns `"self"` when actor == target, `"owner"` when request-borne OA
 * verifies, otherwise fails with `unauthorized`.
 */
export const inferConsentPath = (
  event: NostrEvent,
  oa: {
    readonly verify: (
      authTag: ReadonlyArray<string>,
      agentPubkey: string
    ) => Effect.Effect<boolean, Nip0aError>
  }
): Effect.Effect<
  { readonly path: "self" | "owner"; readonly actorPubkey: string },
  NipIaError | Nip0aError
> =>
  Effect.gen(function* () {
    const parsed = yield* parseArchiveRequest(event)
    if (parsed.actor === parsed.target) {
      return { path: "self" as const, actorPubkey: parsed.actor }
    }
    const auth = yield* verifyRequestBorneOwnerAuth(event, parsed.target, oa)
    return { path: "owner" as const, actorPubkey: auth.ownerPubkey }
  })

// =============================================================================
// Service Interface
// =============================================================================

export interface NipIAService {
  readonly _tag: "NipIAService"

  /** Build and sign a `kind:9035` archive request. */
  createArchiveRequest(
    options: RequestOptions,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, NipIaError | Error>

  /** Build and sign a `kind:9036` unarchive request. */
  createUnarchiveRequest(
    options: RequestOptions,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, NipIaError | Error>

  /**
   * Build and sign a `kind:9035` owner-of-agent archive request, attaching a
   * freshly signed NIP-OA `auth` tag (or a provided one).
   */
  createOwnerArchiveRequest(
    options: Omit<RequestOptions, "authTag"> & {
      readonly ownerSeckey: PrivateKey
      readonly conditions?: string
      readonly authTag?: AuthTag | ReadonlyArray<string>
    }
  ): Effect.Effect<NostrEvent, NipIaError | Nip0aError | Error>

  /** Build and sign a relay `kind:8002` archive delta. */
  createArchivedDelta(
    options: DeltaOptions,
    relayPrivateKey: PrivateKey
  ): Effect.Effect<NostrEvent, NipIaError | Error>

  /** Build and sign a relay `kind:8003` unarchive delta. */
  createUnarchivedDelta(
    options: DeltaOptions,
    relayPrivateKey: PrivateKey
  ): Effect.Effect<NostrEvent, NipIaError | Error>

  /** Build and sign a relay `kind:13535` snapshot. */
  createArchiveSnapshot(
    options: SnapshotOptions,
    relayPrivateKey: PrivateKey
  ): Effect.Effect<NostrEvent, NipIaError | Error>

  parseArchiveRequest(
    event: NostrEvent
  ): Effect.Effect<ParsedArchiveRequest, NipIaError>

  parseArchiveDelta(
    event: NostrEvent
  ): Effect.Effect<ParsedArchiveDelta, NipIaError>

  parseArchiveSnapshot(
    event: NostrEvent
  ): Effect.Effect<ParsedArchiveSnapshot, NipIaError>

  /**
   * Verify a relay-signed projection is from `relayIdentity` and well-formed.
   */
  verifyRelayProjection(
    event: NostrEvent,
    relayIdentity: string
  ): Effect.Effect<
    ParsedArchiveDelta | ParsedArchiveSnapshot,
    NipIaError
  >

  /**
   * Verify request-borne NIP-OA owner proof on a request (target in preimage).
   */
  verifyRequestBorneOwnerAuth(
    event: NostrEvent,
    target: string
  ): Effect.Effect<AuthTag, NipIaError | Nip0aError>

  /**
   * Infer recommended consent path (`self` or request-borne `owner`).
   */
  inferConsentPath(
    event: NostrEvent
  ): Effect.Effect<
    { readonly path: "self" | "owner"; readonly actorPubkey: string },
    NipIaError | Nip0aError
  >
}

// =============================================================================
// Service Tag + Live
// =============================================================================

export const NipIAService = Context.Service<NipIAService>("NipIAService")

const make = Effect.gen(function* () {
  const events = yield* EventService
  const oa = yield* OwnerAttestationService

  const signTemplate = (
    template: NipIaEventTemplate,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, Error> =>
    events.createEvent(
      {
        kind: decodeKind(template.kind),
        content: template.content,
        tags: template.tags.map((t) => decodeTag(t)),
        created_at: template.created_at as NostrEvent["created_at"],
      },
      privateKey
    )

  const createArchiveRequest: NipIAService["createArchiveRequest"] = (
    options,
    privateKey
  ) =>
    Effect.gen(function* () {
      const template = yield* buildArchiveRequestTemplate(options)
      return yield* signTemplate(template, privateKey)
    })

  const createUnarchiveRequest: NipIAService["createUnarchiveRequest"] = (
    options,
    privateKey
  ) =>
    Effect.gen(function* () {
      const template = yield* buildUnarchiveRequestTemplate(options)
      return yield* signTemplate(template, privateKey)
    })

  const createOwnerArchiveRequest: NipIAService["createOwnerArchiveRequest"] = (
    options
  ) =>
    Effect.gen(function* () {
      let auth: AuthTag | ReadonlyArray<string>
      if (options.authTag !== undefined) {
        auth = options.authTag
      } else {
        auth = yield* oa.sign(
          options.target,
          options.conditions ?? "",
          options.ownerSeckey
        )
      }
      const requestOptions: RequestOptions = {
        target: options.target,
        authTag: auth,
        ...(options.content !== undefined ? { content: options.content } : {}),
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        ...(options.replacedBy !== undefined
          ? { replacedBy: options.replacedBy }
          : {}),
        ...(options.createdAt !== undefined
          ? { createdAt: options.createdAt }
          : {}),
      }
      const template = yield* buildArchiveRequestTemplate(requestOptions)
      return yield* signTemplate(template, options.ownerSeckey)
    })

  const createArchivedDelta: NipIAService["createArchivedDelta"] = (
    options,
    relayPrivateKey
  ) =>
    Effect.gen(function* () {
      const template = yield* buildArchivedDeltaTemplate(options)
      return yield* signTemplate(template, relayPrivateKey)
    })

  const createUnarchivedDelta: NipIAService["createUnarchivedDelta"] = (
    options,
    relayPrivateKey
  ) =>
    Effect.gen(function* () {
      const template = yield* buildUnarchivedDeltaTemplate(options)
      return yield* signTemplate(template, relayPrivateKey)
    })

  const createArchiveSnapshot: NipIAService["createArchiveSnapshot"] = (
    options,
    relayPrivateKey
  ) =>
    Effect.gen(function* () {
      const template = yield* buildArchiveSnapshotTemplate(options)
      return yield* signTemplate(template, relayPrivateKey)
    })

  return {
    _tag: "NipIAService" as const,
    createArchiveRequest,
    createUnarchiveRequest,
    createOwnerArchiveRequest,
    createArchivedDelta,
    createUnarchivedDelta,
    createArchiveSnapshot,
    parseArchiveRequest,
    parseArchiveDelta,
    parseArchiveSnapshot,
    verifyRelayProjection,
    verifyRequestBorneOwnerAuth: (event, target) =>
      verifyRequestBorneOwnerAuth(event, target, oa),
    inferConsentPath: (event) => inferConsentPath(event, oa),
  } satisfies NipIAService
})

/**
 * Live layer. Requires `EventService` and `OwnerAttestationService` in the
 * environment. Typical composition:
 *
 * ```ts
 * NipIAServiceLive.pipe(
 *   Layer.provide(OwnerAttestationServiceLive),
 *   Layer.provide(EventServiceLive),
 *   Layer.provide(CryptoServiceLive),
 * )
 * ```
 */
export const NipIAServiceLive = Layer.effect(NipIAService, make)
