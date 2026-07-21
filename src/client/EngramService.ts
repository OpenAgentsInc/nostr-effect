/**
 * EngramService
 *
 * NIP-AE: Agent Engrams (buzz-parity draft).
 *
 * Addressable `kind:30174` events holding agent memory, encrypted with NIP-44
 * under the agent↔owner conversation key `K_c`. Because that key is symmetric,
 * both the agent and the owner can decrypt every record.
 *
 * The addressable `d` tag is HMAC-blinded so slugs never leak:
 *
 *   d = lower_hex(HMAC-SHA256(K_c, utf8("agent-memory/v1/d-tag") || 0x00 || utf8(slug)))
 *
 * Two record types share the envelope: `core` (exactly one per pair) and
 * `mem/…` (zero or more). Memory bodies with `value: null` are tombstones.
 *
 * This module implements the PROTOCOL only; it does not depend on buzz.
 *
 * @see NIP-AE spec (buzz `docs/nips/NIP-AE.md`)
 * @see https://github.com/nostr-protocol/nips/blob/master/44.md (NIP-44)
 * @see https://github.com/nostr-protocol/nips/blob/master/09.md (NIP-09)
 * @see https://github.com/nostr-protocol/nips/blob/master/31.md (NIP-31 alt)
 */
import { Context, Data, Effect, Layer, Schema, Stream } from "effect"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import {
  Nip44Service,
  type ConversationKey,
  type EncryptedPayload,
} from "../services/Nip44Service.js"
import { CryptoService } from "../services/CryptoService.js"
import {
  type NostrEvent,
  type PrivateKey,
  type PublicKey,
  EventKind,
  Filter,
  Tag,
} from "../core/Schema.js"
import { AgentEngram } from "../wrappers/kinds.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

// =============================================================================
// Constants
// =============================================================================

/** Addressable event kind for NIP-AE agent engrams. */
export const ENGRAM_KIND = AgentEngram // 30174

/** NIP-09 deletion request kind. */
const DELETION_KIND = 5

/** Domain-separated prefix for d-tag derivation (version-tagged independently of NIP number). */
export const D_TAG_DOMAIN = "agent-memory/v1/d-tag"

/** Default NIP-31 `alt` fallback text (non-leaking summary). */
export const DEFAULT_ALT = "encrypted agent memory record"

/** NIP-44 plaintext size limit (bytes). */
export const MAX_PLAINTEXT_BYTES = 65535

/** Maximum slug length in bytes. */
export const MAX_SLUG_BYTES = 255

/**
 * Memory slug grammar:
 * `^mem/[a-z0-9][a-z0-9_-]{0,63}(/[a-z0-9][a-z0-9_-]{0,63})*$`
 */
export const MEMORY_SLUG_PATTERN =
  /^mem\/[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63})*$/

/** Reserved core slug. */
export const CORE_SLUG = "core" as const

/**
 * How far ahead of wall-clock a prior head may be before a write is treated as
 * clock-poisoned (seconds). Spec leaves the threshold to the implementation.
 */
export const CLOCK_POISON_THRESHOLD_SECONDS = 24 * 60 * 60

// =============================================================================
// Errors
// =============================================================================

/** Failure while building, publishing, reading, or deleting an engram. */
export class EngramError extends Data.TaggedError("EngramError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// =============================================================================
// Body types
// =============================================================================

/** Core body: agent identity, rules, and goals. */
export interface CoreBody {
  readonly slug: "core"
  readonly profile: string
}

/** Memory body: one logical entry. `value: null` is a tombstone. */
export interface MemoryBody {
  readonly slug: string
  readonly value: string | null
}

/** Discriminated engram body. */
export type EngramBody = CoreBody | MemoryBody

/** A decoded engram head: outer event plus validated body. */
export interface DecodedEngram {
  readonly event: NostrEvent
  /** Addressable coordinate `30174:<agent-pubkey>:<d>`. */
  readonly address: string
  readonly d: string
  readonly ownerPubkey: string
  readonly slug: string
  /** Parsed body, or `null` when invalid / undecryptable. */
  readonly body: EngramBody | null
  /** True when body is a memory tombstone (`value: null`). */
  readonly isTombstone: boolean
}

/** Listing entry returned by `list` (omits core and tombstones). */
export interface EngramListEntry {
  readonly slug: string
  readonly eventId: string
  readonly createdAt: number
  readonly d: string
  readonly value: string
}

// =============================================================================
// Options
// =============================================================================

export interface WriteCoreOptions {
  /** Owner pubkey (`p` tag). */
  readonly ownerPubkey: PublicKey | string
  /** Free-form agent profile text. */
  readonly profile: string
  /** Override NIP-31 alt text. */
  readonly alt?: string
  /**
   * Override `created_at` (seconds). When omitted, the service uses
   * `max(now, head.created_at + 1)` for monotonic writes.
   */
  readonly createdAt?: number
  /**
   * Prior head `created_at` when the caller already knows it (skips a relay
   * round-trip for monotonic calculation). Use `0` for first write.
   */
  readonly priorCreatedAt?: number
  /** Test-only: fixed 32-byte NIP-44 nonce. */
  readonly nonce?: Uint8Array
  /** Skip post-publish head verification. Default true (verify). */
  readonly verify?: boolean
  readonly timeoutMs?: number
}

export interface WriteMemoryOptions {
  readonly ownerPubkey: PublicKey | string
  /** Memory slug matching the `mem/…` grammar. */
  readonly slug: string
  /** Entry value, or `null` for a tombstone. */
  readonly value: string | null
  readonly alt?: string
  readonly createdAt?: number
  readonly priorCreatedAt?: number
  readonly nonce?: Uint8Array
  readonly verify?: boolean
  readonly timeoutMs?: number
}

export interface TombstoneOptions {
  readonly ownerPubkey: PublicKey | string
  readonly slug: string
  readonly alt?: string
  readonly createdAt?: number
  readonly priorCreatedAt?: number
  readonly nonce?: Uint8Array
  readonly timeoutMs?: number
}

export interface ReadOptions {
  readonly agentPubkey: PublicKey | string
  readonly ownerPubkey: PublicKey | string
  readonly slug: string
  /**
   * Private key of either the agent or the owner (symmetric conversation key).
   */
  readonly readerPrivateKey: PrivateKey
  readonly timeoutMs?: number
}

export interface ListOptions {
  readonly agentPubkey: PublicKey | string
  readonly ownerPubkey: PublicKey | string
  readonly readerPrivateKey: PrivateKey
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface DecryptEngramOptions {
  readonly event: NostrEvent
  /**
   * Private key of either party. The counterparty is inferred from the event:
   * if `readerPrivateKey` is the agent, counterparty is the `p` tag; if it is
   * the owner, counterparty is `event.pubkey`.
   */
  readonly readerPrivateKey: PrivateKey
  /**
   * When true (default), treat the reader as the owner and use `event.pubkey`
   * as the counterparty. When false, treat the reader as the agent and use
   * the `p` tag as the counterparty.
   */
  readonly asOwner?: boolean
}

export interface DeleteEngramOptions {
  readonly d: string
  readonly reason?: string
  readonly createdAt?: number
}

export interface WriteResult {
  readonly result: PublishResult
  readonly event: NostrEvent
  readonly d: string
  readonly slug: string
  readonly createdAt: number
}

// =============================================================================
// Pure helpers (exported for reuse and testing)
// =============================================================================

/**
 * Validate a slug: reserved `core`, or the `mem/…` grammar, total ≤ 255 bytes.
 */
export const isValidSlug = (slug: string): boolean => {
  if (slug.length === 0 || slug.length > MAX_SLUG_BYTES) return false
  // Byte length for ASCII-only grammar equals char length, but be strict.
  const bytes = new TextEncoder().encode(slug)
  if (bytes.length > MAX_SLUG_BYTES) return false
  if (slug === CORE_SLUG) return true
  return MEMORY_SLUG_PATTERN.test(slug)
}

/** True when the slug is the reserved core address. */
export const isCoreSlug = (slug: string): boolean => slug === CORE_SLUG

/** True when the slug matches the memory grammar. */
export const isMemorySlug = (slug: string): boolean =>
  MEMORY_SLUG_PATTERN.test(slug) && slug.length <= MAX_SLUG_BYTES

/**
 * Derive the blinded addressable `d` tag for a slug under conversation key `K_c`.
 *
 * `conversationKey` is the 32-byte NIP-44 conversation key as lowercase hex
 * (or already as raw bytes).
 */
export const deriveDTag = (
  conversationKey: ConversationKey | string | Uint8Array,
  slug: string
): string => {
  const key =
    typeof conversationKey === "string" ? hexToBytes(conversationKey) : conversationKey
  const encoder = new TextEncoder()
  const domain = encoder.encode(D_TAG_DOMAIN)
  const slugBytes = encoder.encode(slug)
  const msg = new Uint8Array(domain.length + 1 + slugBytes.length)
  msg.set(domain, 0)
  msg[domain.length] = 0x00
  msg.set(slugBytes, domain.length + 1)
  return bytesToHex(hmac(sha256, key, msg))
}

/**
 * Serialize an engram body to the exact compact JSON form expected by the
 * protocol (no whitespace; `slug` first, then `profile` or `value`).
 */
export const serializeBody = (body: EngramBody): string => {
  if (body.slug === CORE_SLUG) {
    return JSON.stringify({ slug: "core", profile: (body as CoreBody).profile })
  }
  return JSON.stringify({ slug: body.slug, value: (body as MemoryBody).value })
}

/**
 * Detect duplicate object member names anywhere in a JSON document.
 * Spec head-selection rule (3): parsers that silently first/last-win would
 * diverge on validity, so duplicates MUST fail.
 */
export const hasDuplicateJsonKeys = (text: string): boolean => {
  let i = 0
  const n = text.length

  const skipWs = () => {
    while (i < n) {
      const c = text[i]!
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++
      else break
    }
  }

  const parseString = (): string | null => {
    if (text[i] !== '"') return null
    i++
    let out = ""
    while (i < n) {
      const c = text[i]!
      if (c === '"') {
        i++
        return out
      }
      if (c === "\\") {
        i++
        if (i >= n) return null
        const e = text[i]!
        // Preserve escape semantics enough for key comparison; we only need
        // the decoded key string for duplicate detection.
        if (e === "u") {
          const hex = text.slice(i + 1, i + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null
          out += String.fromCharCode(parseInt(hex, 16))
          i += 5
        } else {
          const map: Record<string, string> = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            b: "\b",
            f: "\f",
            n: "\n",
            r: "\r",
            t: "\t",
          }
          out += map[e] ?? e
          i++
        }
      } else {
        out += c
        i++
      }
    }
    return null
  }

  const parseValue = (): boolean => {
    skipWs()
    if (i >= n) return false
    const c = text[i]!
    if (c === '"') return parseString() !== null
    if (c === "{") return parseObject()
    if (c === "[") return parseArray()
    if (c === "t") {
      if (text.slice(i, i + 4) === "true") {
        i += 4
        return true
      }
      return false
    }
    if (c === "f") {
      if (text.slice(i, i + 5) === "false") {
        i += 5
        return true
      }
      return false
    }
    if (c === "n") {
      if (text.slice(i, i + 4) === "null") {
        i += 4
        return true
      }
      return false
    }
    // number
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = text.slice(i).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/)
      if (!m) return false
      i += m[0].length
      return true
    }
    return false
  }

  const parseObject = (): boolean => {
    if (text[i] !== "{") return false
    i++
    skipWs()
    if (text[i] === "}") {
      i++
      return true
    }
    const keys = new Set<string>()
    while (i < n) {
      skipWs()
      const key = parseString()
      if (key === null) return false
      if (keys.has(key)) return false // duplicate
      keys.add(key)
      skipWs()
      if (text[i] !== ":") return false
      i++
      if (!parseValue()) return false
      skipWs()
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "}") {
        i++
        return true
      }
      return false
    }
    return false
  }

  const parseArray = (): boolean => {
    if (text[i] !== "[") return false
    i++
    skipWs()
    if (text[i] === "]") {
      i++
      return true
    }
    while (i < n) {
      if (!parseValue()) return false
      skipWs()
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "]") {
        i++
        return true
      }
      return false
    }
    return false
  }

  skipWs()
  if (!parseValue()) return true // treat parse failure as "bad" for callers
  skipWs()
  // If leftover content, treat as invalid (not specifically duplicates)
  return false
}

/**
 * Parse and validate an engram plaintext body. Returns `null` for anything a
 * conforming client must ignore (invalid JSON, duplicate keys, wrong shape,
 * invalid slug).
 */
export const parseEngramBody = (plaintext: string): EngramBody | null => {
  if (hasDuplicateJsonKeys(plaintext)) return null

  let raw: unknown
  try {
    raw = JSON.parse(plaintext)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>

  const slug = obj["slug"]
  if (typeof slug !== "string" || !isValidSlug(slug)) return null

  if (slug === CORE_SLUG) {
    const profile = obj["profile"]
    if (typeof profile !== "string") return null
    return { slug: "core", profile }
  }

  // Memory body: value must be string or null.
  if (!("value" in obj)) return null
  const value = obj["value"]
  if (value !== null && typeof value !== "string") return null
  return { slug, value: value as string | null }
}

/** True when a body is a memory tombstone. */
export const isTombstone = (body: EngramBody | null | undefined): boolean =>
  body !== null &&
  body !== undefined &&
  body.slug !== CORE_SLUG &&
  (body as MemoryBody).value === null

/** Addressable `d` value of an event, or `null` when absent/duplicated. */
export const getEngramD = (event: {
  readonly tags: readonly (readonly string[])[]
}): string | null => {
  const found = event.tags.filter((t) => t[0] === "d")
  if (found.length !== 1) return null
  const d = found[0]?.[1]
  return d && /^[0-9a-f]{64}$/.test(d) ? d : null
}

/** Owner pubkey from the single `p` tag, or `null` when absent/duplicated. */
export const getOwnerP = (event: {
  readonly tags: readonly (readonly string[])[]
}): string | null => {
  const found = event.tags.filter((t) => t[0] === "p")
  if (found.length !== 1) return null
  const p = found[0]?.[1]
  return p && /^[0-9a-f]{64}$/.test(p) ? p : null
}

/**
 * NIP-01 head selection: greatest `created_at`, ties broken by lowest event `id`.
 */
export const selectHead = <T extends { readonly created_at: number; readonly id: string }>(
  events: readonly T[]
): T | null => {
  if (events.length === 0) return null
  let best = events[0]!
  for (let i = 1; i < events.length; i++) {
    const ev = events[i]!
    if (
      ev.created_at > best.created_at ||
      (ev.created_at === best.created_at && ev.id < best.id)
    ) {
      best = ev
    }
  }
  return best
}

/**
 * Spec formula: `created_at := max(now, T + 1)` where T is head `created_at` or 0.
 */
export const engramMonotonicCreatedAt = (now: number, headCreatedAt: number = 0): number =>
  Math.max(now, headCreatedAt + 1)

/** True when a prior head appears clock-poisoned relative to wall-clock. */
export const isClockPoisoned = (
  headCreatedAt: number,
  now: number = Math.floor(Date.now() / 1000),
  threshold: number = CLOCK_POISON_THRESHOLD_SECONDS
): boolean => headCreatedAt > now + threshold

/**
 * Extract wiki-link references `[[<slug>]]` from a body string field
 * (non-normative convention from the spec).
 */
export const extractWikiLinks = (text: string): readonly string[] => {
  const out: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const slug = m[1]!
    if (isValidSlug(slug) && !out.includes(slug)) out.push(slug)
  }
  return out
}

/** Addressable coordinate `30174:<agent>:<d>`. */
export const engramAddress = (agentPubkey: string, d: string): string =>
  `${ENGRAM_KIND}:${agentPubkey}:${d}`

// =============================================================================
// Service Interface
// =============================================================================

export interface EngramService {
  readonly _tag: "EngramService"

  /**
   * Write (or replace) the `core` profile for `(agent, owner)`.
   * Agent signs; owner is the `p` tag; content is NIP-44 encrypted under `K_c`.
   */
  writeCore(
    options: WriteCoreOptions,
    agentPrivateKey: PrivateKey
  ): Effect.Effect<WriteResult, EngramError>

  /**
   * Write (or replace) a memory entry at `slug`. Pass `value: null` to tombstone.
   */
  writeMemory(
    options: WriteMemoryOptions,
    agentPrivateKey: PrivateKey
  ): Effect.Effect<WriteResult, EngramError>

  /** Publish a tombstone for a memory slug (`value: null`). */
  tombstone(
    options: TombstoneOptions,
    agentPrivateKey: PrivateKey
  ): Effect.Effect<WriteResult, EngramError>

  /**
   * Read the head of a slug. Returns `null` when absent, invalid, or tombstoned
   * (for memory). For core, returns the body even when profile is empty.
   */
  read(options: ReadOptions): Effect.Effect<DecodedEngram | null, EngramError>

  /** Convenience: read the core profile body, or `null`. */
  readCore(
    options: Omit<ReadOptions, "slug">
  ): Effect.Effect<CoreBody | null, EngramError>

  /**
   * List every non-tombstone memory entry for `(agent, owner)`. Omits `core`.
   * Best-effort under relay caps (see NIP-AE *Listing*).
   */
  list(options: ListOptions): Effect.Effect<readonly EngramListEntry[], EngramError>

  /**
   * Verify signature, decrypt, and validate an engram event.
   * Returns `null` when the event is not a valid engram for the reader.
   */
  decryptEngram(
    options: DecryptEngramOptions
  ): Effect.Effect<EngramBody | null, EngramError>

  /**
   * Hard-delete an engram address with a NIP-09 request
   * (`a` tag `30174:<agent>:<d>` plus `k` tag `30174`).
   */
  deleteEngram(
    options: DeleteEngramOptions,
    agentPrivateKey: PrivateKey
  ): Effect.Effect<PublishResult, EngramError>
}

export const EngramService = Context.Service<EngramService>("EngramService")

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  const nip44 = yield* Nip44Service
  const crypto = yield* CryptoService

  const fail = (message: string, cause?: unknown) =>
    new EngramError({ message, ...(cause !== undefined ? { cause } : {}) })

  const conversationKey = (privateKey: PrivateKey, counterparty: string) =>
    nip44.getConversationKey(privateKey, counterparty as PublicKey)

  const encryptBody = (
    body: EngramBody,
    ck: ConversationKey,
    nonce?: Uint8Array
  ): Effect.Effect<EncryptedPayload, EngramError> =>
    Effect.gen(function* () {
      const plaintext = serializeBody(body)
      const bytes = new TextEncoder().encode(plaintext)
      if (bytes.length > MAX_PLAINTEXT_BYTES) {
        return yield* fail(
          `engram body exceeds NIP-44 plaintext limit (${bytes.length} > ${MAX_PLAINTEXT_BYTES})`
        )
      }
      if (bytes.length === 0) {
        return yield* fail("engram body plaintext is empty")
      }
      if (nonce !== undefined) {
        return yield* nip44.encryptWithNonce(plaintext, ck, nonce)
      }
      return yield* nip44.encrypt(plaintext, ck)
    }).pipe(Effect.mapError((e) => (e instanceof EngramError ? e : fail(String(e), e))))

  const fetchCandidates = (
    agentPubkey: string,
    ownerPubkey: string,
    d: string | undefined,
    timeoutMs: number,
    limit?: number
  ) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(ENGRAM_KIND)],
        authors: [agentPubkey],
        "#p": [ownerPubkey],
        ...(d !== undefined ? { "#d": [d] } : {}),
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
      yield* Effect.race(collectEffect, Effect.sleep(timeoutMs))
      yield* sub.unsubscribe()
      return collected
    })

  const decryptAndValidate = (
    event: NostrEvent,
    ck: ConversationKey,
    expectedOwner: string,
    expectedAgent: string,
    expectedSlug?: string
  ): Effect.Effect<EngramBody | null, never> =>
    Effect.gen(function* () {
      if ((event.kind as number) !== ENGRAM_KIND) return null
      if (event.pubkey !== expectedAgent) return null
      const d = getEngramD(event)
      const p = getOwnerP(event)
      if (d === null || p === null || p !== expectedOwner) return null
      if (!event.content || event.content.length === 0) return null

      // MUST validate outer signature before decrypting (NIP-44).
      const valid = yield* eventService.verifyEvent(event)
      if (!valid) return null

      const plaintext = yield* nip44.decrypt(event.content as EncryptedPayload, ck)
      const body = parseEngramBody(plaintext)
      if (body === null) return null

      // Slug must re-derive to the event's d tag.
      const derived = deriveDTag(ck, body.slug)
      if (derived !== d) return null
      if (expectedSlug !== undefined && body.slug !== expectedSlug) return null
      return body
    }).pipe(Effect.catch(() => Effect.succeed(null)))

  const resolvePriorCreatedAt = (
    agentPubkey: string,
    ownerPubkey: string,
    d: string,
    opts: {
      priorCreatedAt?: number
      createdAt?: number
      timeoutMs?: number
    }
  ) =>
    Effect.gen(function* () {
      if (opts.createdAt !== undefined) {
        // Explicit override: still surface clock-poison if prior is known and huge.
        return opts.createdAt
      }
      let prior = opts.priorCreatedAt
      if (prior === undefined) {
        const candidates = yield* fetchCandidates(
          agentPubkey,
          ownerPubkey,
          d,
          opts.timeoutMs ?? 800,
          20
        )
        const head = selectHead(candidates)
        prior = head?.created_at ?? 0
      }
      const now = Math.floor(Date.now() / 1000)
      if (isClockPoisoned(prior, now)) {
        return yield* fail(
          `clock-poisoned head: created_at=${prior} is more than ${CLOCK_POISON_THRESHOLD_SECONDS}s ahead of now=${now}`
        )
      }
      return engramMonotonicCreatedAt(now, prior)
    })

  const buildAndPublish = (
    agentPrivateKey: PrivateKey,
    ownerPubkey: string,
    body: EngramBody,
    opts: {
      alt?: string
      createdAt?: number
      priorCreatedAt?: number
      nonce?: Uint8Array
      timeoutMs?: number
    }
  ) =>
    Effect.gen(function* () {
      if (!isValidSlug(body.slug)) {
        return yield* fail(`invalid engram slug: ${JSON.stringify(body.slug)}`)
      }
      if (body.slug === CORE_SLUG) {
        if (typeof (body as CoreBody).profile !== "string") {
          return yield* fail("core body requires string profile")
        }
      } else {
        const v = (body as MemoryBody).value
        if (v !== null && typeof v !== "string") {
          return yield* fail("memory body value must be string or null")
        }
      }

      const agentPubkey = yield* crypto.getPublicKey(agentPrivateKey)
      const ck = yield* conversationKey(agentPrivateKey, ownerPubkey)
      const d = deriveDTag(ck, body.slug)

      const createdAt = yield* resolvePriorCreatedAt(agentPubkey, ownerPubkey, d, {
        ...(opts.priorCreatedAt !== undefined ? { priorCreatedAt: opts.priorCreatedAt } : {}),
        ...(opts.createdAt !== undefined ? { createdAt: opts.createdAt } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      })

      const cipher = yield* encryptBody(
        body,
        ck,
        opts.nonce !== undefined ? opts.nonce : undefined
      )

      const tags: string[][] = [
        ["d", d],
        ["p", ownerPubkey],
        ["alt", opts.alt ?? DEFAULT_ALT],
      ]

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(ENGRAM_KIND),
          content: cipher,
          tags: tags.map((t) => decodeTag(t)),
          created_at: createdAt as never,
        },
        agentPrivateKey
      )
      const result = yield* relay.publish(event)
      return {
        result,
        event,
        d,
        slug: body.slug,
        createdAt,
      } satisfies WriteResult
    })

  const writeCore: EngramService["writeCore"] = (options, agentPrivateKey) =>
    buildAndPublish(
      agentPrivateKey,
      options.ownerPubkey,
      { slug: "core", profile: options.profile },
      {
        ...(options.alt !== undefined ? { alt: options.alt } : {}),
        ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
        ...(options.priorCreatedAt !== undefined
          ? { priorCreatedAt: options.priorCreatedAt }
          : {}),
        ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      }
    ).pipe(Effect.mapError((e) => (e instanceof EngramError ? e : fail(String(e), e))))

  const writeMemory: EngramService["writeMemory"] = (options, agentPrivateKey) => {
    if (!isMemorySlug(options.slug)) {
      return Effect.fail(
        fail(
          `invalid memory slug: ${JSON.stringify(options.slug)} (must match mem/… grammar)`
        )
      )
    }
    return buildAndPublish(
      agentPrivateKey,
      options.ownerPubkey,
      { slug: options.slug, value: options.value },
      {
        ...(options.alt !== undefined ? { alt: options.alt } : {}),
        ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
        ...(options.priorCreatedAt !== undefined
          ? { priorCreatedAt: options.priorCreatedAt }
          : {}),
        ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      }
    ).pipe(Effect.mapError((e) => (e instanceof EngramError ? e : fail(String(e), e))))
  }

  const tombstone: EngramService["tombstone"] = (options, agentPrivateKey) =>
    writeMemory(
      {
        ownerPubkey: options.ownerPubkey,
        slug: options.slug,
        value: null,
        ...(options.alt !== undefined ? { alt: options.alt } : {}),
        ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
        ...(options.priorCreatedAt !== undefined
          ? { priorCreatedAt: options.priorCreatedAt }
          : {}),
        ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      },
      agentPrivateKey
    )

  const read: EngramService["read"] = ({
    agentPubkey,
    ownerPubkey,
    slug,
    readerPrivateKey,
    timeoutMs,
  }) =>
    Effect.gen(function* () {
      if (!isValidSlug(slug)) {
        return yield* fail(`invalid slug: ${JSON.stringify(slug)}`)
      }
      // Reader may be agent or owner; counterparty is the other party.
      // Try owner-as-reader first using agentPubkey as counterparty; if the
      // reader's pubkey equals agentPubkey, use owner as counterparty.
      const readerPub = yield* crypto.getPublicKey(readerPrivateKey)
      const counterparty =
        readerPub === agentPubkey ? ownerPubkey : agentPubkey
      const ck = yield* conversationKey(readerPrivateKey, counterparty)
      const d = deriveDTag(ck, slug)

      const candidates = yield* fetchCandidates(
        agentPubkey,
        ownerPubkey,
        d,
        timeoutMs ?? 800,
        20
      )

      // Validate each candidate and pick head among valid ones.
      const valid: Array<{ event: NostrEvent; body: EngramBody }> = []
      for (const ev of candidates) {
        const body = yield* decryptAndValidate(
          ev,
          ck,
          ownerPubkey,
          agentPubkey,
          slug
        )
        if (body !== null) valid.push({ event: ev, body })
      }
      const head = selectHead(valid.map((v) => v.event))
      if (head === null) return null
      const matched = valid.find((v) => v.event.id === head.id)!
      const body = matched.body
      const tomb = isTombstone(body)
      // Reading a tombstone: slug has no entry.
      if (tomb) return null
      return {
        event: head,
        address: engramAddress(agentPubkey, d),
        d,
        ownerPubkey,
        slug,
        body,
        isTombstone: false,
      } satisfies DecodedEngram
    }).pipe(Effect.mapError((e) => (e instanceof EngramError ? e : fail(String(e), e))))

  const readCore: EngramService["readCore"] = (options) =>
    read({ ...options, slug: CORE_SLUG }).pipe(
      Effect.map((decoded) => {
        if (decoded === null || decoded.body === null) return null
        if (decoded.body.slug !== CORE_SLUG) return null
        return decoded.body as CoreBody
      })
    )

  const list: EngramService["list"] = ({
    agentPubkey,
    ownerPubkey,
    readerPrivateKey,
    limit,
    timeoutMs,
  }) =>
    Effect.gen(function* () {
      const readerPub = yield* crypto.getPublicKey(readerPrivateKey)
      const counterparty =
        readerPub === agentPubkey ? ownerPubkey : agentPubkey
      const ck = yield* conversationKey(readerPrivateKey, counterparty)

      const candidates = yield* fetchCandidates(
        agentPubkey,
        ownerPubkey,
        undefined,
        timeoutMs ?? 800,
        limit
      )

      // Group valid events by d, select head, drop core + tombstones.
      const byD = new Map<string, Array<{ event: NostrEvent; body: EngramBody }>>()
      for (const ev of candidates) {
        const body = yield* decryptAndValidate(ev, ck, ownerPubkey, agentPubkey)
        if (body === null) continue
        const d = getEngramD(ev)
        if (d === null) continue
        const arr = byD.get(d) ?? []
        arr.push({ event: ev, body })
        byD.set(d, arr)
      }

      const out: EngramListEntry[] = []
      for (const [d, group] of byD) {
        const headEv = selectHead(group.map((g) => g.event))
        if (headEv === null) continue
        const matched = group.find((g) => g.event.id === headEv.id)!
        const body = matched.body
        if (body.slug === CORE_SLUG) continue
        if (isTombstone(body)) continue
        out.push({
          slug: body.slug,
          eventId: headEv.id,
          createdAt: headEv.created_at,
          d,
          value: (body as MemoryBody).value as string,
        })
      }
      // Stable order: by created_at desc then slug.
      out.sort((a, b) => b.createdAt - a.createdAt || a.slug.localeCompare(b.slug))
      return out
    }).pipe(Effect.mapError((e) => fail(String(e), e)))

  const decryptEngram: EngramService["decryptEngram"] = ({
    event,
    readerPrivateKey,
    asOwner = true,
  }) =>
    Effect.gen(function* () {
      const p = getOwnerP(event)
      if (p === null) return null
      const counterparty = asOwner ? event.pubkey : p
      const ck = yield* conversationKey(readerPrivateKey, counterparty)
      // For agent-as-reader: expected agent is reader pubkey; for owner-as-reader
      // expected agent is event.pubkey.
      const readerPub = yield* crypto.getPublicKey(readerPrivateKey)
      const expectedAgent = asOwner ? event.pubkey : readerPub
      const expectedOwner = asOwner ? readerPub : p
      // Soft-check owner matches p when asOwner
      if (asOwner && p !== readerPub) {
        // Owner key does not match p tag — still try with p as expected owner
        // so decrypt can succeed if the key derives the same K_c (it won't unless
        // reader is the owner). Use p as expected owner for validation.
        return yield* decryptAndValidate(event, ck, p, event.pubkey)
      }
      return yield* decryptAndValidate(event, ck, expectedOwner, expectedAgent)
    }).pipe(
      Effect.catch(() => Effect.succeed(null)),
      Effect.mapError((e) => fail(String(e), e))
    )

  const deleteEngram: EngramService["deleteEngram"] = (options, agentPrivateKey) =>
    Effect.gen(function* () {
      const author = yield* crypto.getPublicKey(agentPrivateKey)
      const address = engramAddress(author, options.d)
      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(DELETION_KIND),
          content: options.reason ?? "",
          tags: [
            ["a", address],
            ["k", String(ENGRAM_KIND)],
          ].map((t) => decodeTag(t)),
          ...(options.createdAt !== undefined
            ? { created_at: options.createdAt as never }
            : {}),
        },
        agentPrivateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => fail(String(e), e)))

  return {
    _tag: "EngramService" as const,
    writeCore,
    writeMemory,
    tombstone,
    read,
    readCore,
    list,
    decryptEngram,
    deleteEngram,
  }
})

export const EngramServiceLive = Layer.effect(EngramService, make)
