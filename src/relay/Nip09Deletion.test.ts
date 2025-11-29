/**
 * NIP-09 Deletion (kind 5) integration test
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

describe("NIP-09 Deletion", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 30000 + Math.floor(Math.random() * 10000)
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

  test("author deletes their own event via kind 5", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const e1 = yield* events.createEvent({ kind: decodeKind(1), content: "to be deleted", tags: [] }, sk)
      const e2 = yield* events.createEvent({ kind: decodeKind(1), content: "keep me", tags: [] }, sk)
      expect((yield* relayService.publish(e1)).accepted).toBe(true)
      expect((yield* relayService.publish(e2)).accepted).toBe(true)

      // Verify both exist
      const sub0 = yield* relayService.subscribe([decodeFilter({ kinds: [decodeKind(1)], authors: [author] })])
      // Wait for at least 2 events
      let seen = 0
      while (seen < 2) {
        const next = yield* Effect.race(
          sub0.events.pipe(Stream.runHead),
          Effect.sleep(300).pipe(Effect.as(Option.none()))
        )
        if (Option.isSome(next)) seen++
        else break
      }
      yield* sub0.unsubscribe()
      expect(seen).toBeGreaterThanOrEqual(2)

      // Publish deletion event referencing e1
      const del = yield* events.createEvent(
        { kind: decodeKind(5), content: "", tags: [["e", e1.id]].map((t) => decodeTag(t as any)) },
        sk
      )
      expect((yield* relayService.publish(del)).accepted).toBe(true)

      // Now query only for deleted id should return nothing
      const sub1 = yield* relayService.subscribe([decodeFilter({ ids: [e1.id] })])
      const maybe = yield* Effect.race(
        sub1.events.pipe(Stream.runHead),
        Effect.sleep(400).pipe(Effect.as(Option.none()))
      )
      yield* sub1.unsubscribe()
      expect(Option.isNone(maybe)).toBe(true)

      // Query for remaining author's kind 1 should still find at least one
      const sub2 = yield* relayService.subscribe([decodeFilter({ kinds: [decodeKind(1)], authors: [author] })])
      const maybe2 = yield* Effect.race(
        sub2.events.pipe(Stream.runHead),
        Effect.sleep(400).pipe(Effect.as(Option.none()))
      )
      yield* sub2.unsubscribe()
      expect(Option.isSome(maybe2)).toBe(true)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})

