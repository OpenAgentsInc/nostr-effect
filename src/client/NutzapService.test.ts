/**
 * NIP-61 NutzapService tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Option, Stream } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Nip44ServiceLive } from "../services/Nip44Service.js"
import { NutzapService, NutzapServiceLive } from "./NutzapService.js"
import { CashuWalletService, CashuWalletServiceLive } from "./CashuWalletService.js"
import { Schema } from "@effect/schema"
import { EventKind, Filter } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)

describe("NutzapService (NIP-61)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 34000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const Base = Layer.merge(
      CryptoServiceLive,
      Layer.merge(Nip44ServiceLive, EventServiceLive.pipe(Layer.provide(CryptoServiceLive)))
    )
    const Wallet = CashuWalletServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(Base))
    const Service = NutzapServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(Base), Layer.provide(Wallet))
    return Layer.merge(RelayLayer, Layer.merge(Base, Layer.merge(Wallet, Service)))
  }

  test("publish info (10019) and fetch", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NutzapService
      const crypto = yield* CryptoService

      yield* relaySvc.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const res = yield* svc.publishInfo({ p2pkPubkey: "02" + "a".repeat(64), mints: [{ url: "https://mint1", units: ["sat"] }], relays: ["wss://relay1"] }, sk)
      expect(res.accepted).toBe(true)

      const info = yield* svc.getInfo(pk)
      expect((info?.kind as number)).toBe(10019)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("publish nutzap (9321), find incoming, redeem with wallet", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NutzapService
      const wallet = yield* CashuWalletService
      const crypto = yield* CryptoService

      yield* relaySvc.connect()
      const skSender = yield* crypto.generatePrivateKey()
      const pkSender = yield* crypto.getPublicKey(skSender)
      const skRecipient = yield* crypto.generatePrivateKey()
      const pkRecipient = yield* crypto.getPublicKey(skRecipient)

      // Publish dummy token to get a token event id to reference as 'created'
      const tokenRes = yield* wallet.publishToken({ mint: "https://mint.example", unit: "sat", proofs: [{ id: "p1", amount: 1 }] }, skRecipient)
      expect(tokenRes.accepted).toBe(true)
      const subTok = yield* relaySvc.subscribe([decodeFilter({ kinds: [decodeKind(7375)], authors: [pkRecipient], limit: 1 })])
      const tok = yield* Effect.race(subTok.events.pipe(Stream.runHead), Effect.sleep(600).pipe(Effect.as(Option.none())))
      yield* subTok.unsubscribe()
      expect(Option.isSome(tok)).toBe(true)
      const tokenId = Option.isSome(tok) ? tok.value!.id : ""

      // Publish nutzap to recipient
      const zap = yield* svc.publishNutzap({ recipientPubkey: pkRecipient, mintUrl: "https://mint.example", proofs: [{ id: "1", amount: 1 }], unit: "sat", content: "ty!" }, skSender)
      expect(zap.accepted).toBe(true)

      // Find incoming for recipient
      const found = yield* svc.findIncoming({ recipientPubkey: pkRecipient, mints: ["https://mint.example"], limit: 1 })
      expect(found.length).toBeGreaterThan(0)
      const nutzapEvent = found[0]!

      // Redeem (publish spending history 7376)
      const hist = yield* svc.redeem({ nutzapEvent, newTokenEventId: tokenId, senderPubkey: pkSender, amount: 1, unit: "sat" }, skRecipient)
      expect(hist.accepted).toBe(true)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
