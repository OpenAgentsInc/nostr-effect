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
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind, Tag } from "../core/Schema.js"
const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

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

  test("cashu info includes nuts and network tags", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const key = yield* crypto.generatePrivateKey()
      const d = "cashu-pk-abc"
      const res = yield* mintService.publishCashuMintInfo(
        { d, url: "https://cashu.test", nuts: [1, 2, 7], network: "mainnet" },
        key
      )
      expect(res.accepted).toBe(true)

      const evt = yield* mintService.getMintInfoByD({ kind: 38172, d })
      expect(evt?.kind as number).toBe(38172)
      expect(evt?.tags.find((t) => t[0] === "u")?.[1]).toBe("https://cashu.test")
      expect(evt?.tags.find((t) => t[0] === "nuts")?.[1]).toBe("1,2,7")
      expect(evt?.tags.find((t) => t[0] === "n")?.[1]).toBe("mainnet")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("fedimint info includes multiple invites and modules tag", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const key = yield* crypto.generatePrivateKey()
      const d = "fedimint-id-abc"
      const res = yield* mintService.publishFedimintInfo(
        { d, invites: ["fed11AAA..", "fed11BBB.."], modules: ["wallet", "mint"], network: "signet" },
        key
      )
      expect(res.accepted).toBe(true)

      const evt = yield* mintService.getMintInfoByD({ kind: 38173, d })
      expect(evt?.kind as number).toBe(38173)
      const uTags = evt?.tags.filter((t) => t[0] === "u") ?? []
      expect(uTags.length).toBe(2)
      expect(uTags.map((t) => t[1])).toEqual(["fed11AAA..", "fed11BBB.."])
      expect(evt?.tags.find((t) => t[0] === "modules")?.[1]).toBe("wallet,mint")
      expect(evt?.tags.find((t) => t[0] === "n")?.[1]).toBe("signet")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("recommendation 'a' pointer parsing with relay hint and label", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const key = yield* crypto.generatePrivateKey()
      const pub = yield* crypto.getPublicKey(key)
      const d = "cashu-pk-xyz"
      // Publish info first
      yield* mintService.publishCashuMintInfo({ d, url: "https://cashu.parse" }, key)

      // Recommend
      const r = yield* mintService.recommendMint(
        {
          kind: 38172,
          d,
          u: ["https://cashu.parse"],
          pointers: [{ kind: 38172, pubkey: pub, d, relay: "wss://hint.example", label: "cashu" }],
          content: "Great mint",
        },
        key
      )
      expect(r.accepted).toBe(true)

      const recs = yield* mintService.findRecommendations({ filterByKind: 38172, limit: 2 })
      expect(recs.length).toBeGreaterThan(0)
      const match = recs.find((x) => x.d === d)
      expect(match?.pointers[0]?.relay).toBe("wss://hint.example")
      expect(match?.pointers[0]?.label).toBe("cashu")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("recommend fedimint (38173) with invites and 'a' pointer", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      // Publish a fedimint info event to point at
      const fedSk = yield* crypto.generatePrivateKey()
      const fedPk = yield* crypto.getPublicKey(fedSk)
      const d = "fedimint-xyz"
      yield* mintService.publishFedimintInfo({ d, invites: ["fed11one", "fed11two"], modules: ["wallet"], network: "regtest" }, fedSk)

      // Recommend that fedimint with invites and a pointer + relay/label
      const author = yield* crypto.generatePrivateKey()
      yield* mintService.recommendMint({
        kind: 38173,
        d,
        u: ["fed11one", "fed11two"],
        pointers: [{ kind: 38173, pubkey: fedPk, d, relay: "wss://fed.hint", label: "fedimint" }],
        content: "solid federation",
      }, author)

      const recs = yield* mintService.findRecommendations({ filterByKind: 38173, limit: 2 })
      expect(recs.length).toBeGreaterThan(0)
      const rec = recs.find((x) => x.d === d)
      expect(rec?.recommendedKind).toBe(38173)
      // ensures both invites are surfaced from 'u' tags
      expect(rec?.urls.includes("fed11one")).toBe(true)
      expect(rec?.urls.includes("fed11two")).toBe(true)
      expect(rec?.pointers[0]?.kind).toBe(38173)
      expect(rec?.pointers[0]?.relay).toBe("wss://fed.hint")
      expect(rec?.pointers[0]?.label).toBe("fedimint")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("findRecommendations respects authors filter and limit", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      // Two authors
      const author1 = yield* crypto.generatePrivateKey()
      const author2 = yield* crypto.generatePrivateKey()

      // Publish two minimal recommendations from different authors
      yield* mintService.recommendMint({ kind: 38172, d: "r-auth-1" }, author1)
      yield* mintService.recommendMint({ kind: 38172, d: "r-auth-2" }, author2)

      // Filter by author1 only
      const recs1 = yield* mintService.findRecommendations({ authors: [yield* crypto.getPublicKey(author1)], filterByKind: 38172, limit: 5 })
      expect(recs1.length).toBeGreaterThan(0)
      for (const r of recs1) {
        expect(r.recommendedKind).toBe(38172)
        expect(r.d.length).toBeGreaterThan(0)
      }

      // Filter by author2 and limit 1
      const recs2 = yield* mintService.findRecommendations({ authors: [yield* crypto.getPublicKey(author2)], filterByKind: 38172, limit: 1 })
      expect(recs2.length).toBe(1)
      expect(recs2[0]?.d).toBe("r-auth-2")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("recommendation with multiple 'a' pointers parses all", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      // Publish two info events
      const sk1 = yield* crypto.generatePrivateKey()
      const pk1 = yield* crypto.getPublicKey(sk1)
      const sk2 = yield* crypto.generatePrivateKey()
      const pk2 = yield* crypto.getPublicKey(sk2)
      yield* mintService.publishCashuMintInfo({ d: "multi-a-1", url: "https://m1" }, sk1)
      yield* mintService.publishCashuMintInfo({ d: "multi-a-2", url: "https://m2" }, sk2)

      // Recommend with two pointers
      const author = yield* crypto.generatePrivateKey()
      yield* mintService.recommendMint({
        kind: 38172,
        d: "multi-a-1",
        pointers: [
          { kind: 38172, pubkey: pk1, d: "multi-a-1", relay: "wss://hint1", label: "m1" },
          { kind: 38172, pubkey: pk2, d: "multi-a-2", relay: "wss://hint2", label: "m2" },
        ],
        content: "two mints",
      }, author)

      const recs = yield* mintService.findRecommendations({ filterByKind: 38172, limit: 3 })
      const rec = recs.find((x) => x.d === "multi-a-1")
      expect(rec).toBeDefined()
      expect(rec?.pointers.length).toBeGreaterThanOrEqual(2)
      const labels = (rec?.pointers ?? []).map((p) => p.label)
      expect(labels).toContain("m1")
      expect(labels).toContain("m2")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("findRecommendations filters by kind and ignores invalid 'k' or missing 'd'", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService
      const eventService = yield* EventService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      // Good recommendation
      const user = yield* crypto.generatePrivateKey()
      const d = "good-mint"
      yield* mintService.recommendMint({ kind: 38172, d }, user)

      // Bad: wrong kind in 'k'
      const badUser = yield* crypto.generatePrivateKey()
      const badEvent = yield* eventService.createEvent(
        {
          kind: decodeKind(38000),
          content: "",
          tags: [["k", "99999"], ["d", "bad"]].map((t) => decodeTag(t as any)),
        },
        badUser
      )
      // Publish directly
      const p1 = yield* relayService.publish(badEvent)
      expect(p1.accepted).toBe(true)

      // Bad: missing d
      const badUser2 = yield* crypto.generatePrivateKey()
      const badEvent2 = yield* eventService.createEvent(
        {
          kind: decodeKind(38000),
          content: "",
          tags: [["k", "38172"]].map((t) => decodeTag(t as any)),
        },
        badUser2
      )
      const p2 = yield* relayService.publish(badEvent2)
      expect(p2.accepted).toBe(true)

      // Query filtered by correct kind, should only include the good one
      const recs = yield* mintService.findRecommendations({ filterByKind: 38172, limit: 5 })
      // Ensure all returned recs have k=38172 and have a d tag
      expect(recs.length).toBeGreaterThan(0)
      for (const r of recs) {
        expect(r.recommendedKind).toBe(38172)
        expect(r.d.length).toBeGreaterThan(0)
      }

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("getMintInfoByD returns null when not found", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const mintService = yield* MintDiscoverabilityService

      yield* relayService.connect()

      const missing = yield* mintService.getMintInfoByD({ kind: 38172, d: "__missing__" })
      expect(missing).toBeNull()

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
