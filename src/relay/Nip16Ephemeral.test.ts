/**
 * NIP-16 ephemeral events: broadcast-only, not stored
 */
import { test, expect, describe, beforeAll, afterAll } from "vite-plus/test"
import { Effect, Layer, Stream, Option } from "effect"
import { startTestRelay, type RelayHandle } from "./backends/node/index.js"
import { RelayService, makeRelayService } from "../client/RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "effect"
import { EventKind, Filter } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)

describe("NIP-16 Ephemeral events", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 31000 + Math.floor(Math.random() * 10000)
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

  test("ephemeral kind is accepted but not returned by later REQ", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      // kind 20000 is ephemeral
      const ephemeral = yield* events.createEvent(
        { kind: decodeKind(20000), content: "ephemeral ping", tags: [] },
        sk
      )
      const pub = yield* relayService.publish(ephemeral)
      expect(pub.accepted).toBe(true)

      // Subsequent query must not return the ephemeral event
      const sub = yield* relayService.subscribe([
        decodeFilter({ kinds: [decodeKind(20000)], authors: [author] }),
      ])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(400).pipe(Effect.as(Option.none()))
      )
      yield* sub.unsubscribe()
      expect(Option.isNone(maybe)).toBe(true)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
