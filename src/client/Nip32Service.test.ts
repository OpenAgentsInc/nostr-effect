/**
 * Tests for Nip32Service (NIP-32)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Nip32Service, Nip32ServiceLive } from "./Nip32Service.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("Nip32Service (NIP-32)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 24000 + Math.floor(Math.random() * 10000)
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
      Layer.merge(ServiceLayer, Nip32ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish label for pubkeys under namespace", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip32Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk1 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())
      const pk2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

      const res = yield* svc.publishLabel(
        {
          L: ["ISO-639-1"],
          labels: [{ value: "en", mark: "ISO-639-1" }],
          targets: [
            { type: "p", pubkey: pk1 },
            { type: "p", pubkey: pk2 },
          ],
        },
        sk
      )
      expect(res.accepted).toBe(true)

      const q = yield* svc.queryLabels({ namespaces: ["ISO-639-1"], limit: 5 })
      expect(q.length).toBeGreaterThan(0)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("label topic via #t and query by target", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip32Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()

      const res = yield* svc.publishLabel(
        {
          L: ["#t"],
          labels: [{ value: "permies", mark: "#t" }],
          targets: [{ type: "t", topic: "permies" }],
          content: "topic assignment",
        },
        sk
      )
      expect(res.accepted).toBe(true)

      const q = yield* svc.queryLabels({ target: { type: "t", topic: "permies" }, limit: 1 })
      expect(q.length).toBeGreaterThan(0)
      expect(q[0]?.tags.find((t) => t[0] === "l")?.[1]).toBe("permies")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
