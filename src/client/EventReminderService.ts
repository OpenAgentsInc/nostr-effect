/**
 * EventReminderService
 *
 * NIP-ER: Event Reminders (buzz-parity draft).
 *
 * Encrypted, author-only reminders as `kind:30300` addressable events. A
 * pending reminder carries a public `not_before` tag that tells supporting
 * relays when the reminder is due, while the reminder target, note, and state
 * are NIP-44 encrypted to the author (self-encryption, the same pattern as
 * NIP-51 private lists). Cleanup after a terminal state uses NIP-40
 * `expiration`, and hard deletion uses NIP-09.
 *
 * This module implements the PROTOCOL only; it does not depend on buzz.
 *
 * @see NIP-ER spec (buzz `docs/nips/NIP-ER.md`)
 * @see https://github.com/nostr-protocol/nips/blob/master/44.md (NIP-44)
 * @see https://github.com/nostr-protocol/nips/blob/master/40.md (NIP-40)
 * @see https://github.com/nostr-protocol/nips/blob/master/09.md (NIP-09)
 */
import { Context, Data, Effect, Layer, Option, Schema, Stream } from "effect"
import { randomBytes } from "@noble/hashes/utils"
import { bytesToHex } from "@noble/hashes/utils"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { Nip44Service, type EncryptedPayload } from "../services/Nip44Service.js"
import { CryptoService } from "../services/CryptoService.js"
import {
  type NostrEvent,
  type PrivateKey,
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

/** Addressable event kind for NIP-ER reminders. */
export const REMINDER_KIND = 30300

/** NIP-09 deletion request kind. */
const DELETION_KIND = 5

/** Default `alt` (NIP-31) fallback text for a reminder event. */
const DEFAULT_ALT = "Encrypted reminder"

/**
 * Maximum `not_before` value the spec allows (`Number.MAX_SAFE_INTEGER`).
 * Values must parse exactly as an integer in `[0, 9007199254740991]`.
 */
const MAX_NOT_BEFORE = 9007199254740991

// =============================================================================
// Errors
// =============================================================================

/** Failure while building, publishing, reading, or deleting a reminder. */
export class EventReminderError extends Data.TaggedError("EventReminderError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// =============================================================================
// Content schema
// =============================================================================

/** Reminder lifecycle status carried inside the encrypted content. */
export const ReminderStatus = Schema.Literals(["pending", "done", "cancelled"])
export type ReminderStatus = typeof ReminderStatus.Type

/** Optional reference to the Nostr event a reminder is about. */
export const ReminderTarget = Schema.Struct({
  /** 64-char lowercase hex event id (snapshot fallback). */
  id: Schema.optional(Schema.String),
  /** NIP-01 address `<kind>:<pubkey>:<d>` (preferred, resolvable). */
  a: Schema.optional(Schema.String),
  /** Relay hints for resolving the target. */
  relays: Schema.optional(Schema.Array(Schema.String)),
  /** Optional cached preview text. */
  preview: Schema.optional(Schema.String),
})
export type ReminderTarget = typeof ReminderTarget.Type

/** Decrypted plaintext body of a reminder event. */
export const ReminderContent = Schema.Struct({
  target: Schema.optional(ReminderTarget),
  status: ReminderStatus,
  note: Schema.optional(Schema.String),
})
export type ReminderContent = typeof ReminderContent.Type

// =============================================================================
// Options
// =============================================================================

export interface CreateReminderOptions {
  /**
   * Addressable `d` value. Omit to mint a fresh random 128-bit id (the normal
   * path for a new reminder). Provide the existing `d` to replace a reminder
   * address (snooze / complete / cancel).
   */
  readonly d?: string
  /** Reminder body: target reference, status, and private note. */
  readonly content: ReminderContent
  /**
   * Earliest due time as a Unix timestamp in seconds. Included as a
   * `not_before` tag when the status is `pending`. Ignored (omitted) for
   * `done` and `cancelled`, per spec.
   */
  readonly notBefore?: number
  /** Optional NIP-40 cleanup time (seconds). Must be greater than `notBefore`. */
  readonly expiration?: number
  /** Override the `alt` fallback text. */
  readonly alt?: string
  /** Override `created_at` (seconds). Defaults to now. */
  readonly createdAt?: number
}

export interface ListRemindersOptions {
  readonly author: string
  readonly authorPrivateKey: PrivateKey
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface GetReminderOptions {
  readonly author: string
  readonly d: string
  readonly timeoutMs?: number
}

export interface DecryptReminderOptions {
  readonly event: NostrEvent
  readonly authorPrivateKey: PrivateKey
}

export interface CancelReminderOptions {
  readonly d: string
  /** Preserve the reminder body when writing the `cancelled` replacement. */
  readonly content?: ReminderContent
  /** Optional NIP-40 cleanup time (seconds) for the terminal state. */
  readonly expiration?: number
  readonly createdAt?: number
}

export interface DeleteReminderOptions {
  readonly d: string
  readonly reason?: string
  readonly createdAt?: number
}

/** A reminder decoded from a relay: outer event plus parsed state. */
export interface DecodedReminder {
  readonly event: NostrEvent
  /** Addressable coordinate `30300:<pubkey>:<d>`. */
  readonly address: string
  readonly d: string
  /** Parsed `not_before`, or `null` when absent/invalid. */
  readonly notBefore: number | null
  /** Decrypted content, or `null` when it could not be decrypted/validated. */
  readonly content: ReminderContent | null
}

// =============================================================================
// Pure helpers (exported for reuse and testing)
// =============================================================================

/** Generate a fresh opaque `d` value with 128 bits of entropy. */
export const generateReminderId = (): string => bytesToHex(randomBytes(16))

/**
 * Parse a `not_before` tag value under the spec's strict rules: ASCII digits
 * only, no sign/whitespace/decimal/leading-zero (except `"0"`), and within
 * `[0, MAX_NOT_BEFORE]`. Returns `null` for any malformed value.
 */
export const parseNotBefore = (value: string | undefined): number | null => {
  if (value === undefined) return null
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_NOT_BEFORE) return null
  return n
}

/** Read the single valid `not_before` value from an event, or `null`. */
export const getNotBefore = (event: {
  readonly tags: readonly (readonly string[])[]
}): number | null => {
  const found = event.tags.filter((t) => t[0] === "not_before")
  // Spec: at most one `not_before`; more than one is malformed.
  if (found.length !== 1) return null
  return parseNotBefore(found[0]?.[1])
}

/** The addressable `d` value of an event, or `null` when absent/duplicated. */
export const getReminderD = (event: {
  readonly tags: readonly (readonly string[])[]
}): string | null => {
  const found = event.tags.filter((t) => t[0] === "d")
  if (found.length !== 1) return null
  const d = found[0]?.[1]
  return d && d.length > 0 ? d : null
}

/**
 * A due reminder is `pending`, has exactly one valid `not_before`, and that
 * time is at or before `now` (seconds).
 */
export const isDue = (
  reminder: DecodedReminder,
  now: number = Math.floor(Date.now() / 1000)
): boolean =>
  reminder.content?.status === "pending" &&
  reminder.notBefore !== null &&
  reminder.notBefore <= now

const HEX64 = /^[0-9a-f]{64}$/
const ADDRESS = /^[0-9]+:[0-9a-f]{64}:.*$/

/**
 * Validate and normalise a decrypted plaintext into `ReminderContent`, applying
 * the spec's content-validity rules. Returns `null` for anything a conforming
 * client must ignore (non-object, unknown status, invalid target refs, or a
 * pending reminder with neither a target reference nor a non-empty note).
 */
export const parseReminderContent = (plaintext: string): ReminderContent | null => {
  let raw: unknown
  try {
    raw = JSON.parse(plaintext)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>

  const status = obj["status"]
  if (status !== "pending" && status !== "done" && status !== "cancelled") return null

  let target: ReminderTarget | undefined
  if (obj["target"] !== undefined) {
    const t = obj["target"]
    if (t === null || typeof t !== "object" || Array.isArray(t)) return null
    const to = t as Record<string, unknown>
    const id = to["id"]
    if (id !== undefined && (typeof id !== "string" || !HEX64.test(id))) return null
    const a = to["a"]
    if (a !== undefined && (typeof a !== "string" || !ADDRESS.test(a))) return null
    const preview = to["preview"]
    if (preview !== undefined && typeof preview !== "string") return null
    let relays: readonly string[] | undefined
    if (to["relays"] !== undefined) {
      if (!Array.isArray(to["relays"])) return null
      // Ignore entries that are not absolute ws:// or wss:// URLs.
      relays = (to["relays"] as unknown[]).filter(
        (u): u is string => typeof u === "string" && isRelayUrl(u)
      )
    }
    target = {
      ...(id !== undefined ? { id: id as string } : {}),
      ...(a !== undefined ? { a: a as string } : {}),
      ...(relays !== undefined ? { relays } : {}),
      ...(preview !== undefined ? { preview: preview as string } : {}),
    }
  }

  const note = obj["note"]
  if (note !== undefined && typeof note !== "string") return null

  // A pending reminder MUST have a valid target reference or a non-empty note.
  if (status === "pending") {
    const hasTargetRef = target !== undefined && (target.id !== undefined || target.a !== undefined)
    const hasNote = typeof note === "string" && note.length > 0
    if (!hasTargetRef && !hasNote) return null
  }

  return {
    ...(target !== undefined ? { target } : {}),
    status,
    ...(note !== undefined ? { note: note as string } : {}),
  }
}

const isRelayUrl = (u: string): boolean => {
  try {
    const url = new URL(u)
    return (url.protocol === "ws:" || url.protocol === "wss:") && url.host.length > 0
  } catch {
    return false
  }
}

// =============================================================================
// Service Interface
// =============================================================================

export interface EventReminderService {
  readonly _tag: "EventReminderService"

  /**
   * Build the NIP-44 self-encrypted `kind:30300` reminder and publish it.
   * Mints a fresh random `d` unless one is supplied for a replacement.
   */
  createReminder(
    options: CreateReminderOptions,
    privateKey: PrivateKey
  ): Effect.Effect<{ readonly result: PublishResult; readonly d: string }, EventReminderError>

  /**
   * Fetch and decrypt all of the author's reminders. Returns the latest head
   * per address as decoded reminders.
   */
  listReminders(
    options: ListRemindersOptions
  ): Effect.Effect<readonly DecodedReminder[], EventReminderError>

  /** Fetch the latest raw event for a single reminder address. */
  getReminder(
    options: GetReminderOptions
  ): Effect.Effect<NostrEvent | null, EventReminderError>

  /** Verify signature, then decrypt and validate a reminder's content. */
  decryptReminder(
    options: DecryptReminderOptions
  ): Effect.Effect<ReminderContent | null, EventReminderError>

  /**
   * Cancel a reminder by publishing a `cancelled` addressable replacement
   * (status transition without deleting history). Omits `not_before` per spec.
   */
  cancelReminder(
    options: CancelReminderOptions,
    privateKey: PrivateKey
  ): Effect.Effect<{ readonly result: PublishResult; readonly d: string }, EventReminderError>

  /**
   * Hard-delete a reminder address with a NIP-09 deletion request
   * (`a` tag `30300:<pubkey>:<d>` plus `k` tag `30300`).
   */
  deleteReminder(
    options: DeleteReminderOptions,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, EventReminderError>
}

export const EventReminderService = Context.Service<EventReminderService>("EventReminderService")

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  const nip44 = yield* Nip44Service
  const crypto = yield* CryptoService

  const fail = (message: string, cause?: unknown) =>
    new EventReminderError({ message, ...(cause !== undefined ? { cause } : {}) })

  const encryptToSelf = (privateKey: PrivateKey, content: ReminderContent) =>
    Effect.gen(function* () {
      const authorPub = yield* crypto.getPublicKey(privateKey)
      const ck = yield* nip44.getConversationKey(privateKey, authorPub)
      const plaintext = JSON.stringify(content)
      return yield* nip44.encrypt(plaintext, ck)
    })

  const buildAndPublish = (
    privateKey: PrivateKey,
    d: string,
    content: ReminderContent,
    opts: { notBefore?: number; expiration?: number; alt?: string; createdAt?: number }
  ) =>
    Effect.gen(function* () {
      const cipher = yield* encryptToSelf(privateKey, content)

      const tags: string[][] = [["d", d]]

      // Only pending reminders carry `not_before`; terminal states omit it.
      const notBefore =
        content.status === "pending" && opts.notBefore !== undefined ? opts.notBefore : undefined

      if (notBefore !== undefined) {
        if (parseNotBefore(String(notBefore)) === null) {
          return yield* Effect.fail(fail(`invalid not_before: ${notBefore}`))
        }
        tags.push(["not_before", String(notBefore)])
      }

      tags.push(["alt", opts.alt ?? DEFAULT_ALT])

      if (opts.expiration !== undefined) {
        // Spec: if not_before is present, expiration MUST be greater than it.
        if (notBefore !== undefined && opts.expiration <= notBefore) {
          return yield* Effect.fail(
            fail(`expiration (${opts.expiration}) must be greater than not_before (${notBefore})`)
          )
        }
        tags.push(["expiration", String(opts.expiration)])
      }

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(REMINDER_KIND),
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

  const createReminder: EventReminderService["createReminder"] = (options, privateKey) =>
    buildAndPublish(privateKey, options.d ?? generateReminderId(), options.content, {
      ...(options.notBefore !== undefined ? { notBefore: options.notBefore } : {}),
      ...(options.expiration !== undefined ? { expiration: options.expiration } : {}),
      ...(options.alt !== undefined ? { alt: options.alt } : {}),
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    }).pipe(Effect.mapError((e) => (e instanceof EventReminderError ? e : fail(String(e), e))))

  const decryptEvent = (event: NostrEvent, authorPrivateKey: PrivateKey) =>
    Effect.gen(function* () {
      if (!event.content || event.content.length === 0) return null

      // Clients MUST validate the outer event signature before decrypting.
      const valid = yield* eventService.verifyEvent(event)
      if (!valid) return null

      const ck = yield* nip44.getConversationKey(authorPrivateKey, event.pubkey)
      const plaintext = yield* nip44.decrypt(event.content as EncryptedPayload, ck)
      return parseReminderContent(plaintext)
    })

  const decryptReminder: EventReminderService["decryptReminder"] = ({ event, authorPrivateKey }) =>
    decryptEvent(event, authorPrivateKey).pipe(
      Effect.catch(() => Effect.succeed(null)),
      Effect.mapError((e) => fail(String(e), e))
    )

  const listReminders: EventReminderService["listReminders"] = ({
    author,
    authorPrivateKey,
    limit,
    timeoutMs,
  }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(REMINDER_KIND)],
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

      // Keep only the winning head per address (highest created_at, tie -> lowest id).
      const heads = new Map<string, NostrEvent>()
      for (const ev of collected) {
        const d = getReminderD(ev)
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

      const out: DecodedReminder[] = []
      for (const [d, ev] of heads) {
        const content = yield* decryptEvent(ev, authorPrivateKey).pipe(
          Effect.catch(() => Effect.succeed(null))
        )
        out.push({
          event: ev,
          address: `${REMINDER_KIND}:${ev.pubkey}:${d}`,
          d,
          notBefore: getNotBefore(ev),
          content,
        })
      }
      return out
    }).pipe(Effect.mapError((e) => fail(String(e), e)))

  const getReminder: EventReminderService["getReminder"] = ({ author, d, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(REMINDER_KIND)],
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

  const cancelReminder: EventReminderService["cancelReminder"] = (options, privateKey) => {
    const base: ReminderContent = options.content ?? { status: "cancelled" }
    const content: ReminderContent = { ...base, status: "cancelled" }
    return buildAndPublish(privateKey, options.d, content, {
      // not_before is omitted for terminal states by buildAndPublish.
      ...(options.expiration !== undefined ? { expiration: options.expiration } : {}),
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    }).pipe(Effect.mapError((e) => (e instanceof EventReminderError ? e : fail(String(e), e))))
  }

  const deleteReminder: EventReminderService["deleteReminder"] = (options, privateKey) =>
    Effect.gen(function* () {
      const author = yield* crypto.getPublicKey(privateKey)
      const address = `${REMINDER_KIND}:${author}:${options.d}`
      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(DELETION_KIND),
          content: options.reason ?? "",
          tags: [
            ["a", address],
            ["k", String(REMINDER_KIND)],
          ].map((t) => decodeTag(t)),
          ...(options.createdAt !== undefined ? { created_at: options.createdAt as never } : {}),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => fail(String(e), e)))

  return {
    _tag: "EventReminderService" as const,
    createReminder,
    listReminders,
    getReminder,
    decryptReminder,
    cancelReminder,
    deleteReminder,
  }
})

export const EventReminderServiceLive = Layer.effect(EventReminderService, make)
