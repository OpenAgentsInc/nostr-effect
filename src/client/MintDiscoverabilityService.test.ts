/**
 * Tests for MintDiscoverabilityService (NIP-87)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import {
  MintDiscoverabilityService,
  MintDiscoverabilityServiceLive,
  type MintRecommendation,
} from "./MintDiscoverabilityService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("MintDiscoverabilityService (NIP-87)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 18000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({
      url: `ws://localhost:${port}`,
      reconnect: false,
    })

    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )

    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        MintDiscoverabilityServiceLive.pipe(
          Layer.provide(RelayLayer),
          Layer.provide(ServiceLayer)
        )
      )
    )
  }

  test("publish cashu & fedimint info and recommend", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      // Create keys for publishers
      const cashuKey = yield* crypto.generatePrivateKey()
      const cashuPub = yield* crypto.getPublicKey(cashuKey)
      const fedimintKey = yield* crypto.generatePrivateKey()
      const userKey = yield* crypto.generatePrivateKey()

      // Publish cashu mint info (38172)
      const cashuD = "cashu-pk-123"
      const r1 = yield* mintService.publishCashuMintInfo(
        {
          d: cashuD,
          url: "https://cashu.example.com",
          nuts: [1, 2, 3, 4],
          network: "testnet",
          content: "{\"name\":\"Cashu Example\"}",
        },
        cashuKey
      )
      expect(r1.accepted).toBe(true)

      // Publish fedimint info (38173)
      const fedimintD = "fedimint-id-xyz"
      const r2 = yield* mintService.publishFedimintInfo(
        {
          d: fedimintD,
          invites: ["fed11abc..", "fed11xyz.."],
          modules: ["lightning", "wallet", "mint"],
          network: "signet",
        },
        fedimintKey
      )
      expect(r2.accepted).toBe(true)

      // Recommend the cashu mint (38000), pointing to the cashu info event using 'a' tag
      const r3 = yield* mintService.recommendMint(
        {
          kind: 38172,
          d: cashuD,
          u: ["https://cashu.example.com"],
          pointers: [
            { kind: 38172, pubkey: cashuPub, d: cashuD, label: "cashu" },
          ],
          content: "I trust this Cashu mint",
        },
        userKey
      )
      expect(r3.accepted).toBe(true)

      // Lookup recommendation
      const recs = (yield* mintService.findRecommendations({
        filterByKind: 38172,
        limit: 1,
      })) as readonly MintRecommendation[]

      expect(recs.length).toBeGreaterThanOrEqual(1)
      const rec = recs[0]!
      expect(rec.recommendedKind).toBe(38172)
      expect(rec.d).toBe(cashuD)
      expect(rec.urls[0]).toBe("https://cashu.example.com")
      expect(rec.pointers[0]?.pubkey).toBe(cashuPub)

      // Fetch mint info by d
      const info = yield* mintService.getMintInfoByD({ kind: 38172, d: cashuD })
      expect(info?.kind as number).toBe(38172)
      const nuts = info?.tags.find((t) => t[0] === "nuts")?.[1]
      expect(nuts).toBe("1,2,3,4")

      // Ensure fedimint info was published as 38173
      const info2 = yield* mintService.getMintInfoByD({
        kind: 38173,
        d: fedimintD,
      })
      expect(info2?.kind as number).toBe(38173)
      const modules = info2?.tags.find((t) => t[0] === "modules")?.[1]
      expect(modules).toBe("lightning,wallet,mint")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
