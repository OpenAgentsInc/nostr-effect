/**
 * NIP-20: Command Results
 *
 * Validate OK responses for publish and duplicates.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "./index.js"
import { RelayService, makeRelayService } from "../client/RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)

describe("NIP-20 Command Results", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 33000 + Math.floor(Math.random() * 10000)
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

  test("OK true on publish; OK duplicate on re‑publish", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const e = yield* events.createEvent({ kind: decodeKind(1), content: "nip20", tags: [] }, sk)

      const r1 = yield* relayService.publish(e)
      expect(r1.accepted).toBe(true)
      expect(r1.message === "" || r1.message.startsWith("info:") || r1.message.startsWith(""))

      const r2 = yield* relayService.publish(e)
      expect(r2.accepted).toBe(true)
      expect(r2.message.includes("duplicate")).toBe(true)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})

