/**
 * GitObjectSigningService
 *
 * NIP-GS: Git Object Signing with Nostr Keys.
 *
 * Signs and verifies git object payloads (commits/tags) using BIP-340 Schnorr
 * over a domain-separated preimage:
 *
 *     SHA-256("nostr:git:v1:" || decimal(t) || ":" || oa_binding || payload)
 *
 * The signature is wrapped in a compact JSON envelope, base64-encoded, and
 * armored with `-----BEGIN/END SIGNED MESSAGE-----` markers suitable for
 * git's `gpg.format=x509` program interface.
 *
 * Optional `oa` embeds a NIP-OA owner attestation (3-string array) bound into
 * the signing hash so it cannot be stripped or injected after the fact.
 *
 * This module implements the cryptographic scheme and armor/status helpers.
 * It does not ship a full `gpg.x509.program` CLI binary.
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-GS.md
 */
import { Context, Effect, Layer, Schema } from "effect"
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { bech32 } from "@scure/base"
import {
  AGENT_AUTH_DOMAIN,
  authPreimage,
} from "./OwnerAttestationService.js"

// =============================================================================
// Constants
// =============================================================================

/** Domain separator mixed into every NIP-GS signing preimage (13 UTF-8 bytes). */
export const GIT_SIGN_DOMAIN = "nostr:git:v1:"

/** Armor header / footer markers. */
export const ARMOR_BEGIN = "-----BEGIN SIGNED MESSAGE-----"
export const ARMOR_END = "-----END SIGNED MESSAGE-----"

/** Maximum value permitted for the envelope timestamp `t`. */
export const MAX_GIT_SIGN_TIMESTAMP = 4294967295

/** Maximum decoded JSON envelope size (bytes). */
export const MAX_JSON_BYTES = 2048

/** Maximum base64 middle line length (bytes). */
export const MAX_BASE64_LINE = 4096

/** Maximum git object payload size accepted by sign/verify (100 MiB). */
export const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024

/** Schema version for this NIP. */
export const SCHEMA_VERSION = 1 as const

/** Permitted top-level keys for `v=1` envelopes (canonical order). */
export const ENVELOPE_KEYS_V1 = ["v", "pk", "sig", "t", "oa"] as const

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/
const BASE64_LINE = /^[A-Za-z0-9+/]+=*$/

const utf8Encoder = new TextEncoder()

/** Decode bytes as UTF-8, rejecting invalid sequences (no U+FFFD replacement). */
const decodeUtf8Strict = (bytes: Uint8Array): string => {
  // Manual check: TextDecoder without fatal replaces bad bytes with U+FFFD.
  // Round-trip equality catches replacements and overlongs for our envelope sizes.
  const text = new TextDecoder("utf-8").decode(bytes)
  const reencoded = utf8Encoder.encode(text)
  if (
    reencoded.length !== bytes.length ||
    !reencoded.every((b, i) => b === bytes[i])
  ) {
    throw new Error("invalid UTF-8")
  }
  return text
}

/** 32 zero bytes — BIP-340 aux randomness for deterministic test vectors. */
export const ZERO_AUX_RAND = new Uint8Array(32)

// =============================================================================
// Errors
// =============================================================================

/**
 * Tagged error channel for NIP-GS.
 *
 * - `malformed_envelope`: armor, JSON, field constraints, or pubkey validity
 *   failed before cryptographic verification could be attempted.
 * - `bad_signature`: envelope parsed, but BIP-340 verification failed.
 * - `payload_too_large`: git object payload exceeded 100 MiB.
 * - `invalid_key`: secret/public key material could not be used for signing.
 */
export class NipGsError extends Schema.TaggedErrorClass<NipGsError>()(
  "NipGsError",
  {
    reason: Schema.Literals([
      "malformed_envelope",
      "bad_signature",
      "payload_too_large",
      "invalid_key",
    ]),
    message: Schema.String,
  }
) {}

const malformed = (message: string): NipGsError =>
  new NipGsError({ reason: "malformed_envelope", message })

const badSignature = (message: string): NipGsError =>
  new NipGsError({ reason: "bad_signature", message })

const payloadTooLarge = (message: string): NipGsError =>
  new NipGsError({ reason: "payload_too_large", message })

const invalidKey = (message: string): NipGsError =>
  new NipGsError({ reason: "invalid_key", message })

// =============================================================================
// Types
// =============================================================================

/** Optional NIP-OA owner attestation embedded in the envelope. */
export interface OwnerAttestationField {
  /** 64-char lowercase hex owner public key. */
  readonly ownerPubkey: string
  /** Exact conditions string (may be empty). */
  readonly conditions: string
  /** 128-char lowercase hex owner Schnorr signature. */
  readonly sig: string
}

/** Parsed / constructed NIP-GS signature envelope. */
export interface GitSignatureEnvelope {
  readonly v: typeof SCHEMA_VERSION
  /** 64-char lowercase hex signer (agent) public key. */
  readonly pk: string
  /** 128-char lowercase hex BIP-340 signature over the git object hash. */
  readonly sig: string
  /** Claimed unix timestamp of the signing event. */
  readonly t: number
  /** Optional bound NIP-OA owner attestation. */
  readonly oa?: OwnerAttestationField
}

/** Options controlling signing. */
export interface SignGitObjectOptions {
  /** Override the signing timestamp `t`. Defaults to `Math.floor(Date.now()/1000)`. */
  readonly createdAt?: number
  /**
   * Optional owner attestation. Accepts either a parsed field, a 3-element
   * `oa` array, or a 4-element NIP-OA `auth` tag (elements 1–3 are extracted).
   */
  readonly oa?: OwnerAttestationField | ReadonlyArray<string>
  /**
   * Auxiliary randomness for BIP-340 nonce generation (32 bytes).
   * Pass `ZERO_AUX_RAND` for deterministic signatures matching the spec vectors.
   * When omitted, a cryptographically secure random 32-byte aux is used.
   */
  readonly auxRand?: Uint8Array
}

/** Trust level reported after successful verification (git GNUPG status). */
export type TrustLevel = "FULLY" | "UNDEFINED"

/** Owner-attestation outcome when `oa` is present on a verified envelope. */
export interface OwnerAttestationOutcome {
  readonly present: true
  readonly valid: boolean
  readonly ownerPubkey: string
  readonly conditions: string
}

/** Successful verification result. */
export interface VerifyGitObjectSuccess {
  readonly valid: true
  readonly envelope: GitSignatureEnvelope
  readonly trust: TrustLevel
  readonly ownerAttestation?: OwnerAttestationOutcome
}

/** Options controlling verification. */
export interface VerifyGitObjectOptions {
  /**
   * Local `user.signingkey` (hex or `npub1…`). When it matches `envelope.pk`,
   * trust is reported as `FULLY`; otherwise `UNDEFINED`.
   */
  readonly signingKey?: string
}

// =============================================================================
// OA helpers
// =============================================================================

/**
 * Normalize an `oa` input into a three-field attestation.
 * Accepts 3-element arrays, 4-element `auth` tags, or a structured field.
 */
export const normalizeOwnerAttestation = (
  input: OwnerAttestationField | ReadonlyArray<string>
): Effect.Effect<OwnerAttestationField, NipGsError> => {
  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    "ownerPubkey" in input
  ) {
    return Effect.succeed(input as OwnerAttestationField)
  }

  const arr = input as ReadonlyArray<string>
  if (arr.length === 4 && arr[0] === "auth") {
    return Effect.succeed({
      ownerPubkey: arr[1]!,
      conditions: arr[2]!,
      sig: arr[3]!,
    })
  }
  if (arr.length === 3) {
    return Effect.succeed({
      ownerPubkey: arr[0]!,
      conditions: arr[1]!,
      sig: arr[2]!,
    })
  }
  return Effect.fail(
    malformed(
      `oa must be a 3-element array or 4-element auth tag, got length ${arr.length}`
    )
  )
}

const validateOwnerAttestation = (
  oa: OwnerAttestationField,
  agentPubkey: string
): Effect.Effect<OwnerAttestationField, NipGsError> =>
  Effect.gen(function* () {
    if (!HEX64.test(oa.ownerPubkey)) {
      return yield* Effect.fail(
        malformed("oa[0] (owner pubkey) must be 64-character lowercase hex")
      )
    }
    if (!isValidXOnlyPubkey(oa.ownerPubkey)) {
      return yield* Effect.fail(
        malformed(
          "oa[0] (owner pubkey) is not a valid BIP-340 x-only public key"
        )
      )
    }
    if (oa.ownerPubkey === agentPubkey) {
      return yield* Effect.fail(
        malformed("oa self-attestation: owner pubkey equals signer pk")
      )
    }
    if (typeof oa.conditions !== "string") {
      return yield* Effect.fail(malformed("oa[1] (conditions) must be a string"))
    }
    if (!HEX128.test(oa.sig)) {
      return yield* Effect.fail(
        malformed("oa[2] (owner sig) must be 128-character lowercase hex")
      )
    }
    return oa
  })

/**
 * Verify the NIP-OA owner signature over the agent (`pk`) key.
 * Returns whether the owner signature verifies (does not fail on bad sig).
 */
export const verifyOwnerAttestation = (
  oa: OwnerAttestationField,
  agentPubkey: string
): Effect.Effect<boolean, NipGsError> =>
  Effect.gen(function* () {
    yield* validateOwnerAttestation(oa, agentPubkey)
    const preimage = authPreimage(agentPubkey, oa.conditions)
    if (!preimage.startsWith(AGENT_AUTH_DOMAIN)) {
      return yield* Effect.fail(malformed("internal: OA domain mismatch"))
    }
    const message = sha256(utf8Encoder.encode(preimage))
    return yield* Effect.try({
      try: () =>
        schnorr.verify(
          hexToBytes(oa.sig),
          message,
          hexToBytes(oa.ownerPubkey)
        ),
      catch: (error) =>
        malformed(`failed to verify owner attestation: ${error}`),
    })
  })

// =============================================================================
// Preimage / hash
// =============================================================================

const decimalTimestamp = (t: number): string => {
  if (!Number.isInteger(t) || t < 0 || t > MAX_GIT_SIGN_TIMESTAMP) {
    throw new Error(`timestamp out of range: ${t}`)
  }
  return String(t)
}

/**
 * Build the exact NIP-GS signing preimage bytes:
 * `"nostr:git:v1:" || decimal(t) || ":" || oa_binding || payload`.
 *
 * `oa_binding` is `owner:conditions:sig:` when `oa` is present, else empty.
 */
export const signingPreimage = (
  payload: Uint8Array,
  t: number,
  oa?: OwnerAttestationField
): Uint8Array => {
  const prefix = utf8Encoder.encode(
    `${GIT_SIGN_DOMAIN}${decimalTimestamp(t)}:`
  )
  if (!oa) {
    const out = new Uint8Array(prefix.length + payload.length)
    out.set(prefix, 0)
    out.set(payload, prefix.length)
    return out
  }
  const binding = utf8Encoder.encode(
    `${oa.ownerPubkey}:${oa.conditions}:${oa.sig}:`
  )
  const out = new Uint8Array(prefix.length + binding.length + payload.length)
  out.set(prefix, 0)
  out.set(binding, prefix.length)
  out.set(payload, prefix.length + binding.length)
  return out
}

/** SHA-256 of the NIP-GS signing preimage. */
export const signingHash = (
  payload: Uint8Array,
  t: number,
  oa?: OwnerAttestationField
): Uint8Array => sha256(signingPreimage(payload, t, oa))

// =============================================================================
// Envelope serialize / parse
// =============================================================================

/** Compact JSON serialization with required field order (no whitespace). */
export const serializeEnvelope = (envelope: GitSignatureEnvelope): string => {
  if (envelope.oa) {
    // conditions is a plain string with no JSON escapes required for valid
    // NIP-OA conditions (no quotes/backslashes). Escape defensively anyway.
    const conditions = jsonEscape(envelope.oa.conditions)
    return `{"v":${envelope.v},"pk":"${envelope.pk}","sig":"${envelope.sig}","t":${envelope.t},"oa":["${envelope.oa.ownerPubkey}","${conditions}","${envelope.oa.sig}"]}`
  }
  return `{"v":${envelope.v},"pk":"${envelope.pk}","sig":"${envelope.sig}","t":${envelope.t}}`
}

const jsonEscape = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")

/** Convert a parsed envelope to its 3-element wire `oa` array. */
export const ownerAttestationToArray = (
  oa: OwnerAttestationField
): [string, string, string] => [oa.ownerPubkey, oa.conditions, oa.sig]

/**
 * Reject JSON that contains whitespace outside of string values.
 * Spec requires compact serialization to prevent envelope malleability.
 */
const hasNonStringWhitespace = (json: string): boolean => {
  let inString = false
  let escaped = false
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      return true
    }
  }
  return false
}

/** True when `pk` is a valid BIP-340 x-only public key (`lift_x` succeeds). */
export const isValidXOnlyPubkey = (pkHex: string): boolean => {
  if (!HEX64.test(pkHex)) return false
  try {
    const x = BigInt("0x" + pkHex)
    schnorr.utils.lift_x(x)
    return true
  } catch {
    return false
  }
}

const parseOaArray = (
  raw: unknown,
  agentPubkey: string
): Effect.Effect<OwnerAttestationField, NipGsError> =>
  Effect.gen(function* () {
    if (!Array.isArray(raw) || raw.length !== 3) {
      return yield* Effect.fail(
        malformed("oa must be a JSON array of exactly 3 strings")
      )
    }
    if (!raw.every((el) => typeof el === "string")) {
      return yield* Effect.fail(
        malformed("oa must be a JSON array of exactly 3 strings")
      )
    }
    return yield* validateOwnerAttestation(
      {
        ownerPubkey: raw[0] as string,
        conditions: raw[1] as string,
        sig: raw[2] as string,
      },
      agentPubkey
    )
  })

/**
 * Parse and validate a compact JSON envelope string.
 * Enforces field set, types, hex canonicity, BIP-340 pubkey validity, and
 * byte-for-byte canonical re-serialization (malleability resistance).
 */
export const parseEnvelopeJson = (
  json: string
): Effect.Effect<GitSignatureEnvelope, NipGsError> =>
  Effect.gen(function* () {
    if (json.length > MAX_JSON_BYTES) {
      return yield* Effect.fail(
        malformed(`decoded JSON exceeds ${MAX_JSON_BYTES} bytes`)
      )
    }
    if (hasNonStringWhitespace(json)) {
      return yield* Effect.fail(
        malformed(
          "JSON must use compact serialization (no whitespace outside strings)"
        )
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (error) {
      return yield* Effect.fail(malformed(`invalid JSON: ${error}`))
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return yield* Effect.fail(malformed("envelope must be a JSON object"))
    }

    const obj = parsed as Record<string, unknown>
    const keys = Object.keys(obj)

    for (const key of keys) {
      if (!(ENVELOPE_KEYS_V1 as readonly string[]).includes(key)) {
        return yield* Effect.fail(
          malformed(`unknown envelope key for v=1: ${key}`)
        )
      }
    }

    if (!("v" in obj) || !("pk" in obj) || !("sig" in obj) || !("t" in obj)) {
      return yield* Effect.fail(malformed("envelope missing required fields"))
    }

    if (obj.v !== 1) {
      return yield* Effect.fail(malformed("envelope v must be integer 1"))
    }
    if (typeof obj.pk !== "string" || !HEX64.test(obj.pk)) {
      return yield* Effect.fail(
        malformed("pk must be 64-character lowercase hex")
      )
    }
    if (!isValidXOnlyPubkey(obj.pk)) {
      return yield* Effect.fail(
        malformed("pk is not a valid BIP-340 x-only public key")
      )
    }
    if (typeof obj.sig !== "string" || !HEX128.test(obj.sig)) {
      return yield* Effect.fail(
        malformed("sig must be 128-character lowercase hex")
      )
    }
    if (
      typeof obj.t !== "number" ||
      !Number.isInteger(obj.t) ||
      obj.t < 0 ||
      obj.t > MAX_GIT_SIGN_TIMESTAMP
    ) {
      return yield* Effect.fail(
        malformed("t must be an integer in range 0..4294967295")
      )
    }

    let oa: OwnerAttestationField | undefined
    if ("oa" in obj) {
      oa = yield* parseOaArray(obj.oa, obj.pk)
    }

    const envelope: GitSignatureEnvelope = oa
      ? { v: 1, pk: obj.pk, sig: obj.sig, t: obj.t, oa }
      : { v: 1, pk: obj.pk, sig: obj.sig, t: obj.t }

    const canonical = serializeEnvelope(envelope)
    if (canonical !== json) {
      return yield* Effect.fail(
        malformed(
          "envelope is not in canonical compact form (field order, formatting, or duplicate keys)"
        )
      )
    }

    return envelope
  })

// =============================================================================
// Armor
// =============================================================================

/** Wrap a base64 line in NIP-GS armor (exactly three lines + trailing LF). */
export const armorEncode = (base64: string): string =>
  `${ARMOR_BEGIN}\n${base64}\n${ARMOR_END}\n`

/**
 * Parse an armored NIP-GS signature. Accepts an optional trailing LF after
 * the end marker (git may append one). Rejects malformed armor, line wrapping,
 * oversized base64, and trailing junk.
 */
export const armorDecode = (
  armored: string
): Effect.Effect<string, NipGsError> => {
  let text = armored
  // Permit missing final LF by treating it as present for split purposes.
  if (!text.endsWith("\n")) {
    text = text + "\n"
  }

  // Valid endings: END\n or END\n\n (git may append one extra LF)
  let body = text
  if (body.endsWith(`${ARMOR_END}\n\n`)) {
    body = body.slice(0, -1)
  }

  const expectedSuffix = `${ARMOR_END}\n`
  if (!body.endsWith(expectedSuffix)) {
    return Effect.fail(malformed("missing or malformed armor end marker"))
  }
  if (!body.startsWith(`${ARMOR_BEGIN}\n`)) {
    return Effect.fail(malformed("missing or malformed armor begin marker"))
  }

  // Reject multiple armor blocks
  if (body.indexOf(ARMOR_BEGIN, 1) !== -1) {
    return Effect.fail(malformed("multiple armor blocks"))
  }

  // Between BEGIN\n and END\n the content is `<base64>\n` (three-line armor).
  const middle = body.slice(
    ARMOR_BEGIN.length + 1,
    body.length - expectedSuffix.length
  )
  if (!middle.endsWith("\n")) {
    return Effect.fail(malformed("armor base64 line must end with LF before end marker"))
  }
  const inner = middle.slice(0, -1)
  if (inner.includes("\n") || inner.includes("\r")) {
    return Effect.fail(malformed("armor base64 must be a single unwrapped line"))
  }
  if (inner.length === 0) {
    return Effect.fail(malformed("armor base64 line is empty"))
  }
  if (inner.length > MAX_BASE64_LINE) {
    return Effect.fail(
      malformed(`armor base64 line exceeds ${MAX_BASE64_LINE} bytes`)
    )
  }
  if (/\s/.test(inner)) {
    return Effect.fail(malformed("armor base64 must not contain whitespace"))
  }
  if (!BASE64_LINE.test(inner)) {
    return Effect.fail(malformed("armor middle line is not valid base64"))
  }

  return Effect.succeed(inner)
}

/** Base64-encode bytes with standard alphabet and padding. */
export const base64Encode = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64")

/** Base64-decode a standard-alphabet string. */
export const base64Decode = (
  b64: string
): Effect.Effect<Uint8Array, NipGsError> =>
  Effect.try({
    try: () => {
      const buf = Buffer.from(b64, "base64")
      const reencoded = buf.toString("base64")
      const strip = (s: string) => s.replace(/=+$/, "")
      if (strip(reencoded) !== strip(b64)) {
        throw new Error("non-canonical or invalid base64")
      }
      return new Uint8Array(buf)
    },
    catch: (error) => malformed(`base64 decode failed: ${error}`),
  })

/** Decode an armored signature into a validated envelope. */
export const parseArmoredSignature = (
  armored: string
): Effect.Effect<GitSignatureEnvelope, NipGsError> =>
  Effect.gen(function* () {
    const b64 = yield* armorDecode(armored)
    const bytes = yield* base64Decode(b64)
    if (bytes.length > MAX_JSON_BYTES) {
      return yield* Effect.fail(
        malformed(`decoded JSON exceeds ${MAX_JSON_BYTES} bytes`)
      )
    }
    const json = yield* Effect.try({
      try: () => decodeUtf8Strict(bytes),
      catch: () => malformed("decoded bytes are not valid UTF-8"),
    })
    return yield* parseEnvelopeJson(json)
  })

/** Encode a validated envelope as armored detached signature text. */
export const encodeArmoredSignature = (
  envelope: GitSignatureEnvelope
): string => {
  const json = serializeEnvelope(envelope)
  const b64 = base64Encode(utf8Encoder.encode(json))
  return armorEncode(b64)
}

// =============================================================================
// GNUPG status helpers (for CLI / git interop)
// =============================================================================

const statusPrefix = "[GNUPG:] "

/** Format the signing status lines git expects (`SIG_CREATED`). */
export const formatSignStatus = (envelope: GitSignatureEnvelope): string =>
  `${statusPrefix}BEGIN_SIGNING\n${statusPrefix}SIG_CREATED D 8 1 00 ${envelope.t} ${envelope.pk}\n`

/** UTC `YYYY-MM-DD` from a unix timestamp. */
export const formatUtcDate = (t: number): string => {
  const d = new Date(t * 1000)
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0")
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0")
  const dd = d.getUTCDate().toString().padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

/** Format verification success status lines. */
export const formatGoodSigStatus = (
  envelope: GitSignatureEnvelope,
  trust: TrustLevel
): string => {
  const pk = envelope.pk
  const date = formatUtcDate(envelope.t)
  const trustLine =
    trust === "FULLY"
      ? `${statusPrefix}TRUST_FULLY 0 shell`
      : `${statusPrefix}TRUST_UNDEFINED 0 shell`
  return (
    `${statusPrefix}NEWSIG\n` +
    `${statusPrefix}GOODSIG ${pk} ${pk}\n` +
    `${statusPrefix}VALIDSIG ${pk} ${date} ${envelope.t} 0 - - - - - ${pk}\n` +
    `${trustLine}\n`
  )
}

/** Format verification failure when the signature does not verify. */
export const formatBadSigStatus = (pk: string): string =>
  `${statusPrefix}NEWSIG\n${statusPrefix}BADSIG ${pk} ${pk}\n`

/** Format ERRSIG for unprocessable signatures. */
export const formatErrSigStatus = (keyId?: string): string => {
  const id = keyId && HEX64.test(keyId) ? keyId : "0000000000000000"
  return `${statusPrefix}ERRSIG ${id} 0 0 00 0 9\n`
}

// =============================================================================
// Sign / verify
// =============================================================================

const ensurePayloadSize = (
  payload: Uint8Array
): Effect.Effect<void, NipGsError> => {
  if (payload.byteLength > MAX_PAYLOAD_BYTES) {
    return Effect.fail(
      payloadTooLarge(
        `payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${payload.byteLength})`
      )
    )
  }
  return Effect.void
}

/**
 * Sign a git object payload with a Nostr secret key.
 *
 * Returns the validated envelope. Use {@link encodeArmoredSignature} for the
 * detached armored form git embeds in commits/tags.
 */
export const signGitObject = (
  payload: Uint8Array,
  seckey: string,
  options: SignGitObjectOptions = {}
): Effect.Effect<GitSignatureEnvelope, NipGsError> =>
  Effect.gen(function* () {
    yield* ensurePayloadSize(payload)

    if (!HEX64.test(seckey)) {
      return yield* Effect.fail(
        invalidKey("secret key must be 64-character lowercase hex")
      )
    }

    const t =
      options.createdAt !== undefined
        ? options.createdAt
        : Math.floor(Date.now() / 1000)

    if (!Number.isInteger(t) || t < 0 || t > MAX_GIT_SIGN_TIMESTAMP) {
      return yield* Effect.fail(
        malformed("createdAt/t must be an integer in range 0..4294967295")
      )
    }

    const pk = yield* Effect.try({
      try: () => bytesToHex(schnorr.getPublicKey(hexToBytes(seckey))),
      catch: (error) => invalidKey(`failed to derive public key: ${error}`),
    })

    let oa: OwnerAttestationField | undefined
    if (options.oa !== undefined) {
      const normalized = yield* normalizeOwnerAttestation(options.oa)
      oa = yield* validateOwnerAttestation(normalized, pk)
    }

    const hash = signingHash(payload, t, oa)
    const aux =
      options.auxRand !== undefined
        ? options.auxRand
        : crypto.getRandomValues(new Uint8Array(32))

    if (aux.byteLength !== 32) {
      return yield* Effect.fail(invalidKey("auxRand must be exactly 32 bytes"))
    }

    const sig = yield* Effect.try({
      try: () => bytesToHex(schnorr.sign(hash, hexToBytes(seckey), aux)),
      catch: (error) => invalidKey(`failed to sign: ${error}`),
    })

    return oa
      ? { v: 1 as const, pk, sig, t, oa }
      : { v: 1 as const, pk, sig, t }
  })

/** Sign and return the full armored detached signature string. */
export const signGitObjectArmored = (
  payload: Uint8Array,
  seckey: string,
  options: SignGitObjectOptions = {}
): Effect.Effect<string, NipGsError> =>
  signGitObject(payload, seckey, options).pipe(
    Effect.map(encodeArmoredSignature)
  )

/**
 * Resolve trust level from an optional configured signing key.
 * Accepts 64-hex (any case) or `npub1…` (NIP-19 bech32).
 */
export const resolveTrustLevel = (
  pk: string,
  signingKey?: string
): TrustLevel => {
  if (!signingKey) return "UNDEFINED"
  const trimmed = signingKey.trim()
  if (trimmed === "") return "UNDEFINED"

  let normalized: string | undefined
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    normalized = trimmed.toLowerCase()
  } else if (trimmed.startsWith("npub1")) {
    try {
      const decoded = bech32.decode(trimmed as `${string}1${string}`)
      const bytes = Uint8Array.from(bech32.fromWords(decoded.words))
      if (bytes.length === 32) {
        normalized = bytesToHex(bytes)
      }
    } catch {
      return "UNDEFINED"
    }
  } else {
    return "UNDEFINED"
  }

  if (normalized && normalized === pk.toLowerCase()) return "FULLY"
  return "UNDEFINED"
}

/**
 * Verify an armored (or already-parsed) NIP-GS signature over a git payload.
 *
 * On cryptographic failure returns a failed Effect with `bad_signature`.
 * On structural failure returns `malformed_envelope`.
 * On success, includes trust level and optional owner-attestation outcome.
 *
 * When `oa` is present but the owner Schnorr check fails, the commit signature
 * is still reported valid (`GOODSIG`) with `ownerAttestation.valid = false`.
 */
export const verifyGitObject = (
  payload: Uint8Array,
  signature: string | GitSignatureEnvelope,
  options: VerifyGitObjectOptions = {}
): Effect.Effect<VerifyGitObjectSuccess, NipGsError> =>
  Effect.gen(function* () {
    yield* ensurePayloadSize(payload)

    const envelope: GitSignatureEnvelope =
      typeof signature === "string"
        ? yield* parseArmoredSignature(signature)
        : signature

    const hash = signingHash(payload, envelope.t, envelope.oa)
    const ok = yield* Effect.try({
      try: () =>
        schnorr.verify(
          hexToBytes(envelope.sig),
          hash,
          hexToBytes(envelope.pk)
        ),
      catch: (error) => malformed(`failed to verify signature: ${error}`),
    })

    if (!ok) {
      return yield* Effect.fail(
        badSignature("BIP-340 signature does not verify over git object hash")
      )
    }

    const trust = resolveTrustLevel(envelope.pk, options.signingKey)

    let ownerAttestation: OwnerAttestationOutcome | undefined
    if (envelope.oa) {
      const oaOk = yield* verifyOwnerAttestation(envelope.oa, envelope.pk)
      ownerAttestation = {
        present: true,
        valid: oaOk,
        ownerPubkey: envelope.oa.ownerPubkey,
        conditions: envelope.oa.conditions,
      }
    }

    return {
      valid: true as const,
      envelope,
      trust,
      ...(ownerAttestation ? { ownerAttestation } : {}),
    }
  })

// =============================================================================
// Service Interface
// =============================================================================

export interface GitObjectSigningService {
  readonly _tag: "GitObjectSigningService"

  /** Sign a git object payload; returns the envelope. */
  sign(
    payload: Uint8Array,
    seckey: string,
    options?: SignGitObjectOptions
  ): Effect.Effect<GitSignatureEnvelope, NipGsError>

  /** Sign and return armored detached signature text. */
  signArmored(
    payload: Uint8Array,
    seckey: string,
    options?: SignGitObjectOptions
  ): Effect.Effect<string, NipGsError>

  /** Verify an armored signature or envelope over a payload. */
  verify(
    payload: Uint8Array,
    signature: string | GitSignatureEnvelope,
    options?: VerifyGitObjectOptions
  ): Effect.Effect<VerifyGitObjectSuccess, NipGsError>

  /** Parse an armored signature into a validated envelope. */
  parseArmor(
    armored: string
  ): Effect.Effect<GitSignatureEnvelope, NipGsError>

  /** Encode an envelope as armored text. */
  encodeArmor(envelope: GitSignatureEnvelope): string
}

// =============================================================================
// Service Tag / Implementation / Layer
// =============================================================================

export const GitObjectSigningService =
  Context.Service<GitObjectSigningService>("GitObjectSigningService")

const make: GitObjectSigningService = {
  _tag: "GitObjectSigningService",
  sign: signGitObject,
  signArmored: signGitObjectArmored,
  verify: verifyGitObject,
  parseArmor: parseArmoredSignature,
  encodeArmor: encodeArmoredSignature,
}

export const GitObjectSigningServiceLive = Layer.succeed(
  GitObjectSigningService,
  make
)
