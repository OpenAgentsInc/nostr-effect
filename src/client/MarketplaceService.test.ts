/**
 * NIP-15 MarketplaceService tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream, Option } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { MarketplaceService, MarketplaceServiceLive } from "./MarketplaceService.js"
import { Schema } from "@effect/schema"
import { EventKind, Filter } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)

describe("MarketplaceService (NIP-15)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 30000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const Base = Layer.merge(CryptoServiceLive, EventServiceLive.pipe(Layer.provide(CryptoServiceLive)))
    const Service = MarketplaceServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(Base))
    return Layer.merge(RelayLayer, Layer.merge(Base, Service))
  }

  test("publish stall + getStall by d-tag", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* MarketplaceService
      const crypto = yield* CryptoService

      yield* relaySvc.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const res = yield* svc.publishStall({
        id: "stall-1",
        name: "My Stall",
        currency: "USD",
        shipping: [{ id: "zone-us", name: "US", cost: 10, regions: ["US"] }],
      }, sk)
      expect(res.accepted).toBe(true)

      const found = yield* svc.getStall({ author: pk, id: "stall-1" })
      expect((found?.kind as number)).toBe(30017)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("product with categories + query", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* MarketplaceService
      const crypto = yield* CryptoService

      yield* relaySvc.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const pub = yield* svc.publishProduct({
        id: "prod-1",
        stall_id: "stall-1",
        name: "Gadget",
        currency: "USD",
        price: 199.99,
        quantity: 5,
      }, sk, { categories: ["electronics", "gadgets"] })
      expect(pub.accepted).toBe(true)

      const ev = yield* svc.getProduct({ author: pk, id: "prod-1" })
      expect((ev?.kind as number)).toBe(30018)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("auction + bid + confirm", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* MarketplaceService
      const crypto = yield* CryptoService

      yield* relaySvc.connect()
      const skMerchant = yield* crypto.generatePrivateKey()
      const pkMerchant = yield* crypto.getPublicKey(skMerchant)
      const skBidder = yield* crypto.generatePrivateKey()

      const auc = yield* svc.publishAuction({
        id: "auc-1",
        stall_id: "stall-1",
        name: "Rare",
        starting_bid: 10000,
        duration: 3600,
      }, skMerchant, { categories: ["collectibles"] })
      expect(auc.accepted).toBe(true)

      // Get auction event ID by querying latest
      const sub = yield* relaySvc.subscribe([decodeFilter({ kinds: [decodeKind(30020)], authors: [pkMerchant], limit: 1 })])
      const first = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none()))
      )
      yield* sub.unsubscribe()
      expect(Option.isSome(first)).toBe(true)
      const auctionId = Option.isSome(first) ? (first.value!.id as string) : ""

      const bid = yield* svc.publishBid({ auctionEventId: auctionId, amount: 15000 }, skBidder)
      expect(bid.accepted).toBe(true)

      // Find bidder's bid event id
      const sub2 = yield* relaySvc.subscribe([decodeFilter({ kinds: [decodeKind(1021)], limit: 1 })])
      const firstBid = yield* Effect.race(
        sub2.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none()))
      )
      yield* sub2.unsubscribe()
      expect(Option.isSome(firstBid)).toBe(true)
      const bidId = Option.isSome(firstBid) ? (firstBid.value!.id as string) : ""

      const confirm = yield* svc.confirmBid({ bidEventId: bidId, auctionEventId: auctionId, content: { status: "accepted", duration_extended: 120 } }, skMerchant)
      expect(confirm.accepted).toBe(true)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
