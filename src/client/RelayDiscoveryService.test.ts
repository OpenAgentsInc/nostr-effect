/**
 * Tests for RelayDiscoveryService (NIP-66)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { RelayDiscoveryService, RelayDiscoveryServiceLive } from "./RelayDiscoveryService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"

describe("RelayDiscoveryService (NIP-66)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 20000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        RelayDiscoveryServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  test("publish discovery (30166) and fetch latest by d-tag", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* RelayDiscoveryService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const input = {
        relayId: "wss://example.test/",
        nip11Content: "{}",
        metrics: { rtt_open: 200, rtt_read: 150, rtt_write: 160 },
        tags: {
          network: "clearnet" as const,
          relayType: "Public",
          nips: [1, 11, 16, 33],
          requirements: ["auth", "!payment"],
          topics: ["nsfw", "cats"],
          kinds: ["1", "!4"],
          geohash: "ww8p1r4t8",
          languages: ["en"],
        },
      }
      const res = yield* svc.publishDiscovery(input, sk)
      expect(res.accepted).toBe(true)

      const evt = yield* svc.getLatestForRelay("wss://example.test/")
      expect(evt?.kind as number).toBe(30166)
      expect(evt?.tags.find((t) => t[0] === "d")?.[1]).toBe("wss://example.test/")
      expect(evt?.tags.find((t) => t[0] === "n")?.[1]).toBe("clearnet")
      expect(evt?.tags.find((t) => t[0] === "T")?.[1]).toBe("Public")
      const N = (evt?.tags.filter((t) => t[0] === "N") ?? []).map((t) => t[1])
      expect(N).toEqual(["1", "11", "16", "33"])
      const R = (evt?.tags.filter((t) => t[0] === "R") ?? []).map((t) => t[1])
      expect(R).toEqual(["auth", "!payment"])
      const t = (evt?.tags.filter((t) => t[0] === "t") ?? []).map((t) => t[1])
      expect(t).toEqual(["nsfw", "cats"])
      const k = (evt?.tags.filter((t) => t[0] === "k") ?? []).map((t) => t[1])
      expect(k).toEqual(["1", "!4"])
      expect(evt?.tags.find((t) => t[0] === "g")?.[1]).toBe("ww8p1r4t8")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("publish monitor announcement (10166)", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* RelayDiscoveryService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const res = yield* svc.publishMonitorAnnouncement(
        {
          frequencySeconds: 3600,
          timeouts: [
            ["open", "5000"],
            ["read", "3000"],
            ["write", "3000"],
          ],
          checks: ["ws", "nip11", "ssl"],
          geohash: "ww8p1r4t8",
        },
        sk
      )
      expect(res.accepted).toBe(true)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("findRelays filters by network and topic", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* RelayDiscoveryService
      const crypto = yield* CryptoService
      // ensure EventService composes
      yield* EventService

      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      // Publish two discovery events with different networks/topics
      yield* svc.publishDiscovery(
        { relayId: "wss://a.example/", tags: { network: "clearnet", topics: ["cats"] } },
        sk
      )
      yield* svc.publishDiscovery(
        { relayId: "wss://b.example/", tags: { network: "tor", topics: ["dogs"] } },
        sk
      )

      const clearnet = yield* svc.findRelays({ byNetwork: "clearnet", limit: 5 })
      expect(clearnet.some((r) => r.relayId === "wss://a.example/")).toBe(true)
      expect(clearnet.some((r) => r.relayId === "wss://b.example/")).toBe(false)

      const cats = yield* svc.findRelays({ byTopic: "cats", limit: 5 })
      expect(cats.some((r) => r.relayId === "wss://a.example/")).toBe(true)
      expect(cats.some((r) => r.relayId === "wss://b.example/")).toBe(false)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
