/**
 * Tests for Nip45Service (NIP-45 Event Counts)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Nip45Service, Nip45ServiceLive } from "./Nip45Service.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind, Tag } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

describe("Nip45Service (NIP-45)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 28000 + Math.floor(Math.random() * 10000)
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
      Layer.merge(ServiceLayer, Nip45ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("count followers (kind 3 p-tag)", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip45Service
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relayService.connect()

      const target = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())
      const follower1 = yield* crypto.generatePrivateKey()
      const follower2 = yield* crypto.generatePrivateKey()

      // Publish two kind-3 follow lists referring to target via p-tag
      for (const sk of [follower1, follower2]) {
        const e = yield* events.createEvent(
          {
            kind: decodeKind(3),
            content: "",
            tags: [["p", target]].map((t) => decodeTag(t as any)),
          },
          sk
        )
        const res = yield* relayService.publish(e)
        expect(res.accepted).toBe(true)
      }

      // COUNT kind 3 with #p == target
      const result = yield* svc.count([{ kinds: [decodeKind(3)], "#p": [target] }], 2000)
      expect(result.count).toBeGreaterThanOrEqual(2)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("count posts by author (kind 1)", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip45Service
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      for (let i = 0; i < 3; i++) {
        const e = yield* events.createEvent(
          { kind: decodeKind(1), content: `note ${i}`, tags: [] },
          sk
        )
        const res = yield* relayService.publish(e)
        expect(res.accepted).toBe(true)
      }

      const result = yield* svc.count([{ kinds: [decodeKind(1)], authors: [author] }], 2000)
      expect(result.count).toBeGreaterThanOrEqual(3)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})

