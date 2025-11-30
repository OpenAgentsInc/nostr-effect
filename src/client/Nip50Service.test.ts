/**
 * Tests for Nip50Service (NIP-50 Search)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { Schema } from "@effect/schema"
import { EventKind } from "../core/Schema.js"
import { Nip50Service, Nip50ServiceLive } from "./Nip50Service.js"

const decodeKind = Schema.decodeSync(EventKind)

const ServiceLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

describe("Nip50Service (NIP-50)", () => {
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
    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        Nip50ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  const publish = (content: string) =>
    Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      const sk = yield* crypto.generatePrivateKey()
      yield* relaySvc.connect()
      const ev = yield* events.createEvent(
        { kind: decodeKind(1), content, tags: [] },
        sk
      )
      const ok = yield* relaySvc.publish(ev)
      expect(ok.accepted).toBe(true)
      yield* relaySvc.disconnect()
      return ev
    })

  test("search finds events by content substring", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      // Publish a few events
      yield* publish("hello world")
      yield* publish("HELLO again")
      yield* publish("goodbye")

      const svc = yield* Nip50Service
      yield* relaySvc.connect()
      const results = yield* svc.search({ query: "hello", kinds: [1], limit: 2, timeoutMs: 800 })
      expect(results.length).toBeGreaterThanOrEqual(2)
      for (const ev of results) expect((ev.content.toLowerCase().includes("hello"))).toBe(true)
      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("getOne returns first match or null", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* Nip50Service
      yield* relaySvc.connect()
      const one = yield* svc.getOne({ query: "goodbye", kinds: [1], timeoutMs: 800 })
      expect(one).not.toBeNull()
      const miss = yield* svc.getOne({ query: "no-such", kinds: [1], timeoutMs: 400 })
      expect(miss).toBeNull()
      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
