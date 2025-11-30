/**
 * NIP-40 Expiration tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { startTestRelay, type RelayHandle } from "./index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { makeRelayService, RelayService } from "../client/RelayService.js"
import { Schema } from "@effect/schema"
import { EventKind, Tag, Filter } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)
const decodeFilter = Schema.decodeSync(Filter)

const ServiceLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

describe("NIP-40 Expiration", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 27000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => Layer.merge(
    makeRelayService({ url: `ws://localhost:${port}`, reconnect: false }),
    ServiceLayer
  )

  test("rejects expired submissions", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      // expiration in the past
      const exp = Math.floor(Date.now() / 1000) - 5
      const ev = yield* events.createEvent(
        {
          kind: decodeKind(1),
          content: "expired",
          tags: [["expiration", String(exp)]].map((t) => decodeTag(t)),
        },
        sk
      )
      const res = yield* relaySvc.publish(ev)
      expect(res.accepted).toBe(false)
      expect(res.message.includes("expired")).toBe(true)
      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("filters expired events from queries after TTL", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      // expiration 1 second in the future
      const exp = Math.floor(Date.now() / 1000) + 1
      const ev = yield* events.createEvent(
        {
          kind: decodeKind(1),
          content: "soon-expire",
          tags: [["expiration", String(exp)]].map((t) => decodeTag(t)),
        },
        sk
      )
      const ok = yield* relaySvc.publish(ev)
      expect(ok.accepted).toBe(true)

      // Query immediately: should be found
      const sub1 = yield* relaySvc.subscribe([decodeFilter({ kinds: [decodeKind(1)], limit: 1 })])
      const first = yield* Effect.race(
        sub1.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(undefined))
      )
      expect(first).toBeDefined()
      yield* sub1.unsubscribe()

      // Wait for expiration + small cushion
      yield* Effect.sleep(1200)

      // Query again: should not be found
      const sub2 = yield* relaySvc.subscribe([decodeFilter({ kinds: [decodeKind(1)], limit: 1 })])
      const second = yield* Effect.race(
        sub2.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(undefined))
      )
      expect(second).toBeUndefined()
      yield* sub2.unsubscribe()

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
