/**
 * OwnerAttestationService
 *
 * NIP-OA: Owner Attestation.
 *
 * An optional `auth` tag by which an owner key authorizes an agent key to
 * publish events under the agent's own authorship. This is provenance, not
 * delegation: an event that carries a valid `auth` tag remains authored by
 * `event.pubkey` (the agent). The owner signs a BIP-340 Schnorr signature over
 *
 *     SHA256("nostr:agent-auth:" || event.pubkey || ":" || conditions)
 *
 * where `conditions` is a `&`-joined clause string of `kind=<n>`,
 * `created_at<t>`, and `created_at>t` clauses. The tag itself is:
 *
 *     ["auth", <owner-pubkey-hex>, <conditions>, <sig-hex>]
 *
 * It defines no event kind — it is a reusable tag applicable to any event, and
 * it is the shared cryptographic root reused by NIP-AA, NIP-GS, and NIP-IA.
 *
 * Gotcha: the pubkey mixed into the signing preimage is the TARGET/agent key
 * (`event.pubkey`), not the request signer or the owner key.
 *
 * @see https://github.com/nostr-protocol/nips (NIP-OA, Owner Attestation)
 */
import { Context, Effect, Layer, Schema } from "effect"
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"

// =============================================================================
// Constants
// =============================================================================

/** Domain-separator string mixed into every NIP-OA signing preimage. */
export const AGENT_AUTH_DOMAIN = "nostr:agent-auth:"

/** The tag name reserved by this NIP. */
export const AUTH_TAG_NAME = "auth"

/** Maximum value permitted in a `kind=` clause. */
export const MAX_KIND = 65535

/** Maximum value permitted in a `created_at<`/`created_at>` clause. */
export const MAX_TIMESTAMP = 4294967295

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/
// Canonical base-10: no leading zeroes except a lone `0`.
const DECIMAL = /^(0|[1-9][0-9]*)$/

const CREATED_AT_PREFIX_LEN = "created_at<".length // 11, same as "created_at>"
const KIND_PREFIX_LEN = "kind=".length // 5

const utf8Encoder = new TextEncoder()

// =============================================================================
// Errors
// =============================================================================

/**
 * The single tagged error channel for NIP-OA.
 *
 * - `malformed_tag`: the tag structure, hex encoding, condition syntax, or a
 *   self-attestation rule made it impossible to attempt verification.
 * - `bad_signature`: the owner Schnorr signature did not verify against the
 *   reconstructed message.
 * - `stale_window`: the event's `created_at` fell outside a `created_at<`/
 *   `created_at>` window declared by the conditions.
 * - `unsatisfied_condition`: a non-time clause (currently `kind=`) was not
 *   satisfied by the event.
 */
export class Nip0aError extends Schema.TaggedErrorClass<Nip0aError>()(
  "Nip0aError",
  {
    reason: Schema.Literals([
      "malformed_tag",
      "bad_signature",
      "stale_window",
      "unsatisfied_condition",
    ]),
    message: Schema.String,
  }
) {}

const malformed = (message: string): Nip0aError =>
  new Nip0aError({ reason: "malformed_tag", message })

const badSignature = (message: string): Nip0aError =>
  new Nip0aError({ reason: "bad_signature", message })

const staleWindow = (message: string): Nip0aError =>
  new Nip0aError({ reason: "stale_window", message })

const unsatisfied = (message: string): Nip0aError =>
  new Nip0aError({ reason: "unsatisfied_condition", message })

// =============================================================================
// Schema / Types
// =============================================================================

/** A single parsed condition clause. */
export const Clause = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("kind"), value: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal("created_at<"), value: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal("created_at>"), value: Schema.Int }),
])
export type Clause = typeof Clause.Type

/** An ordered list of condition clauses. Order is significant (it is signed). */
export const Conditions = Schema.Array(Clause)
export type Conditions = typeof Conditions.Type

/** A parsed `auth` tag. */
export const AuthTag = Schema.Struct({
  /** 64-character lowercase hex x-only owner public key. */
  ownerPubkey: Schema.String,
  /** The exact `&`-joined conditions string, as signed. */
  conditions: Schema.String,
  /** 128-character lowercase hex Schnorr signature. */
  sig: Schema.String,
})
export type AuthTag = typeof AuthTag.Type

/** Structural schema for the raw four-element tag as it appears on an event. */
export const AuthTagTuple = Schema.Tuple([
  Schema.Literal(AUTH_TAG_NAME),
  Schema.String,
  Schema.String,
  Schema.String,
])
export type AuthTagTuple = typeof AuthTagTuple.Type

/** The minimal event shape needed to evaluate conditions. */
export interface AttestedEvent {
  readonly pubkey: string
  readonly kind: number
  readonly created_at: number
}

// =============================================================================
// Conditions parse / serialize
// =============================================================================

const parseClause = (part: string): Clause | null => {
  if (part.startsWith("kind=")) {
    const decimal = part.slice(KIND_PREFIX_LEN)
    if (!DECIMAL.test(decimal)) return null
    const value = Number(decimal)
    if (value < 0 || value > MAX_KIND) return null
    return { _tag: "kind", value }
  }
  if (part.startsWith("created_at<")) {
    const decimal = part.slice(CREATED_AT_PREFIX_LEN)
    if (!DECIMAL.test(decimal)) return null
    const value = Number(decimal)
    if (value < 0 || value > MAX_TIMESTAMP) return null
    return { _tag: "created_at<", value }
  }
  if (part.startsWith("created_at>")) {
    const decimal = part.slice(CREATED_AT_PREFIX_LEN)
    if (!DECIMAL.test(decimal)) return null
    const value = Number(decimal)
    if (value < 0 || value > MAX_TIMESTAMP) return null
    return { _tag: "created_at>", value }
  }
  return null
}

/**
 * Parse and validate a `&`-joined conditions string into ordered clauses.
 *
 * An empty string is valid and imposes no constraints. Whitespace, empty
 * clauses (leading/trailing/`&&` delimiters), non-canonical decimals, and
 * unsupported clauses are rejected as `malformed_tag`.
 */
export const parseConditions = (
  raw: string
): Effect.Effect<Conditions, Nip0aError> => {
  if (raw === "") return Effect.succeed([])
  if (/\s/.test(raw)) {
    return Effect.fail(malformed("conditions must not contain whitespace"))
  }
  const parts = raw.split("&")
  const clauses: Array<Clause> = []
  for (const part of parts) {
    if (part === "") {
      return Effect.fail(
        malformed("conditions must not contain an empty clause")
      )
    }
    const clause = parseClause(part)
    if (clause === null) {
      return Effect.fail(malformed(`unsupported or malformed clause: ${part}`))
    }
    clauses.push(clause)
  }
  return Effect.succeed(clauses)
}

const clauseToString = (clause: Clause): string => {
  switch (clause._tag) {
    case "kind":
      return `kind=${clause.value}`
    case "created_at<":
      return `created_at<${clause.value}`
    case "created_at>":
      return `created_at>${clause.value}`
  }
}

/** Serialize ordered clauses back into the canonical `&`-joined string. */
export const serializeConditions = (clauses: Conditions): string =>
  clauses.map(clauseToString).join("&")

// =============================================================================
// Tag parse / serialize
// =============================================================================

/** Serialize a parsed `auth` tag into its four-element wire array. */
export const authTagToArray = (
  tag: AuthTag
): [string, string, string, string] => [
  AUTH_TAG_NAME,
  tag.ownerPubkey,
  tag.conditions,
  tag.sig,
]

/**
 * Parse and validate a raw `auth` tag array. Rejects any tag that is not
 * exactly `["auth", <owner-hex>, <conditions>, <sig-hex>]` with a lowercase
 * 64-hex owner key, a valid conditions string, and a lowercase 128-hex sig.
 */
export const parseAuthTag = (
  tag: ReadonlyArray<string>
): Effect.Effect<AuthTag, Nip0aError> => {
  if (tag.length !== 4) {
    return Effect.fail(
      malformed(`auth tag must have exactly 4 elements, got ${tag.length}`)
    )
  }
  if (tag[0] !== AUTH_TAG_NAME) {
    return Effect.fail(malformed(`auth tag name must be "${AUTH_TAG_NAME}"`))
  }
  const ownerPubkey = tag[1]!
  const conditions = tag[2]!
  const sig = tag[3]!
  if (!HEX64.test(ownerPubkey)) {
    return Effect.fail(
      malformed("owner pubkey must be 64-character lowercase hex")
    )
  }
  if (!HEX128.test(sig)) {
    return Effect.fail(
      malformed("signature must be 128-character lowercase hex")
    )
  }
  return parseConditions(conditions).pipe(
    Effect.map(() => ({ ownerPubkey, conditions, sig }))
  )
}

/**
 * Find the single valid-shaped `auth` tag on an event's tag list.
 *
 * Per NIP-OA, an event with more than one `auth` tag has no valid `auth` tag;
 * this rejects both the zero-tag and multiple-tag cases as `malformed_tag`.
 */
export const findAuthTag = (
  tags: ReadonlyArray<ReadonlyArray<string>>
): Effect.Effect<AuthTag, Nip0aError> => {
  const authTags = tags.filter((t) => t[0] === AUTH_TAG_NAME)
  if (authTags.length === 0) {
    return Effect.fail(malformed("event has no auth tag"))
  }
  if (authTags.length > 1) {
    return Effect.fail(
      malformed("event has more than one auth tag; treated as no valid tag")
    )
  }
  return parseAuthTag(authTags[0]!)
}

// =============================================================================
// Preimage / crypto
// =============================================================================

/**
 * The exact NIP-OA signing preimage string. The pubkey MUST be the target
 * (agent) key — i.e. `event.pubkey` — never the request signer.
 */
export const authPreimage = (agentPubkey: string, conditions: string): string =>
  `${AGENT_AUTH_DOMAIN}${agentPubkey}:${conditions}`

const signedMessage = (agentPubkey: string, conditions: string): Uint8Array =>
  sha256(utf8Encoder.encode(authPreimage(agentPubkey, conditions)))

// =============================================================================
// Sign / verify
// =============================================================================

/**
 * Produce a NIP-OA `auth` tag authorizing `agentPubkey` under `conditions`.
 *
 * The owner secret key signs `SHA256("nostr:agent-auth:" || agentPubkey || ":"
 * || conditions)`. Rejects malformed keys, malformed conditions, and
 * self-attestation (derived owner key equal to the agent key).
 */
export const signAuthTag = (
  agentPubkey: string,
  conditions: string,
  ownerSeckey: string
): Effect.Effect<AuthTag, Nip0aError> =>
  Effect.gen(function* () {
    if (!HEX64.test(agentPubkey)) {
      return yield* Effect.fail(
        malformed("agent pubkey must be 64-character lowercase hex")
      )
    }
    if (!HEX64.test(ownerSeckey)) {
      return yield* Effect.fail(
        malformed("owner secret key must be 64-character lowercase hex")
      )
    }
    // Validate the conditions string (also guards against normalization: we
    // sign the exact string supplied, only after confirming it is well-formed).
    yield* parseConditions(conditions)

    const ownerPubkey = yield* Effect.try({
      try: () => bytesToHex(schnorr.getPublicKey(hexToBytes(ownerSeckey))),
      catch: (error) =>
        malformed(`failed to derive owner pubkey: ${error}`),
    })

    if (ownerPubkey === agentPubkey) {
      return yield* Effect.fail(
        malformed("self-attestation: owner key equals agent key")
      )
    }

    const message = signedMessage(agentPubkey, conditions)
    const sig = yield* Effect.try({
      try: () => bytesToHex(schnorr.sign(message, hexToBytes(ownerSeckey))),
      catch: (error) => malformed(`failed to sign attestation: ${error}`),
    })

    return { ownerPubkey, conditions, sig }
  })

/**
 * Verify the owner signature on an `auth` tag for a given agent key.
 *
 * Returns `true` when the owner authorized this agent under the tag's
 * conditions, and `false` when the signature does not verify (a tampered
 * signature, tampered conditions, or a mismatched agent key). Fails with
 * `malformed_tag` when the tag cannot be parsed or is a self-attestation.
 *
 * NOTE: `agentPubkey` is the TARGET key that is mixed into the preimage — pass
 * `event.pubkey`, not the request signer.
 */
export const verifyAuthTag = (
  authTag: ReadonlyArray<string>,
  agentPubkey: string
): Effect.Effect<boolean, Nip0aError> =>
  Effect.gen(function* () {
    const parsed = yield* parseAuthTag(authTag)
    if (!HEX64.test(agentPubkey)) {
      return yield* Effect.fail(
        malformed("agent pubkey must be 64-character lowercase hex")
      )
    }
    if (parsed.ownerPubkey === agentPubkey) {
      return yield* Effect.fail(
        malformed("self-attestation: owner key equals agent key")
      )
    }
    const message = signedMessage(agentPubkey, parsed.conditions)
    return yield* Effect.try({
      try: () =>
        schnorr.verify(
          hexToBytes(parsed.sig),
          message,
          hexToBytes(parsed.ownerPubkey)
        ),
      catch: (error) =>
        malformed(`failed to verify signature: ${error}`),
    })
  })

/**
 * Verify an `auth` tag against a full event: the owner signature over the
 * event's own pubkey, and every condition clause against the event.
 *
 * The agent key is taken from `event.pubkey` (the NIP-OA gotcha). Fails with
 * `malformed_tag` (unparseable tag / self-attestation), `bad_signature` (owner
 * signature invalid), `stale_window` (a `created_at` window is violated), or
 * `unsatisfied_condition` (a `kind=` clause is not met). Returns `true` only
 * when the signature verifies and all clauses are satisfied.
 */
export const verifyAuthTagForEvent = (
  authTag: ReadonlyArray<string>,
  event: AttestedEvent
): Effect.Effect<boolean, Nip0aError> =>
  Effect.gen(function* () {
    const parsed = yield* parseAuthTag(authTag)
    if (parsed.ownerPubkey === event.pubkey) {
      return yield* Effect.fail(
        malformed("self-attestation: owner key equals agent key")
      )
    }
    const clauses = yield* parseConditions(parsed.conditions)

    const message = signedMessage(event.pubkey, parsed.conditions)
    const ok = yield* Effect.try({
      try: () =>
        schnorr.verify(
          hexToBytes(parsed.sig),
          message,
          hexToBytes(parsed.ownerPubkey)
        ),
      catch: (error) =>
        malformed(`failed to verify signature: ${error}`),
    })
    if (!ok) {
      return yield* Effect.fail(
        badSignature("owner signature does not verify for this event")
      )
    }

    for (const clause of clauses) {
      switch (clause._tag) {
        case "kind":
          if (event.kind !== clause.value) {
            return yield* Effect.fail(
              unsatisfied(
                `event kind ${event.kind} does not satisfy kind=${clause.value}`
              )
            )
          }
          break
        case "created_at<":
          if (!(event.created_at < clause.value)) {
            return yield* Effect.fail(
              staleWindow(
                `event created_at ${event.created_at} does not satisfy created_at<${clause.value}`
              )
            )
          }
          break
        case "created_at>":
          if (!(event.created_at > clause.value)) {
            return yield* Effect.fail(
              staleWindow(
                `event created_at ${event.created_at} does not satisfy created_at>${clause.value}`
              )
            )
          }
          break
      }
    }

    return true
  })

// =============================================================================
// Service Interface
// =============================================================================

export interface OwnerAttestationService {
  readonly _tag: "OwnerAttestationService"

  /**
   * Produce an `auth` tag authorizing `agentPubkey` under `conditions`,
   * signed by the owner secret key.
   */
  sign(
    agentPubkey: string,
    conditions: string,
    ownerSeckey: string
  ): Effect.Effect<AuthTag, Nip0aError>

  /**
   * Verify the owner signature on an `auth` tag for the given agent key.
   * Returns whether the signature is valid; fails on a malformed tag.
   */
  verify(
    authTag: ReadonlyArray<string>,
    agentPubkey: string
  ): Effect.Effect<boolean, Nip0aError>

  /**
   * Verify an `auth` tag against a full event, evaluating both the owner
   * signature (over `event.pubkey`) and every condition clause.
   */
  verifyForEvent(
    authTag: ReadonlyArray<string>,
    event: AttestedEvent
  ): Effect.Effect<boolean, Nip0aError>

  /** Parse and validate a raw `auth` tag array. */
  parseTag(tag: ReadonlyArray<string>): Effect.Effect<AuthTag, Nip0aError>

  /** Find the single valid-shaped `auth` tag among an event's tags. */
  findTag(
    tags: ReadonlyArray<ReadonlyArray<string>>
  ): Effect.Effect<AuthTag, Nip0aError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const OwnerAttestationService = Context.Service<OwnerAttestationService>(
  "OwnerAttestationService"
)

// =============================================================================
// Service Implementation
// =============================================================================

const make: OwnerAttestationService = {
  _tag: "OwnerAttestationService",
  sign: signAuthTag,
  verify: verifyAuthTag,
  verifyForEvent: verifyAuthTagForEvent,
  parseTag: parseAuthTag,
  findTag: findAuthTag,
}

// =============================================================================
// Service Layer
// =============================================================================

export const OwnerAttestationServiceLive = Layer.succeed(
  OwnerAttestationService,
  make
)
