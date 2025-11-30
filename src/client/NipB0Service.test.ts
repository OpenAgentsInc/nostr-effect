/**
 * NipB0Service tests (NIP-B0 Web Bookmarking)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { NipB0Service, NipB0ServiceLive, BOOKMARK_KIND } from "./NipB0Service.js"
 

describe("NipB0Service (NIP-B0)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 32000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(ServiceLayer, NipB0ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish bookmark and fetch by url", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipB0Service
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)
      const url = "https://alice.blog/post"
      const res = yield* svc.publishBookmark({ url, title: "Alice Post", topics: ["post", "insight"], content: "A marvelous insight." }, sk)
      expect(res.accepted).toBe(true)

      const ev = yield* svc.getByUrl(url, author, 800)
      expect(ev?.kind as number).toBe(BOOKMARK_KIND)
      // d-tag stores URL without scheme
      expect(ev?.tags.find((t) => t[0] === "d")?.[1]).toBe("alice.blog/post")
      expect(ev?.tags.find((t) => t[0] === "title")?.[1]).toBe("Alice Post")
      expect(ev?.tags.filter((t) => t[0] === "t").length).toBeGreaterThanOrEqual(1)

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("parameterized replaceable: newer bookmark replaces older", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipB0Service
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)
      const url = "http://example.com/page"

      // Force distinct seconds to ensure replacement ordering
      const now = Math.floor(Date.now() / 1000)
      // First publish
      const r1 = yield* svc.publishBookmark({ url, title: "v1", content: "one", createdAt: now }, sk)
      expect(r1.accepted).toBe(true)

      // Second publish (same d)
      const r2 = yield* svc.publishBookmark({ url, title: "v2", content: "two", createdAt: now + 2 }, sk)
      expect(r2.accepted).toBe(true)

      // Fetch by d
      const ev = yield* svc.getByUrl(url, author, 800)
      expect(ev?.tags.find((t) => t[0] === "title")?.[1]).toBe("v2")
      expect(ev?.content).toBe("two")

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("list by topic t-tag", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipB0Service
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      yield* svc.publishBookmark({ url: "https://news.example/1", topics: ["news"], content: "n1" }, sk)
      yield* svc.publishBookmark({ url: "https://news.example/2", topics: ["news"], content: "n2" }, sk)

      const list = yield* svc.listByTopic("news", { limit: 2, timeoutMs: 800 })
      expect(list.length).toBeGreaterThanOrEqual(1)
      for (const e of list) {
        expect(e.kind as number).toBe(BOOKMARK_KIND)
      }

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
