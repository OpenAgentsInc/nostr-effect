/**
 * NIP-70 Protected Events: ensure default behavior rejects events with ["-"] when no AUTH is configured.
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "./index.js"
import { RelayService, makeRelayService } from "../client/RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind, Tag } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

describe("NIP-70 Protected Events (default reject)", () => {
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

  test("protected event is rejected without AUTH", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()

      const e = yield* events.createEvent(
        {
          kind: decodeKind(1),
          content: "protected",
          tags: [["-"]].map((t) => decodeTag(t as any)),
        },
        sk
      )
      const res = yield* relayService.publish(e)
      expect(res.accepted).toBe(false)
      expect(res.message.includes("auth-required")).toBe(true)
      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})

