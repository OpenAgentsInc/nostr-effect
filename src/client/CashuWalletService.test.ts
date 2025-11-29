/**
 * NIP-60 CashuWalletService tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Nip44ServiceLive } from "../services/Nip44Service.js"
import { CashuWalletService, CashuWalletServiceLive } from "./CashuWalletService.js"

describe("CashuWalletService (NIP-60)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 18000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const Base = Layer.mergeAll(CryptoServiceLive, EventServiceLive.pipe(Layer.provide(CryptoServiceLive)), Nip44ServiceLive)
    const Service = CashuWalletServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(Base))
    return Layer.merge(RelayLayer, Layer.merge(Base, Service))
  }

  test("upsert wallet + fetch latest", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* CashuWalletService
      const crypto = yield* CryptoService

      yield* relaySvc.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const res = yield* svc.upsertWallet({ walletPrivkey: "deadbeef".repeat(8).slice(0, 64), mints: ["https://mint1"] }, sk)
      expect(res.accepted).toBe(true)

      const latest = yield* svc.getLatestWallet(pk)
      expect((latest?.kind as number)).toBe(17375)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("publish token + spending history + roll over", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* CashuWalletService
      const crypto = yield* CryptoService

      yield* relaySvc.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      // Create an initial token event
      const t1 = yield* svc.publishToken({ mint: "https://mint.example", proofs: [{ id: "1", amount: 1 }, { id: "2", amount: 2 }, { id: "3", amount: 4 }], unit: "sat" }, sk)
      expect(t1.accepted).toBe(true)
      const tokens1 = yield* svc.getTokens(pk, 1)
      const firstTokenId = tokens1[0]!.id

      // Roll over, dropping proof id=3
      const rolled = yield* svc.rollOverToken({ mint: "https://mint.example", newProofs: [{ id: "1", amount: 1 }, { id: "2", amount: 2 }], oldTokenEventId: firstTokenId }, sk)
      expect(rolled.created.accepted).toBe(true)
      expect(rolled.deleted.accepted).toBe(true)

      // Spending history with one public redeemed ref
      const tokens2 = yield* svc.getTokens(pk, 1)
      const newTokenId = tokens2[0]!.id
      const hist = yield* svc.publishSpendingHistory({ direction: "out", amount: 2, unit: "sat", redeemedRefs: [{ id: newTokenId }] }, sk)
      expect(hist.accepted).toBe(true)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
