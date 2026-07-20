/**
 * NutzapService
 *
 * NIP-61: Nutzaps (P2PK Cashu tokens) and info events.
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "effect"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import {
  type NostrEvent,
  type PrivateKey,
  EventKind,
  Filter,
  Tag,
} from "../core/Schema.js"
import { CashuWalletService } from "./CashuWalletService.js"
import { Nip44Service } from "../services/Nip44Service.js"
import { CryptoService } from "../services/CryptoService.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

// Kinds
export const NutzapInfoKind = 10019
export const NutzapKind = 9321

// =============================================================================
// Inputs
// =============================================================================

export interface PublishNutzapInfoInput {
  readonly relays?: readonly string[]
  readonly mints: readonly { url: string; units?: readonly string[] }[]
  readonly p2pkPubkey: string // prefixed properly by client using NUT-11/12 guidance
}

export interface PublishNutzapInput {
  readonly recipientPubkey: string // nostr identity pubkey (p tag)
  readonly mintUrl: string // u tag
  readonly proofs: readonly string[] | readonly object[] // each encoded into one 'proof' tag
  readonly unit?: string // default 'sat'
  readonly content?: string
  readonly referencedEventId?: string
  readonly referencedKind?: number
  readonly relayHint?: string
}

export interface FindIncomingParams {
  readonly recipientPubkey: string
  readonly mints: readonly string[]
  readonly since?: number
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface RedeemParams {
  readonly nutzapEvent: NostrEvent
  readonly newTokenEventId: string
  readonly senderPubkey: string
  readonly amount: string | number
  readonly unit?: string
}

// =============================================================================
// Service Interface
// =============================================================================

export interface NutzapService {
  readonly _tag: "NutzapService"

  publishInfo(input: PublishNutzapInfoInput, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  getInfo(author: string, timeoutMs?: number): Effect.Effect<NostrEvent | null, RelayError>

  publishNutzap(input: PublishNutzapInput, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  findIncoming(params: FindIncomingParams): Effect.Effect<readonly NostrEvent[], RelayError>

  redeem(params: RedeemParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
}

export const NutzapService = Context.Service<NutzapService>("NutzapService")

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService
  const wallet = yield* Effect.serviceOption(CashuWalletService)
  const nip44 = yield* Effect.serviceOption(Nip44Service)
  const crypto = yield* Effect.serviceOption(CryptoService)

  const publishInfo: NutzapService["publishInfo"] = (input, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      if (input.relays) for (const r of input.relays) tags.push(["relay", r])
      for (const m of input.mints) {
        const tag = ["mint", m.url]
        if (m.units && m.units.length > 0) tag.push(...m.units)
        tags.push(tag)
      }
      tags.push(["pubkey", input.p2pkPubkey])

      const ev = yield* events.createEvent(
        { kind: decodeKind(NutzapInfoKind), content: "", tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getInfo: NutzapService["getInfo"] = (author, timeoutMs) =>
    Effect.gen(function* () {
      const f = decodeFilter({ kinds: [decodeKind(NutzapInfoKind)], authors: [author], limit: 1 })
      const sub = yield* relay.subscribe([f])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catch(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishNutzap: NutzapService["publishNutzap"] = (input, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["p", input.recipientPubkey], ["u", input.mintUrl]]
      if (input.unit) tags.push(["unit", input.unit])
      if (input.referencedEventId) tags.push(["e", input.referencedEventId, input.relayHint ?? ""])
      if (input.referencedKind !== undefined) tags.push(["k", String(input.referencedKind)])
      for (const pr of input.proofs) {
        const value = typeof pr === "string" ? pr : JSON.stringify(pr)
        tags.push(["proof", value])
      }

      const ev = yield* events.createEvent(
        { kind: decodeKind(NutzapKind), content: input.content ?? "", tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const findIncoming: NutzapService["findIncoming"] = ({ recipientPubkey, mints, since, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const f: any = { kinds: [decodeKind(NutzapKind)], "#p": [recipientPubkey], limit: limit ?? 3 }
      if (mints.length > 0) f["#u"] = mints
      if (since) f.since = since
      const filter = decodeFilter(f)
      const sub = yield* relay.subscribe([filter])

      const results: NostrEvent[] = []
      const collect = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(timeoutMs ?? 300).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catch(() => Effect.succeed(Option.none<NostrEvent>())))
        if (Option.isSome(next)) results.push(next.value)
      })
      const n = limit ?? 1
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collect
      }
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const redeem: NutzapService["redeem"] = (params, privateKey) =>
    Effect.gen(function* () {
      // Prefer CashuWalletService (NIP-44 encrypted spending history)
      if (Option.isSome(wallet)) {
        const w = wallet.value
        return yield* w.publishSpendingHistory(
          {
            direction: "in",
            amount: params.amount,
            unit: params.unit ?? "sat",
            encryptedRefs: [{ id: params.newTokenEventId, marker: "created" }],
            redeemedRefs: [{ id: params.nutzapEvent.id }],
          },
          privateKey
        )
      }

      // Fallback: still NIP-44-encrypt content when Nip44Service is available (NIP-60/61)
      const pairs: Array<[string, string, string?, string?]> = [
        ["direction", "in"],
        ["amount", String(params.amount)],
        ["unit", params.unit ?? "sat"],
        ["e", params.newTokenEventId, "", "created"],
      ]
      const tags: string[][] = [
        ["e", params.nutzapEvent.id, "", "redeemed"],
        ["p", params.senderPubkey],
      ]

      let content: string
      if (Option.isSome(nip44) && Option.isSome(crypto)) {
        const authorPub = yield* crypto.value.getPublicKey(privateKey)
        const ck = yield* nip44.value.getConversationKey(privateKey, authorPub)
        content = yield* nip44.value.encrypt(JSON.stringify(pairs), ck)
      } else {
        // Last resort: plaintext only if crypto layers missing
        content = JSON.stringify(pairs)
      }

      const ev = yield* events.createEvent(
        { kind: decodeKind(7376), content, tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "NutzapService" as const,
    publishInfo,
    getInfo,
    publishNutzap,
    findIncoming,
    redeem,
  }
})

export const NutzapServiceLive = Layer.effect(NutzapService, make)

