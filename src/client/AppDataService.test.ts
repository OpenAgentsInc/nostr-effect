/**
 * Tests for AppDataService (NIP-78)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { AppDataService, AppDataServiceLive } from "./AppDataService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"

describe("AppDataService (NIP-78)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 19000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({
      url: `ws://localhost:${port}`,
      reconnect: false,
    })

    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )

    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        AppDataServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  test("put/get roundtrip", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const app = yield* AppDataService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const keypair = yield* crypto.generatePrivateKey()
      const pub = yield* crypto.getPublicKey(keypair)

      const r = yield* app.put({ key: "settings.theme", content: "dark" }, keypair)
      expect(r.accepted).toBe(true)

      const evt = yield* app.get({ pubkey: pub, key: "settings.theme" })
      expect(evt?.kind as number).toBe(30078)
      expect(evt?.content).toBe("dark")
      expect(evt?.tags.find((t) => t[0] === "d")?.[1]).toBe("settings.theme")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("replacement semantics (same key replaces)", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const app = yield* AppDataService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const keypair = yield* crypto.generatePrivateKey()
      const pub = yield* crypto.getPublicKey(keypair)
      const d = "app.cfg"

      const r1 = yield* app.put({ key: d, content: "v1" }, keypair)
      expect(r1.accepted).toBe(true)
      const r2 = yield* app.put({ key: d, content: "v2" }, keypair)
      expect(r2.accepted).toBe(true)

      const evt = yield* app.get({ pubkey: pub, key: d })
      expect(evt?.content).toBe("v2")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("listKeys returns keys and respects prefix", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const app = yield* AppDataService
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const keypair = yield* crypto.generatePrivateKey()
      const pub = yield* crypto.getPublicKey(keypair)

      yield* app.put({ key: "prefs.ui", content: "x" }, keypair)
      yield* app.put({ key: "prefs.sound", content: "y" }, keypair)
      yield* app.put({ key: "profile.name", content: "z" }, keypair)

      const all = yield* app.listKeys({ pubkey: pub })
      expect([...all].sort()).toEqual(["prefs.ui", "prefs.sound", "profile.name"].sort())

      const prefs = yield* app.listKeys({ pubkey: pub, prefix: "prefs." })
      expect([...prefs].sort()).toEqual(["prefs.ui", "prefs.sound"].sort())

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("putJSON encodes value and get returns it", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const app = yield* AppDataService
      const crypto = yield* CryptoService
      // ensure EventService composes correctly in layer
      yield* EventService

      yield* relayService.connect()

      const keypair = yield* crypto.generatePrivateKey()
      const pub = yield* crypto.getPublicKey(keypair)

      const obj = { a: 1, b: "two" }
      const r = yield* app.putJSON({ key: "json.demo", value: obj }, keypair)
      expect(r.accepted).toBe(true)

      const evt = yield* app.get({ pubkey: pub, key: "json.demo" })
      expect(evt?.content).toBe(JSON.stringify(obj))

      // also ensure it is a valid 30078 event with d tag
      expect(evt?.kind as number).toBe(30078)
      expect(evt?.tags.find((t) => t[0] === "d")?.[1]).toBe("json.demo")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
