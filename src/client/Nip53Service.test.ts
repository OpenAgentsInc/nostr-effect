/**
 * Tests for Nip53Service (NIP-53)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Nip53Service, Nip53ServiceLive } from "./Nip53Service.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("Nip53Service (NIP-53)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 23000 + Math.floor(Math.random() * 10000)
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
      Layer.merge(ServiceLayer, Nip53ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish live event and fetch by d", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip53Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const res = yield* svc.publishLiveEvent({
        d: "live-1",
        title: "Demo Live",
        status: "planned",
        hashtags: ["demo"],
        starts: Math.floor(Date.now() / 1000),
        participants: [{ pubkey: pk, role: "Host" }],
      }, sk)
      expect(res.accepted).toBe(true)

      const evt = yield* svc.getLiveEvent(pk, "live-1")
      expect(evt?.kind as number).toBe(30311)
      expect(evt?.tags.find((t) => t[0] === "title")?.[1]).toBe("Demo Live")
      expect(evt?.tags.find((t) => t[0] === "status")?.[1]).toBe("planned")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("publish live chat linked by a-tag", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip53Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      // Ensure live event exists
      yield* svc.publishLiveEvent({ d: "live-2", title: "L2" }, sk)

      const chat = yield* svc.publishLiveChat({ a: { pubkey: pk, d: "live-2" }, content: "Hello stream!" }, sk)
      expect(chat.accepted).toBe(true)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
