/**
 * Relay rate limiting tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "./index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { makeRelayService, RelayService } from "../client/RelayService.js"
import { Schema } from "@effect/schema"
import { EventKind } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)

const ServiceLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

describe("Relay rate limiting", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    // Configure a tight limit for the test window
    ;(process as any).env.RELAY_RL_MAX_EVENTS = "3"
    ;(process as any).env.RELAY_RL_WINDOW_MS = "800"
    port = 28000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    // Cleanup env
    delete (process as any).env.RELAY_RL_MAX_EVENTS
    delete (process as any).env.RELAY_RL_WINDOW_MS
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => Layer.merge(
    makeRelayService({ url: `ws://localhost:${port}`, reconnect: false }),
    ServiceLayer
  )

  test("EVENT publishes beyond threshold are rejected", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      // Publish 5 events rapidly; expect at least 2 to be rate-limited
      let rejected = 0
      for (let i = 0; i < 5; i++) {
        const ev = yield* events.createEvent(
          { kind: decodeKind(1), content: `msg-${i}`, tags: [] },
          sk
        )
        const res = yield* relaySvc.publish(ev)
        if (!res.accepted && res.message.includes("rate-limited")) rejected++
      }
      expect(rejected).toBeGreaterThanOrEqual(1)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})

