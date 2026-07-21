/**
 * PushLeaseService
 *
 * NIP-PL: Push Leases (buzz-parity draft) — WIRE FORMAT ONLY.
 *
 * A push lease is an addressable `kind:30350` event that authorizes a push
 * executor to keep a constrained Nostr filter active after the client socket
 * closes and wake a specific installation through a platform push transport.
 *
 * Scope of this module:
 * - Lease event schema (active + inactive tombstone plaintext)
 * - Public tags (`d`, `expiration`, `exec`, optional `alt`)
 * - NIP-44 encrypt / decrypt to the executor's advertised encryption key
 * - Restricted subscription filter grammar helpers (narrowing, exact values,
 *   self-scoped `#p`, allow-listed kinds, forbidden NIP-01 fields)
 * - Client helpers to build, publish, revoke, list, get, and decrypt leases
 *
 * OUT OF SCOPE (intentionally not implemented):
 * - The public Buzz APNs gateway profile at `https://push.buzz.xyz`
 * - App Attest enrollment / assertion transcripts
 * - Gateway HTTP routes (installations, delegations, deliveries)
 * - buzz-relay dispatch / matching / coalescing seams
 * - Platform transport payload construction (APNs/FCM/UnifiedPush)
 *
 * Gateway and executor-side matching are separate profiles/deployments; this
 * module is the protocol wire format a client uses to author and read leases.
 *
 * @see NIP-PL spec (buzz `docs/nips/NIP-PL.md`)
 * @see https://github.com/nostr-protocol/nips/blob/master/44.md (NIP-44)
 * @see https://github.com/nostr-protocol/nips/blob/master/40.md (NIP-40)
 * @see https://github.com/nostr-protocol/nips/blob/master/01.md (NIP-01 filters)
 */
import { Context, Data, Effect, Layer, Option, Schema, Stream } from "effect"
import { randomBytes, bytesToHex } from "@noble/hashes/utils"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { Nip44Service, type EncryptedPayload } from "../services/Nip44Service.js"
import { CryptoService } from "../services/CryptoService.js"
import {
  type NostrEvent,
  type PrivateKey,
  type PublicKey,
  EventKind,
  Filter,
  Tag,
} from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

// =============================================================================
// Constants
// =============================================================================

/** Addressable event kind for NIP-PL push leases. */
export const PUSH_LEASE_KIND = 30350

/** Default NIP-31 `alt` fallback text. */
const DEFAULT_ALT = "Push lease"

/** Spec default for `max_lease_ttl` (30 days, seconds). */
export const DEFAULT_MAX_LEASE_TTL = 2_592_000

/** Spec RECOMMENDED `allowed_skew` (15 minutes, seconds). */
export const DEFAULT_ALLOWED_SKEW = 900

/** Spec default descriptor limits (Executor Discovery). */
export const DEFAULT_FILTER_LIMITS = {
  maxKinds: 16,
  maxAuthors: 20,
  maxH: 50,
  maxTagValues: 20,
  maxIgnore: 8,
  maxStringLen: 512,
  maxEndpointLen: 4096,
  maxSubscriptionsPerLease: 16,
} as const

/** Priority classes ordered lowest → highest. */
export const PRIORITY_CLASSES = ["silent", "default", "time_sensitive", "urgent"] as const
export type PriorityClass = (typeof PRIORITY_CLASSES)[number]

/** Supported transport profile identifiers (v1 schema). */
export const TRANSPORTS = ["apns", "fcm", "unifiedpush"] as const
export type Transport = (typeof TRANSPORTS)[number]

const HEX64 = /^[0-9a-f]{64}$/
const UUID_V4_LOWERCASE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const POSITIVE_SAFE_INT = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 1

// =============================================================================
// Errors
// =============================================================================

/** Failure while building, publishing, reading, or decrypting a push lease. */
export class PushLeaseError extends Data.TaggedError("PushLeaseError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// =============================================================================
// Content schema (v=1)
// =============================================================================

/** A restricted NIP-01 filter object as carried inside lease plaintext. */
export type LeaseFilter = {
  readonly kinds: readonly number[]
  readonly authors?: readonly string[]
  readonly "#p"?: readonly string[]
  readonly "#h"?: readonly string[]
  readonly "#e"?: readonly string[]
}

/** Hellthread gate: drop wakes when the matched event has too many `p` tags. */
export type Suppress = {
  readonly p_tags_max: number
}

/** One subscription entry inside an active lease. */
export type LeaseSubscription = {
  readonly filter: LeaseFilter
  readonly class: PriorityClass
  readonly ignore?: readonly LeaseFilter[]
  readonly suppress?: Suppress
}

/**
 * Active lease plaintext (`active: true`).
 * Required members are exactly the set below — no optional top-level members.
 */
export type ActiveLeaseContent = {
  readonly v: 1
  readonly origin: string
  readonly app_profile: string
  readonly transport: Transport
  readonly endpoint: string
  readonly generation: number
  readonly active: true
  readonly subscriptions: readonly LeaseSubscription[]
}

/**
 * Inactive (revocation tombstone) plaintext (`active: false`).
 * Exactly `{v, origin, generation, active}` — transport fields MUST be absent.
 */
export type InactiveLeaseContent = {
  readonly v: 1
  readonly origin: string
  readonly generation: number
  readonly active: false
}

export type LeaseContent = ActiveLeaseContent | InactiveLeaseContent

// =============================================================================
// Options
// =============================================================================

/** Bounds used by the restricted filter grammar (descriptor-advertised). */
export type FilterLimits = {
  readonly maxKinds?: number
  readonly maxAuthors?: number
  readonly maxH?: number
  readonly maxTagValues?: number
  readonly maxIgnore?: number
  readonly maxStringLen?: number
  readonly maxEndpointLen?: number
  readonly maxSubscriptionsPerLease?: number
  /** When set, every filter `kinds` entry must be in this set. */
  readonly pushKinds?: readonly number[]
  /**
   * Channel-identifier grammar for `#h` values.
   * `"uuid-v4-lowercase"` is the initial registry entry; `"any"` skips the
   * channel-id check (still enforces non-empty / max length).
   */
  readonly hGrammar?: "uuid-v4-lowercase" | "any"
}

export interface CreateLeaseOptions {
  /**
   * Addressable `d` value (per-origin installation id). Omit to mint a fresh
   * 128-bit random id. Provide the existing `d` to replace a lease address.
   */
  readonly d?: string
  /** NIP-40 expiration (Unix seconds). REQUIRED by the public tags rules. */
  readonly expiration: number
  /** Descriptor encryption-key id the content was produced for. */
  readonly exec: string
  /** Executor's advertised encryption pubkey (64 lowercase hex). */
  readonly executorPubkey: string
  /** Active lease plaintext (will be NIP-44 encrypted to the executor). */
  readonly content: ActiveLeaseContent
  /** Override the `alt` fallback text. */
  readonly alt?: string
  /** Override `created_at` (seconds). Defaults to now. */
  readonly createdAt?: number
  /** Optional filter-grammar bounds applied before encrypting. */
  readonly limits?: FilterLimits
  /**
   * Author pubkey used for self-scoped `#p` checks. Defaults to the public
   * key derived from the signing private key.
   */
  readonly authorPubkey?: string
}

export interface RevokeLeaseOptions {
  readonly d: string
  readonly expiration: number
  readonly exec: string
  readonly executorPubkey: string
  /** Inactive plaintext: origin + generation (active forced to false). */
  readonly origin: string
  readonly generation: number
  readonly alt?: string
  readonly createdAt?: number
}

export interface ListLeasesOptions {
  readonly author: string
  /** Private key of the executor (or author when they hold the same conv key path). */
  readonly decryptPrivateKey: PrivateKey
  /**
   * When decrypting as the lease author, pass the executor pubkey used at
   * encrypt time. When decrypting as the executor, omit this (conversation key
   * is derived against `event.pubkey`).
   */
  readonly peerPubkey?: string
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface GetLeaseOptions {
  readonly author: string
  readonly d: string
  readonly timeoutMs?: number
}

export interface DecryptLeaseOptions {
  readonly event: NostrEvent
  readonly decryptPrivateKey: PrivateKey
  /**
   * When decrypting as the author, the executor's encryption pubkey.
   * When decrypting as the executor, omit (peer is `event.pubkey`).
   */
  readonly peerPubkey?: string
}

/** A lease decoded from a relay: outer event plus parsed state. */
export interface DecodedLease {
  readonly event: NostrEvent
  /** Addressable coordinate `30350:<pubkey>:<d>`. */
  readonly address: string
  readonly d: string
  readonly expiration: number | null
  readonly exec: string | null
  /** Decrypted content, or `null` when it could not be decrypted/validated. */
  readonly content: LeaseContent | null
}

// =============================================================================
// Pure helpers — ids, tags, JSON
// =============================================================================

/** Generate a fresh opaque installation `d` with 128 bits of entropy. */
export const generateInstallationId = (): string => bytesToHex(randomBytes(16))

/** Compare priority classes; higher wins. Returns negative if a < b. */
export const comparePriorityClass = (a: PriorityClass, b: PriorityClass): number =>
  PRIORITY_CLASSES.indexOf(a) - PRIORITY_CLASSES.indexOf(b)

/** Highest of several priority classes (or `null` if the list is empty). */
export const maxPriorityClass = (
  classes: readonly PriorityClass[]
): PriorityClass | null => {
  if (classes.length === 0) return null
  return classes.reduce((best, c) => (comparePriorityClass(c, best) > 0 ? c : best))
}

/**
 * Parse JSON while rejecting duplicate object keys at any depth (fail-closed
 * per NIP-PL: parsers MUST reject duplicate keys anywhere in the plaintext).
 */
export const parseJsonRejectDuplicates = (
  text: string
): { ok: true; value: unknown } | { ok: false; reason: string } => {
  let i = 0
  const s = text
  const len = s.length

  const skipWs = () => {
    while (i < len && (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r")) i++
  }

  const fail = (reason: string): never => {
    throw new Error(reason)
  }

  const parseString = (): string => {
    if (s[i] !== '"') fail("expected string")
    i++
    let out = ""
    while (i < len) {
      const c = s[i]!
      if (c === '"') {
        i++
        return out
      }
      if (c === "\\") {
        i++
        if (i >= len) fail("unterminated escape")
        const e = s[i]!
        i++
        switch (e) {
          case '"':
          case "\\":
          case "/":
            out += e
            break
          case "b":
            out += "\b"
            break
          case "f":
            out += "\f"
            break
          case "n":
            out += "\n"
            break
          case "r":
            out += "\r"
            break
          case "t":
            out += "\t"
            break
          case "u": {
            const hex = s.slice(i, i + 4)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("bad unicode escape")
            out += String.fromCharCode(parseInt(hex, 16))
            i += 4
            break
          }
          default:
            fail("bad escape")
        }
        continue
      }
      if (c.charCodeAt(0) < 0x20) fail("control char in string")
      out += c
      i++
    }
    return fail("unterminated string")
  }

  const parseNumber = (): number => {
    const start = i
    if (s[i] === "-") i++
    if (s[i] === "0") {
      i++
    } else if (s[i]! >= "1" && s[i]! <= "9") {
      while (i < len && s[i]! >= "0" && s[i]! <= "9") i++
    } else {
      fail("bad number")
    }
    if (s[i] === ".") {
      i++
      if (!(s[i]! >= "0" && s[i]! <= "9")) fail("bad fraction")
      while (i < len && s[i]! >= "0" && s[i]! <= "9") i++
    }
    if (s[i] === "e" || s[i] === "E") {
      i++
      if (s[i] === "+" || s[i] === "-") i++
      if (!(s[i]! >= "0" && s[i]! <= "9")) fail("bad exponent")
      while (i < len && s[i]! >= "0" && s[i]! <= "9") i++
    }
    const n = Number(s.slice(start, i))
    if (!Number.isFinite(n)) fail("non-finite number")
    return n
  }

  const parseValue = (): unknown => {
    skipWs()
    if (i >= len) fail("unexpected end")
    const c = s[i]!
    if (c === "{") {
      i++
      skipWs()
      const obj: Record<string, unknown> = {}
      const keys = new Set<string>()
      if (s[i] === "}") {
        i++
        return obj
      }
      while (true) {
        skipWs()
        if (s[i] !== '"') fail("expected object key")
        const key = parseString()
        if (keys.has(key)) fail(`duplicate key: ${key}`)
        keys.add(key)
        skipWs()
        if (s[i] !== ":") fail("expected ':'")
        i++
        obj[key] = parseValue()
        skipWs()
        if (s[i] === ",") {
          i++
          continue
        }
        if (s[i] === "}") {
          i++
          return obj
        }
        fail("expected ',' or '}'")
      }
    }
    if (c === "[") {
      i++
      skipWs()
      const arr: unknown[] = []
      if (s[i] === "]") {
        i++
        return arr
      }
      while (true) {
        arr.push(parseValue())
        skipWs()
        if (s[i] === ",") {
          i++
          continue
        }
        if (s[i] === "]") {
          i++
          return arr
        }
        fail("expected ',' or ']'")
      }
    }
    if (c === '"') return parseString()
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber()
    if (s.startsWith("true", i)) {
      i += 4
      return true
    }
    if (s.startsWith("false", i)) {
      i += 5
      return false
    }
    if (s.startsWith("null", i)) {
      i += 4
      return null
    }
    fail("unexpected token")
  }

  try {
    const value = parseValue()
    skipWs()
    if (i !== len) return { ok: false, reason: "trailing data" }
    return { ok: true, value }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** The addressable `d` value of an event, or `null` when absent/duplicated. */
export const getLeaseD = (event: {
  readonly tags: readonly (readonly string[])[]
}): string | null => {
  const found = event.tags.filter((t) => t[0] === "d")
  if (found.length !== 1) return null
  const d = found[0]?.[1]
  return d && d.length > 0 && found[0]!.length === 2 ? d : null
}

/** The single `exec` tag value, or `null` when absent/duplicated/malformed. */
export const getLeaseExec = (event: {
  readonly tags: readonly (readonly string[])[]
}): string | null => {
  const found = event.tags.filter((t) => t[0] === "exec")
  if (found.length !== 1) return null
  const v = found[0]?.[1]
  return v && v.length > 0 && found[0]!.length === 2 ? v : null
}

/** The single `expiration` tag as Unix seconds, or `null` when invalid. */
export const getLeaseExpiration = (event: {
  readonly tags: readonly (readonly string[])[]
}): number | null => {
  const found = event.tags.filter((t) => t[0] === "expiration")
  if (found.length !== 1) return null
  if (found[0]!.length !== 2) return null
  const raw = found[0]?.[1]
  if (raw === undefined || !/^(0|[1-9][0-9]*)$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 0) return null
  return n
}

/**
 * Validate public tags for a push lease.
 * Allowed set: exactly one `d`, one `expiration`, one `exec`, and at most one
 * `alt`, each with exactly one value. Extra tags or values are rejected.
 */
export const validateLeasePublicTags = (
  tags: readonly (readonly string[])[]
): { ok: true } | { ok: false; reason: string } => {
  let d = 0
  let expiration = 0
  let exec = 0
  let alt = 0

  for (const t of tags) {
    if (t.length < 1) return { ok: false, reason: "empty tag" }
    const name = t[0]
    if (name !== "d" && name !== "expiration" && name !== "exec" && name !== "alt") {
      return { ok: false, reason: `extra tag: ${name}` }
    }
    if (t.length !== 2 || t[1] === undefined || t[1].length === 0) {
      return { ok: false, reason: `tag ${name} must have exactly one non-empty value` }
    }
    if (name === "d") d++
    else if (name === "expiration") expiration++
    else if (name === "exec") exec++
    else alt++
  }

  if (d !== 1) return { ok: false, reason: "exactly one d tag required" }
  if (expiration !== 1) return { ok: false, reason: "exactly one expiration tag required" }
  if (exec !== 1) return { ok: false, reason: "exactly one exec tag required" }
  if (alt > 1) return { ok: false, reason: "at most one alt tag allowed" }

  // expiration must parse
  if (getLeaseExpiration({ tags }) === null) {
    return { ok: false, reason: "invalid expiration value" }
  }

  return { ok: true }
}

/**
 * Check `expiration` against the NIP-PL acceptance window:
 * `now - allowed_skew < expiration ≤ now + max_lease_ttl`.
 */
export const validateLeaseTtl = (
  expiration: number,
  now: number = Math.floor(Date.now() / 1000),
  opts: { maxLeaseTtl?: number; allowedSkew?: number } = {}
): { ok: true } | { ok: false; reason: string } => {
  const maxTtl = opts.maxLeaseTtl ?? DEFAULT_MAX_LEASE_TTL
  const skew = opts.allowedSkew ?? DEFAULT_ALLOWED_SKEW
  if (!Number.isSafeInteger(expiration) || expiration < 0) {
    return { ok: false, reason: "invalid: lease expiration not an integer" }
  }
  if (expiration <= now - skew) {
    return { ok: false, reason: "invalid: lease already expired" }
  }
  if (expiration > now + maxTtl) {
    return { ok: false, reason: "invalid: lease ttl too long" }
  }
  return { ok: true }
}

// =============================================================================
// Restricted filter grammar
// =============================================================================

const mergeLimits = (limits?: FilterLimits) => ({
  maxKinds: limits?.maxKinds ?? DEFAULT_FILTER_LIMITS.maxKinds,
  maxAuthors: limits?.maxAuthors ?? DEFAULT_FILTER_LIMITS.maxAuthors,
  maxH: limits?.maxH ?? DEFAULT_FILTER_LIMITS.maxH,
  maxTagValues: limits?.maxTagValues ?? DEFAULT_FILTER_LIMITS.maxTagValues,
  maxIgnore: limits?.maxIgnore ?? DEFAULT_FILTER_LIMITS.maxIgnore,
  maxStringLen: limits?.maxStringLen ?? DEFAULT_FILTER_LIMITS.maxStringLen,
  maxEndpointLen: limits?.maxEndpointLen ?? DEFAULT_FILTER_LIMITS.maxEndpointLen,
  maxSubscriptionsPerLease:
    limits?.maxSubscriptionsPerLease ?? DEFAULT_FILTER_LIMITS.maxSubscriptionsPerLease,
  pushKinds: limits?.pushKinds,
  hGrammar: limits?.hGrammar ?? "any",
})

const isHex64 = (v: unknown): v is string => typeof v === "string" && HEX64.test(v)

const validateHValue = (
  v: string,
  maxStringLen: number,
  hGrammar: "uuid-v4-lowercase" | "any"
): string | null => {
  if (v.length === 0) return "empty #h value"
  if (v.length > maxStringLen) return `#h value exceeds max_string_len (${maxStringLen})`
  if (hGrammar === "uuid-v4-lowercase" && !UUID_V4_LOWERCASE.test(v)) {
    return "invalid: #h fails h_grammar uuid-v4-lowercase"
  }
  return null
}

/**
 * Validate a single restricted lease filter.
 *
 * @param filter - Candidate NIP-01 filter object (plain object)
 * @param authorPubkey - Lease author; every `#p` value MUST equal this
 * @param limits - Descriptor-advertised bounds
 * @param opts.requireNarrowing - When false (for `ignore` filters), skip the
 *   "must contain #p / #h / authors" rule
 */
export const validateLeaseFilter = (
  filter: unknown,
  authorPubkey: string,
  limits?: FilterLimits,
  opts: { requireNarrowing?: boolean } = {}
): { ok: true; filter: LeaseFilter } | { ok: false; reason: string } => {
  const requireNarrowing = opts.requireNarrowing !== false
  const L = mergeLimits(limits)

  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
    return { ok: false, reason: "filter must be an object" }
  }
  const f = filter as Record<string, unknown>

  // Forbidden NIP-01 fields — reject, do not ignore.
  for (const banned of ["since", "until", "ids", "limit", "search"] as const) {
    if (f[banned] !== undefined) {
      return { ok: false, reason: `invalid: lease filter must not include ${banned}` }
    }
  }

  // Only kinds, authors, #p, #h, #e are permitted.
  const allowed = new Set(["kinds", "authors", "#p", "#h", "#e"])
  for (const key of Object.keys(f)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: `invalid: unknown filter member ${key}` }
    }
  }

  // kinds — required, bounded, optionally allow-listed.
  if (f["kinds"] === undefined) {
    return { ok: false, reason: "invalid: lease filter missing kinds" }
  }
  if (!Array.isArray(f["kinds"]) || f["kinds"].length === 0) {
    return { ok: false, reason: "invalid: kinds must be a non-empty array" }
  }
  if (f["kinds"].length > L.maxKinds) {
    return { ok: false, reason: `invalid: kinds exceeds max_kinds (${L.maxKinds})` }
  }
  const kinds: number[] = []
  for (const k of f["kinds"]) {
    if (typeof k !== "number" || !Number.isSafeInteger(k) || k < 0) {
      return { ok: false, reason: "invalid: kind must be a non-negative integer" }
    }
    // Ephemeral kinds 20000–29999 MUST NOT be push-eligible.
    if (k >= 20000 && k <= 29999) {
      return { ok: false, reason: "invalid: kind not push-eligible (ephemeral)" }
    }
    if (L.pushKinds !== undefined && !L.pushKinds.includes(k)) {
      return { ok: false, reason: "invalid: kind not push-eligible" }
    }
    kinds.push(k)
  }

  // authors
  let authors: string[] | undefined
  if (f["authors"] !== undefined) {
    if (!Array.isArray(f["authors"]) || f["authors"].length === 0) {
      return { ok: false, reason: "invalid: authors must be a non-empty array" }
    }
    if (f["authors"].length > L.maxAuthors) {
      return { ok: false, reason: `invalid: authors exceeds max_authors (${L.maxAuthors})` }
    }
    authors = []
    for (const a of f["authors"]) {
      if (!isHex64(a)) {
        return { ok: false, reason: "invalid: non-exact match value" }
      }
      authors.push(a)
    }
  }

  // #p — self only, exact hex
  let pTags: string[] | undefined
  if (f["#p"] !== undefined) {
    if (!Array.isArray(f["#p"]) || f["#p"].length === 0) {
      return { ok: false, reason: "invalid: #p must be a non-empty array" }
    }
    if (f["#p"].length > L.maxTagValues) {
      return { ok: false, reason: `invalid: #p exceeds max_tag_values (${L.maxTagValues})` }
    }
    pTags = []
    for (const p of f["#p"]) {
      if (!isHex64(p)) {
        return { ok: false, reason: "invalid: non-exact match value" }
      }
      if (p !== authorPubkey) {
        return { ok: false, reason: "invalid: p-tag must be self" }
      }
      pTags.push(p)
    }
  }

  // #h
  let hTags: string[] | undefined
  if (f["#h"] !== undefined) {
    if (!Array.isArray(f["#h"]) || f["#h"].length === 0) {
      return { ok: false, reason: "invalid: #h must be a non-empty array" }
    }
    if (f["#h"].length > L.maxH) {
      return { ok: false, reason: `invalid: #h exceeds max_h (${L.maxH})` }
    }
    hTags = []
    for (const h of f["#h"]) {
      if (typeof h !== "string") {
        return { ok: false, reason: "invalid: #h values must be strings" }
      }
      const herr = validateHValue(h, L.maxStringLen, L.hGrammar)
      if (herr) return { ok: false, reason: herr }
      hTags.push(h)
    }
  }

  // #e — exact event ids, not a narrowing selector on its own
  let eTags: string[] | undefined
  if (f["#e"] !== undefined) {
    if (!Array.isArray(f["#e"]) || f["#e"].length === 0) {
      return { ok: false, reason: "invalid: #e must be a non-empty array" }
    }
    if (f["#e"].length > L.maxTagValues) {
      return { ok: false, reason: `invalid: #e exceeds max_tag_values (${L.maxTagValues})` }
    }
    eTags = []
    for (const e of f["#e"]) {
      if (!isHex64(e)) {
        return { ok: false, reason: "invalid: non-exact match value" }
      }
      eTags.push(e)
    }
  }

  // Narrowing selector required for subscription filters (not for ignore).
  if (requireNarrowing) {
    const narrowed =
      (pTags !== undefined && pTags.length > 0) ||
      (hTags !== undefined && hTags.length > 0) ||
      (authors !== undefined && authors.length > 0)
    if (!narrowed) {
      return { ok: false, reason: "invalid: lease filter not narrowed" }
    }
  }

  const out: LeaseFilter = {
    kinds,
    ...(authors !== undefined ? { authors } : {}),
    ...(pTags !== undefined ? { "#p": pTags } : {}),
    ...(hTags !== undefined ? { "#h": hTags } : {}),
    ...(eTags !== undefined ? { "#e": eTags } : {}),
  }
  return { ok: true, filter: out }
}

/**
 * Validate a full active or inactive lease plaintext object (already parsed).
 * Fail-closed: unknown fields, wrong types, empty subscriptions, bad filters.
 */
export const validateLeaseContent = (
  raw: unknown,
  authorPubkey: string,
  limits?: FilterLimits
): { ok: true; content: LeaseContent } | { ok: false; reason: string } => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "invalid: plaintext must be an object" }
  }
  const obj = raw as Record<string, unknown>
  const L = mergeLimits(limits)

  if (obj["v"] !== 1) {
    return { ok: false, reason: "invalid: unsupported or missing v" }
  }
  if (typeof obj["origin"] !== "string" || obj["origin"].length === 0) {
    return { ok: false, reason: "invalid: origin must be a non-empty string" }
  }
  if (obj["origin"].length > L.maxStringLen) {
    return { ok: false, reason: "invalid: origin exceeds max_string_len" }
  }
  if (!POSITIVE_SAFE_INT(obj["generation"])) {
    return { ok: false, reason: "invalid: generation must be a positive integer" }
  }
  if (typeof obj["active"] !== "boolean") {
    return { ok: false, reason: "invalid: active must be a boolean" }
  }

  if (obj["active"] === false) {
    // Inactive tombstone: exactly {v, origin, generation, active}
    const keys = Object.keys(obj)
    const allowed = new Set(["v", "origin", "generation", "active"])
    for (const k of keys) {
      if (!allowed.has(k)) {
        return { ok: false, reason: `invalid: unknown field ${k}` }
      }
    }
    return {
      ok: true,
      content: {
        v: 1,
        origin: obj["origin"],
        generation: obj["generation"],
        active: false,
      },
    }
  }

  // Active lease: required members exactly the schema set; no extras.
  const required = [
    "v",
    "origin",
    "app_profile",
    "transport",
    "endpoint",
    "generation",
    "active",
    "subscriptions",
  ] as const
  const allowedActive = new Set<string>(required)
  for (const k of Object.keys(obj)) {
    if (!allowedActive.has(k)) {
      return { ok: false, reason: `invalid: unknown field ${k}` }
    }
  }
  for (const k of required) {
    if (obj[k] === undefined) {
      return { ok: false, reason: `invalid: missing field ${k}` }
    }
  }

  if (typeof obj["app_profile"] !== "string" || obj["app_profile"].length === 0) {
    return { ok: false, reason: "invalid: app_profile must be a non-empty string" }
  }
  if (obj["app_profile"].length > L.maxStringLen) {
    return { ok: false, reason: "invalid: app_profile exceeds max_string_len" }
  }
  if (
    typeof obj["transport"] !== "string" ||
    !(TRANSPORTS as readonly string[]).includes(obj["transport"])
  ) {
    return { ok: false, reason: "invalid: transport must be apns|fcm|unifiedpush" }
  }
  if (typeof obj["endpoint"] !== "string" || obj["endpoint"].length === 0) {
    return { ok: false, reason: "invalid: endpoint must be a non-empty string" }
  }
  if (obj["endpoint"].length > L.maxEndpointLen) {
    return { ok: false, reason: "invalid: endpoint exceeds max_endpoint_len" }
  }

  if (!Array.isArray(obj["subscriptions"]) || obj["subscriptions"].length === 0) {
    return { ok: false, reason: "invalid: subscriptions must be a non-empty array" }
  }
  if (obj["subscriptions"].length > L.maxSubscriptionsPerLease) {
    return {
      ok: false,
      reason: `invalid: subscriptions exceeds max_subscriptions_per_lease (${L.maxSubscriptionsPerLease})`,
    }
  }

  const subscriptions: LeaseSubscription[] = []
  for (const sub of obj["subscriptions"]) {
    if (sub === null || typeof sub !== "object" || Array.isArray(sub)) {
      return { ok: false, reason: "invalid: subscription must be an object" }
    }
    const s = sub as Record<string, unknown>
    for (const k of Object.keys(s)) {
      if (k !== "filter" && k !== "class" && k !== "ignore" && k !== "suppress") {
        return { ok: false, reason: `invalid: unknown field ${k}` }
      }
    }
    if (s["filter"] === undefined || s["class"] === undefined) {
      return { ok: false, reason: "invalid: subscription requires filter and class" }
    }
    if (
      typeof s["class"] !== "string" ||
      !(PRIORITY_CLASSES as readonly string[]).includes(s["class"])
    ) {
      return { ok: false, reason: "invalid: class not in registry" }
    }

    const fv = validateLeaseFilter(s["filter"], authorPubkey, limits, {
      requireNarrowing: true,
    })
    if (!fv.ok) return fv

    let ignore: LeaseFilter[] | undefined
    if (s["ignore"] !== undefined) {
      if (!Array.isArray(s["ignore"])) {
        return { ok: false, reason: "invalid: ignore must be an array" }
      }
      if (s["ignore"].length > L.maxIgnore) {
        return { ok: false, reason: `invalid: ignore exceeds max_ignore (${L.maxIgnore})` }
      }
      ignore = []
      for (const ig of s["ignore"]) {
        const iv = validateLeaseFilter(ig, authorPubkey, limits, {
          requireNarrowing: false,
        })
        if (!iv.ok) return { ok: false, reason: `invalid ignore: ${iv.reason}` }
        ignore.push(iv.filter)
      }
    }

    let suppress: Suppress | undefined
    if (s["suppress"] !== undefined) {
      if (
        s["suppress"] === null ||
        typeof s["suppress"] !== "object" ||
        Array.isArray(s["suppress"])
      ) {
        return { ok: false, reason: "invalid: suppress must be an object" }
      }
      const sp = s["suppress"] as Record<string, unknown>
      for (const k of Object.keys(sp)) {
        if (k !== "p_tags_max") {
          return { ok: false, reason: `invalid: unknown field ${k}` }
        }
      }
      if (!POSITIVE_SAFE_INT(sp["p_tags_max"])) {
        return { ok: false, reason: "invalid: p_tags_max must be a positive integer" }
      }
      suppress = { p_tags_max: sp["p_tags_max"] }
    }

    subscriptions.push({
      filter: fv.filter,
      class: s["class"] as PriorityClass,
      ...(ignore !== undefined ? { ignore } : {}),
      ...(suppress !== undefined ? { suppress } : {}),
    })
  }

  return {
    ok: true,
    content: {
      v: 1,
      origin: obj["origin"],
      app_profile: obj["app_profile"],
      transport: obj["transport"] as Transport,
      endpoint: obj["endpoint"],
      generation: obj["generation"],
      active: true,
      subscriptions,
    },
  }
}

/**
 * Parse and validate a decrypted lease plaintext string.
 * Rejects duplicate JSON keys and unknown/malformed schema members.
 */
export const parseLeaseContent = (
  plaintext: string,
  authorPubkey: string,
  limits?: FilterLimits
): LeaseContent | null => {
  const parsed = parseJsonRejectDuplicates(plaintext)
  if (!parsed.ok) return null
  const validated = validateLeaseContent(parsed.value, authorPubkey, limits)
  return validated.ok ? validated.content : null
}

/**
 * Serialize active/inactive lease content for encryption. Key order is stable
 * for readability; parsers accept any order.
 */
export const serializeLeaseContent = (content: LeaseContent): string => {
  if (content.active === false) {
    return JSON.stringify({
      v: content.v,
      origin: content.origin,
      generation: content.generation,
      active: false,
    })
  }
  return JSON.stringify({
    v: content.v,
    origin: content.origin,
    app_profile: content.app_profile,
    transport: content.transport,
    endpoint: content.endpoint,
    generation: content.generation,
    active: true,
    subscriptions: content.subscriptions.map((sub) => {
      const entry: Record<string, unknown> = {
        filter: sub.filter,
        class: sub.class,
      }
      if (sub.ignore !== undefined) entry["ignore"] = sub.ignore
      if (sub.suppress !== undefined) entry["suppress"] = sub.suppress
      return entry
    }),
  })
}

// =============================================================================
// Service Interface
// =============================================================================

export interface PushLeaseService {
  readonly _tag: "PushLeaseService"

  /**
   * Build the NIP-44-to-executor `kind:30350` lease and publish it.
   * Validates public tags, TTL window, and restricted filter grammar before
   * encrypting. Mints a fresh random `d` unless one is supplied for a replacement.
   */
  createLease(
    options: CreateLeaseOptions,
    privateKey: PrivateKey
  ): Effect.Effect<{ readonly result: PublishResult; readonly d: string }, PushLeaseError>

  /**
   * Revoke a lease by publishing a higher-generation inactive tombstone.
   * NIP-09 deletion is unsupported for kind 30350 — this is the only revoke path.
   */
  revokeLease(
    options: RevokeLeaseOptions,
    privateKey: PrivateKey
  ): Effect.Effect<{ readonly result: PublishResult; readonly d: string }, PushLeaseError>

  /** Fetch and decrypt the author's leases (latest head per address). */
  listLeases(options: ListLeasesOptions): Effect.Effect<readonly DecodedLease[], PushLeaseError>

  /** Fetch the latest raw event for a single lease address. */
  getLease(options: GetLeaseOptions): Effect.Effect<NostrEvent | null, PushLeaseError>

  /**
   * Verify signature, then decrypt and validate a lease's content.
   * Pass `peerPubkey` (executor) when decrypting as the author; omit when
   * decrypting as the executor (peer is the event author).
   */
  decryptLease(
    options: DecryptLeaseOptions
  ): Effect.Effect<LeaseContent | null, PushLeaseError>
}

export const PushLeaseService = Context.Service<PushLeaseService>("PushLeaseService")

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  const nip44 = yield* Nip44Service
  const crypto = yield* CryptoService

  const fail = (message: string, cause?: unknown) =>
    new PushLeaseError({ message, ...(cause !== undefined ? { cause } : {}) })

  const encryptToExecutor = (
    authorPrivateKey: PrivateKey,
    executorPubkey: string,
    content: LeaseContent
  ) =>
    Effect.gen(function* () {
      if (!HEX64.test(executorPubkey)) {
        return yield* Effect.fail(fail("invalid executor pubkey"))
      }
      const ck = yield* nip44.getConversationKey(
        authorPrivateKey,
        executorPubkey as PublicKey
      )
      const plaintext = serializeLeaseContent(content)
      return yield* nip44.encrypt(plaintext, ck)
    })

  const buildAndPublish = (
    privateKey: PrivateKey,
    d: string,
    content: LeaseContent,
    opts: {
      expiration: number
      exec: string
      executorPubkey: string
      alt?: string
      createdAt?: number
      limits?: FilterLimits
      authorPubkey?: string
    }
  ) =>
    Effect.gen(function* () {
      if (d.length === 0 || d.length > 64) {
        return yield* Effect.fail(fail("invalid: d must be 1..64 bytes"))
      }
      if (opts.exec.length === 0) {
        return yield* Effect.fail(fail("invalid: exec must be non-empty"))
      }

      const authorPub =
        opts.authorPubkey ?? (yield* crypto.getPublicKey(privateKey))

      // Validate content against restricted grammar before encrypting.
      const validated = validateLeaseContent(content, authorPub, opts.limits)
      if (!validated.ok) {
        return yield* Effect.fail(fail(validated.reason))
      }

      const ttl = validateLeaseTtl(opts.expiration)
      if (!ttl.ok) {
        return yield* Effect.fail(fail(ttl.reason))
      }

      const cipher = yield* encryptToExecutor(
        privateKey,
        opts.executorPubkey,
        validated.content
      )

      const tags: string[][] = [
        ["d", d],
        ["expiration", String(opts.expiration)],
        ["exec", opts.exec],
        ["alt", opts.alt ?? DEFAULT_ALT],
      ]

      const tagCheck = validateLeasePublicTags(tags)
      if (!tagCheck.ok) {
        return yield* Effect.fail(fail(tagCheck.reason))
      }

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(PUSH_LEASE_KIND),
          content: cipher,
          tags: tags.map((t) => decodeTag(t)),
          ...(opts.createdAt !== undefined
            ? { created_at: opts.createdAt as never }
            : {}),
        },
        privateKey
      )
      const result = yield* relay.publish(event)
      return { result, d }
    })

  const createLease: PushLeaseService["createLease"] = (options, privateKey) =>
    buildAndPublish(privateKey, options.d ?? generateInstallationId(), options.content, {
      expiration: options.expiration,
      exec: options.exec,
      executorPubkey: options.executorPubkey,
      ...(options.alt !== undefined ? { alt: options.alt } : {}),
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
      ...(options.limits !== undefined ? { limits: options.limits } : {}),
      ...(options.authorPubkey !== undefined
        ? { authorPubkey: options.authorPubkey }
        : {}),
    }).pipe(Effect.mapError((e) => (e instanceof PushLeaseError ? e : fail(String(e), e))))

  const revokeLease: PushLeaseService["revokeLease"] = (options, privateKey) => {
    const content: InactiveLeaseContent = {
      v: 1,
      origin: options.origin,
      generation: options.generation,
      active: false,
    }
    return buildAndPublish(privateKey, options.d, content, {
      expiration: options.expiration,
      exec: options.exec,
      executorPubkey: options.executorPubkey,
      ...(options.alt !== undefined ? { alt: options.alt } : {}),
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    }).pipe(Effect.mapError((e) => (e instanceof PushLeaseError ? e : fail(String(e), e))))
  }

  const decryptEvent = (
    event: NostrEvent,
    decryptPrivateKey: PrivateKey,
    peerPubkey?: string
  ) =>
    Effect.gen(function* () {
      if (!event.content || event.content.length === 0) return null
      if ((event.kind as number) !== PUSH_LEASE_KIND) return null

      const valid = yield* eventService.verifyEvent(event)
      if (!valid) return null

      // As executor: peer is the author (event.pubkey).
      // As author: peer is the executor pubkey used at encrypt time.
      const peer = (peerPubkey ?? event.pubkey) as PublicKey
      const ck = yield* nip44.getConversationKey(decryptPrivateKey, peer)
      const plaintext = yield* nip44.decrypt(event.content as EncryptedPayload, ck)
      return parseLeaseContent(plaintext, event.pubkey)
    })

  const decryptLease: PushLeaseService["decryptLease"] = ({
    event,
    decryptPrivateKey,
    peerPubkey,
  }) =>
    decryptEvent(event, decryptPrivateKey, peerPubkey).pipe(
      Effect.catch(() => Effect.succeed(null)),
      Effect.mapError((e) => fail(String(e), e))
    )

  const listLeases: PushLeaseService["listLeases"] = ({
    author,
    decryptPrivateKey,
    peerPubkey,
    limit,
    timeoutMs,
  }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(PUSH_LEASE_KIND)],
        authors: [author],
        ...(limit !== undefined ? { limit } : {}),
      } as never)
      const sub = yield* relay.subscribe([filter])

      const collected: NostrEvent[] = []
      const collectEffect = sub.events.pipe(
        Stream.takeUntil(() => false),
        Stream.runForEach((event) =>
          Effect.sync(() => {
            collected.push(event)
          })
        )
      )
      yield* Effect.race(collectEffect, Effect.sleep(timeoutMs ?? 800))
      yield* sub.unsubscribe()

      const heads = new Map<string, NostrEvent>()
      for (const ev of collected) {
        const d = getLeaseD(ev)
        if (d === null) continue
        const prev = heads.get(d)
        if (
          !prev ||
          ev.created_at > prev.created_at ||
          (ev.created_at === prev.created_at && ev.id < prev.id)
        ) {
          heads.set(d, ev)
        }
      }

      const out: DecodedLease[] = []
      for (const [d, ev] of heads) {
        const content = yield* decryptEvent(ev, decryptPrivateKey, peerPubkey).pipe(
          Effect.catch(() => Effect.succeed(null))
        )
        out.push({
          event: ev,
          address: `${PUSH_LEASE_KIND}:${ev.pubkey}:${d}`,
          d,
          expiration: getLeaseExpiration(ev),
          exec: getLeaseExec(ev),
          content,
        })
      }
      return out
    }).pipe(Effect.mapError((e) => fail(String(e), e)))

  const getLease: PushLeaseService["getLease"] = ({ author, d, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(PUSH_LEASE_KIND)],
        authors: [author],
        "#d": [d],
        limit: 1,
      } as never)
      const sub = yield* relay.subscribe([filter])
      const maybeEvent = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catch(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybeEvent) ? maybeEvent.value : null
    }).pipe(Effect.mapError((e) => fail(String(e), e)))

  return {
    _tag: "PushLeaseService" as const,
    createLease,
    revokeLease,
    listLeases,
    getLease,
    decryptLease,
  }
})

export const PushLeaseServiceLive = Layer.effect(PushLeaseService, make)
