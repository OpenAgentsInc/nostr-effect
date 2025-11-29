/**
 * NIP-62 Request to Vanish (kind 62) integration test (simplified: deletes all author's events up to created_at)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream, Option } from "effect"
import { startTestRelay, type RelayHandle } from "./index.js"
import { RelayService, makeRelayService } from "../client/RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind, Tag, Filter } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)
const decodeFilter = Schema.decodeSync(Filter)

describe("NIP-62 Request to Vanish", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 32000 + Math.floor(Math.random() * 10000)
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

  test("vanish deletes older events but keeps newer", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const e1 = yield* events.createEvent({ kind: decodeKind(1), content: "old", tags: [] }, sk)
      expect((yield* relayService.publish(e1)).accepted).toBe(true)
      // ensure next second
      yield* Effect.sleep(1100)
      const vanish = yield* events.createEvent(
        { kind: decodeKind(62), content: "please delete", tags: [["relay", "ALL_RELAYS"]].map((t) => decodeTag(t as any)) },
        sk
      )
      expect((yield* relayService.publish(vanish)).accepted).toBe(true)
      // ensure next second
      yield* Effect.sleep(1100)
      const e2 = yield* events.createEvent({ kind: decodeKind(1), content: "new", tags: [] }, sk)
      expect((yield* relayService.publish(e2)).accepted).toBe(true)

      // Query author's kind 1 events; should find only the newer one
      const sub = yield* relayService.subscribe([decodeFilter({ authors: [author], kinds: [decodeKind(1)], limit: 2 })])
      const first = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none()))
      )
      yield* sub.unsubscribe()
      expect(Option.isSome(first)).toBe(true)
      if (Option.isSome(first)) {
        expect(first.value.content).toBe("new")
      }

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
