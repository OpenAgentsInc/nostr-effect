/**
 * Tests for Nip23Service (NIP-23)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Nip23Service, Nip23ServiceLive } from "./Nip23Service.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("Nip23Service (NIP-23)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 21000 + Math.floor(Math.random() * 10000)
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
        Nip23ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  test("publish article and get by d", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip23Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const r = yield* svc.publishArticle({ d: "post-1", content: "Hello world", title: "Hello" }, sk)
      expect(r.accepted).toBe(true)

      const evt = yield* svc.getArticle({ author: pk, d: "post-1" })
      expect(evt?.kind as number).toBe(30023)
      expect(evt?.content).toBe("Hello world")
      expect(evt?.tags.find((t) => t[0] === "d")?.[1]).toBe("post-1")
      expect(evt?.tags.find((t) => t[0] === "title")?.[1]).toBe("Hello")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("replacement: newer article replaces same d", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip23Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const d = "post-2"
      const r1 = yield* svc.publishArticle({ d, content: "v1" }, sk)
      expect(r1.accepted).toBe(true)
      // avoid same-second timestamp tie
      yield* Effect.sleep(1100)
      const r2 = yield* svc.publishArticle({ d, content: "v2" }, sk)
      expect(r2.accepted).toBe(true)

      const evt = yield* svc.getArticle({ author: pk, d })
      expect(evt?.content).toBe("v2")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("listArticles returns multiple for author", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip23Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      yield* svc.publishArticle({ d: "post-a", content: "A" }, sk)
      yield* svc.publishArticle({ d: "post-b", content: "B" }, sk)

      const list = yield* svc.listArticles({ author: pk, limit: 2 })
      expect(list.length).toBeGreaterThanOrEqual(2)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
