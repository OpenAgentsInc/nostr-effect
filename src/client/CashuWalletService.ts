/**
 * CashuWalletService
 *
 * NIP-60: Cashu Wallets.
 * Stores wallet info (kind 17375), unspent proofs (kind 7375), and spending history (kind 7376).
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { CryptoService } from "../services/CryptoService.js"
import { Nip44Service } from "../services/Nip44Service.js"
import { RelayError } from "../core/Errors.js"
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

// Kinds per NIP-60
export const WALLET_KIND = 17375
export const TOKEN_KIND = 7375
export const HISTORY_KIND = 7376

// =============================================================================
// Inputs/outputs
// =============================================================================

export interface UpsertWalletInput {
  readonly walletPrivkey: string // hex
  readonly mints: readonly string[] // one or more mint URLs
}

export interface PublishTokenInput {
  readonly mint: string
  readonly unit?: string // default 'sat'
  readonly proofs: readonly any[] // as-is Cashu proofs
  readonly del?: readonly string[] // destroyed token event IDs
}

export type TxDirection = "in" | "out"

export interface PublishSpendingHistoryInput {
  readonly direction: TxDirection
  readonly amount: string | number
  readonly unit?: string // default 'sat'
  /** IDs added to encrypted content pairs. Example marker: 'created' or 'destroyed' */
  readonly encryptedRefs?: readonly { id: string; marker: "created" | "destroyed" }[]
  /** Public redeemed references – added as public e tags with 'redeemed' marker */
  readonly redeemedRefs?: readonly { id: string; relay?: string; pubkey?: string }[]
}

export interface CashuWalletService {
  readonly _tag: "CashuWalletService"

  upsertWallet(input: UpsertWalletInput, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  publishToken(input: PublishTokenInput, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  publishSpendingHistory(input: PublishSpendingHistoryInput, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  /** Create a new token rolling over unspent proofs and delete the old token (kind 5 with k=7375) */
  rollOverToken(params: { mint: string; unit?: string; newProofs: readonly any[]; oldTokenEventId: string }, privateKey: PrivateKey): Effect.Effect<{ created: PublishResult; deleted: PublishResult }, RelayError>

  /** Fetch latest wallet event for an author */
  getLatestWallet(author: string, timeoutMs?: number): Effect.Effect<NostrEvent | null, RelayError>

  /** Fetch recent token events for an author */
  getTokens(author: string, limit?: number, timeoutMs?: number): Effect.Effect<readonly NostrEvent[], RelayError>

  /** Fetch recent history events for an author */
  getHistory(author: string, limit?: number, timeoutMs?: number): Effect.Effect<readonly NostrEvent[], RelayError>
}

export const CashuWalletService = Context.GenericTag<CashuWalletService>("CashuWalletService")


const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  const crypto = yield* CryptoService
  const nip44 = yield* Nip44Service

  const upsertWallet: CashuWalletService["upsertWallet"] = (input, privateKey) =>
    Effect.gen(function* () {
      const authorPub = yield* crypto.getPublicKey(privateKey)
      const ck = yield* nip44.getConversationKey(privateKey, authorPub)
      const payload = [ ["privkey", input.walletPrivkey], ...input.mints.map((m) => ["mint", m] as const) ]
      const content = yield* nip44.encrypt(JSON.stringify(payload), ck)

      const event = yield* eventService.createEvent(
        { kind: decodeKind(WALLET_KIND), content, tags: [] },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishToken: CashuWalletService["publishToken"] = (input, privateKey) =>
    Effect.gen(function* () {
      const authorPub = yield* crypto.getPublicKey(privateKey)
      const ck = yield* nip44.getConversationKey(privateKey, authorPub)
      const tokenObj = {
        mint: input.mint,
        unit: input.unit ?? "sat",
        proofs: input.proofs,
        ...(input.del && input.del.length > 0 ? { del: input.del } : {}),
      }
      const content = yield* nip44.encrypt(JSON.stringify(tokenObj), ck)
      const event = yield* eventService.createEvent(
        { kind: decodeKind(TOKEN_KIND), content, tags: [] },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishSpendingHistory: CashuWalletService["publishSpendingHistory"] = (input, privateKey) =>
    Effect.gen(function* () {
      const authorPub = yield* crypto.getPublicKey(privateKey)
      const ck = yield* nip44.getConversationKey(privateKey, authorPub)

      const pairs: Array<[string, string, string?, string?]> = [
        ["direction", input.direction],
        ["amount", String(input.amount)],
        ["unit", input.unit ?? "sat"],
      ]
      if (input.encryptedRefs) {
        for (const r of input.encryptedRefs) pairs.push(["e", r.id, "", r.marker])
      }
      const content = yield* nip44.encrypt(JSON.stringify(pairs), ck)

      const tags: string[][] = []
      if (input.redeemedRefs) {
        for (const r of input.redeemedRefs) {
          const tag: string[] = ["e", r.id]
          if (r.relay) tag.push(r.relay)
          if (r.pubkey) tag.push(r.pubkey)
          tag.push("redeemed")
          tags.push(tag)
        }
      }

      const event = yield* eventService.createEvent(
        { kind: decodeKind(HISTORY_KIND), content, tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const rollOverToken: CashuWalletService["rollOverToken"] = (params, privateKey) =>
    Effect.gen(function* () {
      // Create new token with del reference
      const created = yield* publishToken({ mint: params.mint, unit: params.unit ?? "sat", proofs: params.newProofs, del: [params.oldTokenEventId] }, privateKey)

      // Publish deletion event per NIP-09 with k=7375 tag
      const deleteEvent = yield* eventService.createEvent(
        { kind: decodeKind(5), content: "delete token", tags: [ ["e", params.oldTokenEventId], ["k", "7375"] ].map((t) => decodeTag(t)) },
        privateKey
      )
      const deleted = yield* relay.publish(deleteEvent)
      return { created, deleted }
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getLatestWallet: CashuWalletService["getLatestWallet"] = (author, timeoutMs) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(WALLET_KIND)], authors: [author], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybeEvent = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybeEvent) ? maybeEvent.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getTokens: CashuWalletService["getTokens"] = (author, limit, timeoutMs) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(TOKEN_KIND)], authors: [author], limit: limit ?? 10 })
      const sub = yield* relay.subscribe([filter])
      const out: NostrEvent[] = []
      const collectOne = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(timeoutMs ?? 200).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
        if (Option.isSome(next)) out.push(next.value)
      })
      const n = limit ?? 1
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collectOne
      }
      yield* sub.unsubscribe()
      return out
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getHistory: CashuWalletService["getHistory"] = (author, limit, timeoutMs) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(HISTORY_KIND)], authors: [author], limit: limit ?? 10 })
      const sub = yield* relay.subscribe([filter])
      const out: NostrEvent[] = []
      const collectOne = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(timeoutMs ?? 200).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
        if (Option.isSome(next)) out.push(next.value)
      })
      const n = limit ?? 1
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collectOne
      }
      yield* sub.unsubscribe()
      return out
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "CashuWalletService" as const,
    upsertWallet,
    publishToken,
    publishSpendingHistory,
    rollOverToken,
    getLatestWallet,
    getTokens,
    getHistory,
  }
})

export const CashuWalletServiceLive = Layer.effect(CashuWalletService, make)
