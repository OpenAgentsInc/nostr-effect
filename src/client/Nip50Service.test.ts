/**
 * Tests for NIP-50 (Search Capability via filter.search)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream, Option } from "effect"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind, Filter } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)

describe("NIP-50 Search", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 29000 + Math.floor(Math.random() * 10000)
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
    return Layer.merge(RelayLayer, ServiceLayer)
  }

  test("search content substring", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()

      const contents = [
        "Yaks are amazing animals.",
        "This post is about nostr and Effect.",
        "yak milk and yak wool", // lower case
      ]
      for (const c of contents) {
        const e = yield* events.createEvent(
          { kind: decodeKind(1), content: c, tags: [] },
          sk
        )
        const res = yield* relayService.publish(e)
        expect(res.accepted).toBe(true)
      }

      // search for 'yak' (case-insensitive): should match 2 events
      const filter = decodeFilter({ kinds: [decodeKind(1)], search: "yak", limit: 10 })
      const sub = yield* relayService.subscribe([filter])

      const found: string[] = []
      // collect up to 2 matching events quickly
      for (let i = 0; i < 2; i++) {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(300).pipe(Effect.as(Option.none()))
        )
        if (Option.isSome(next)) found.push(next.value.content)
      }

      expect(found.length).toBeGreaterThanOrEqual(2)
      expect(found.some((c) => c.toLowerCase().includes("yak")).valueOf()).toBe(true)

      yield* sub.unsubscribe()
      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})

