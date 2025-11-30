/**
 * NipEEService tests (NIP-EE MLS)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { NipEEService, NipEEServiceLive } from "./NipEEService.js"
import { unwrapEvent } from "../core/Nip59.js"
import { MLSKeyPackage as KP_KIND, MLSWelcome as WELCOME_KIND } from "../wrappers/kinds.js"

describe("NipEEService (NIP-EE)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 34000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(ServiceLayer, NipEEServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish KeyPackage and fetch latest", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipEEService
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const res = yield* svc.publishKeyPackage(
        {
          keyPackageHex: "abcd",
          mlsProtocolVersion: "1.0",
          ciphersuite: "0x0001",
          extensions: ["0x0001", "0x0002"],
          clientInfo: ["nostr-effect", "deadbeef"],
          relays: ["wss://example"]
        },
        sk
      )
      expect(res.accepted).toBe(true)

      const kp = yield* svc.getLatestKeyPackage(author, 800)
      expect(kp).not.toBeNull()
      expect(kp!.kind as number).toBe(KP_KIND)
      // tags
      const tags = kp!.tags
      expect(tags.find(t => t[0] === "mls_protocol_version")?.[1]).toBe("1.0")
      expect(tags.find(t => t[0] === "ciphersuite")?.[1]).toBe("0x0001")
      const ext = tags.find(t => t[0] === "extensions")
      expect(ext).toBeDefined()

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("publish KeyPackage Relays list", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipEEService
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const res = yield* svc.publishKeyPackageRelays({ relays: ["wss://relay1", "wss://relay2"] }, sk)
      expect(res.accepted).toBe(true)

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("create Welcome wrap and unwrap (NIP-59)", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* NipEEService
      const crypto = yield* CryptoService

      const senderSk = yield* crypto.generatePrivateKey()
      const recipientSk = yield* crypto.generatePrivateKey()
      const recipientPk = yield* crypto.getPublicKey(recipientSk)

      const senderKeyBytes = new Uint8Array(Buffer.from(senderSk, "hex"))
      const recipientKeyBytes = new Uint8Array(Buffer.from(recipientSk, "hex"))
      const wrap = yield* svc.createWelcomeWrap({
        welcomeSerialized: "{\"welcome\":true}",
        keyPackageEventId: "e0".repeat(32),
        relays: ["wss://r1", "wss://r2"],
        senderPrivateKey: senderKeyBytes,
        recipientPublicKey: recipientPk,
      })

      const rumor = unwrapEvent(wrap, recipientKeyBytes)
      expect(rumor.kind as number).toBe(WELCOME_KIND)
      expect(rumor.content).toBe("{\"welcome\":true}")
      const eTag = rumor.tags.find(t => t[0] === "e")
      expect(eTag).toBeDefined()
      const relaysTag = rumor.tags.find(t => t[0] === "relays")
      expect(relaysTag).toBeDefined()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
