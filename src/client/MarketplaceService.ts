/**
 * MarketplaceService
 *
 * NIP-15: Nostr Marketplace (stall/product/UI/auction/bids)
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
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

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

// NIP-15 kinds
export const StallKind = 30017
export const ProductKind = 30018
export const MarketUIKind = 30019
export const AuctionKind = 30020
export const BidKind = 1021
export const BidConfirmationKind = 1022

// =============================================================================
// Inputs
// =============================================================================

export interface StallShippingZone {
  readonly id: string
  readonly name?: string
  readonly cost: number
  readonly regions: readonly string[]
}

export interface StallContent {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly currency: string
  readonly shipping: readonly StallShippingZone[]
}

export interface ProductSpecKV extends Array<string> {
  0: string
  1: string
}

export interface ProductShippingExtra {
  readonly id: string
  readonly cost: number
}

export interface ProductContent {
  readonly id: string
  readonly stall_id: string
  readonly name: string
  readonly description?: string
  readonly images?: readonly string[]
  readonly currency: string
  readonly price: number
  readonly quantity: number | null
  readonly specs?: readonly ProductSpecKV[]
  readonly shipping?: readonly ProductShippingExtra[]
}

export interface MarketUIContent {
  readonly name?: string
  readonly about?: string
  readonly ui?: {
    readonly picture?: string
    readonly banner?: string
    readonly theme?: string
    readonly darkMode?: boolean
  }
  readonly merchants?: readonly string[]
}

export interface AuctionContent {
  readonly id: string
  readonly stall_id: string
  readonly name: string
  readonly description?: string
  readonly images?: readonly string[]
  readonly starting_bid: number
  readonly start_date?: number
  readonly duration: number
  readonly specs?: readonly ProductSpecKV[]
  readonly shipping?: readonly ProductShippingExtra[]
}

export type BidStatus = "accepted" | "rejected" | "pending" | "winner"

export interface BidConfirmationContent {
  readonly status: BidStatus
  readonly message?: string
  readonly duration_extended?: number
}

// =============================================================================
// Service Interface
// =============================================================================

export interface MarketplaceService {
  readonly _tag: "MarketplaceService"

  publishStall(content: StallContent, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  getStall(params: { author: string; id: string; timeoutMs?: number }): Effect.Effect<NostrEvent | null, RelayError>

  publishProduct(content: ProductContent, privateKey: PrivateKey, opts?: { categories?: readonly string[] }): Effect.Effect<PublishResult, RelayError>
  getProduct(params: { author: string; id: string; timeoutMs?: number }): Effect.Effect<NostrEvent | null, RelayError>

  publishMarketUI(content: MarketUIContent, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  getMarketUI(params: { author: string; limit?: number; timeoutMs?: number }): Effect.Effect<readonly NostrEvent[], RelayError>

  publishAuction(content: AuctionContent, privateKey: PrivateKey, opts?: { categories?: readonly string[] }): Effect.Effect<PublishResult, RelayError>
  getAuction(params: { author: string; id: string; timeoutMs?: number }): Effect.Effect<NostrEvent | null, RelayError>

  publishBid(params: { auctionEventId: string; amount: number }, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  confirmBid(params: { bidEventId: string; auctionEventId: string; content: BidConfirmationContent }, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
}

export const MarketplaceService = Context.GenericTag<MarketplaceService>("MarketplaceService")

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const publishStall: MarketplaceService["publishStall"] = (content, privateKey) =>
    Effect.gen(function* () {
      const event = yield* events.createEvent(
        { kind: decodeKind(StallKind), content: JSON.stringify(content), tags: [["d", content.id]].map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getStall: MarketplaceService["getStall"] = ({ author, id, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(StallKind)], authors: [author], "#d": [id], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishProduct: MarketplaceService["publishProduct"] = (content, privateKey, opts) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", content.id]]
      if (opts?.categories) for (const cat of opts.categories) tags.push(["t", cat])
      const event = yield* events.createEvent(
        { kind: decodeKind(ProductKind), content: JSON.stringify(content), tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getProduct: MarketplaceService["getProduct"] = ({ author, id, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(ProductKind)], authors: [author], "#d": [id], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishMarketUI: MarketplaceService["publishMarketUI"] = (content, privateKey) =>
    Effect.gen(function* () {
      const event = yield* events.createEvent(
        { kind: decodeKind(MarketUIKind), content: JSON.stringify(content), tags: [] },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getMarketUI: MarketplaceService["getMarketUI"] = ({ author, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(MarketUIKind)], authors: [author], limit: limit ?? 3 })
      const sub = yield* relay.subscribe([filter])
      const results: NostrEvent[] = []
      const collect = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(timeoutMs ?? 200).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
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

  const publishAuction: MarketplaceService["publishAuction"] = (content, privateKey, opts) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", content.id]]
      if (opts?.categories) for (const cat of opts.categories) tags.push(["t", cat])
      const event = yield* events.createEvent(
        { kind: decodeKind(AuctionKind), content: JSON.stringify(content), tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getAuction: MarketplaceService["getAuction"] = ({ author, id, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(AuctionKind)], authors: [author], "#d": [id], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishBid: MarketplaceService["publishBid"] = (params, privateKey) =>
    Effect.gen(function* () {
      const event = yield* events.createEvent(
        { kind: decodeKind(BidKind), content: String(params.amount), tags: [["e", params.auctionEventId]].map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const confirmBid: MarketplaceService["confirmBid"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["e", params.bidEventId], ["e", params.auctionEventId]]
      const event = yield* events.createEvent(
        { kind: decodeKind(BidConfirmationKind), content: JSON.stringify(params.content), tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "MarketplaceService" as const,
    publishStall,
    getStall,
    publishProduct,
    getProduct,
    publishMarketUI,
    getMarketUI,
    publishAuction,
    getAuction,
    publishBid,
    confirmBid,
  }
})

export const MarketplaceServiceLive = Layer.effect(MarketplaceService, make)

