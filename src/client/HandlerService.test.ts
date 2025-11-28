/**
 * Tests for HandlerService (NIP-89)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import {
  HandlerService,
  HandlerServiceLive,
  type HandlerInfo,
  type HandlerRecommendation,
} from "./HandlerService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("HandlerService", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 16000 + Math.floor(Math.random() * 10000)
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
        HandlerServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  describe("publishHandlerInfo and getHandlers", () => {
    test("publishes and retrieves handler info", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const handlerService = yield* HandlerService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const handlerInfo: HandlerInfo = {
          identifier: "my-app",
          kinds: [1, 30023],
          urls: [
            { platform: "web", url: "https://example.com/e/<bech32>", nip19Entity: "nevent" },
            { platform: "ios", url: "example://e/<bech32>" },
          ],
          metadata: {
            name: "My App",
            about: "A test application",
          },
        }

        // Publish handler info
        const publishResult = yield* handlerService.publishHandlerInfo(handlerInfo, privateKey)
        expect(publishResult.accepted).toBe(true)

        yield* Effect.sleep(500)

        // Query for handlers of kind 1
        const result = yield* handlerService.getHandlers(1)

        expect(result.handlers.length).toBeGreaterThanOrEqual(1)
        expect(result.parsed.length).toBeGreaterThanOrEqual(1)

        const parsed = result.parsed.find((p) => p.identifier === "my-app")
        expect(parsed).toBeDefined()
        expect(parsed?.kinds).toContain(1)
        expect(parsed?.kinds).toContain(30023)
        expect(parsed?.urls.length).toBe(2)
        expect(parsed?.metadata?.name).toBe("My App")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("filters handlers by authors", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const handlerService = yield* HandlerService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey1 = yield* crypto.generatePrivateKey()
        const pubkey1 = yield* crypto.getPublicKey(privateKey1)
        const privateKey2 = yield* crypto.generatePrivateKey()

        // Publish from first key
        yield* handlerService.publishHandlerInfo(
          {
            identifier: "app1",
            kinds: [9999],
            urls: [{ platform: "web", url: "https://app1.com/<bech32>" }],
          },
          privateKey1
        )

        // Publish from second key
        yield* handlerService.publishHandlerInfo(
          {
            identifier: "app2",
            kinds: [9999],
            urls: [{ platform: "web", url: "https://app2.com/<bech32>" }],
          },
          privateKey2
        )

        yield* Effect.sleep(500)

        // Query only from first author
        const result = yield* handlerService.getHandlers(9999, [pubkey1])

        // Should only get app1
        const identifiers = result.parsed.map((p) => p.identifier)
        expect(identifiers).toContain("app1")
        expect(identifiers).not.toContain("app2")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("publishRecommendation and getRecommendations", () => {
    test("publishes and retrieves recommendations", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const handlerService = yield* HandlerService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const recommendation: HandlerRecommendation = {
          eventKind: 31337,
          handlerAddress: `31990:${pubkey}:zapstr`,
          relay: "wss://relay.example.com",
          platform: "web",
        }

        // Publish recommendation
        const publishResult = yield* handlerService.publishRecommendation(
          recommendation,
          privateKey
        )
        expect(publishResult.accepted).toBe(true)

        yield* Effect.sleep(500)

        // Query recommendations for kind 31337
        const result = yield* handlerService.getRecommendations(31337)

        expect(result.recommendations.length).toBeGreaterThanOrEqual(1)

        // Check the recommendation has correct structure
        const rec = result.recommendations[0]!
        expect(rec.kind as number).toBe(31989)

        // Check d tag
        const dTag = rec.tags.find((t) => t[0] === "d")
        expect(dTag?.[1]).toBe("31337")

        // Check a tag
        const aTag = rec.tags.find((t) => t[0] === "a")
        expect(aTag?.[1]).toContain("31990:")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("filters recommendations by authors", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const handlerService = yield* HandlerService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey1 = yield* crypto.generatePrivateKey()
        const pubkey1 = yield* crypto.getPublicKey(privateKey1)
        const privateKey2 = yield* crypto.generatePrivateKey()
        const pubkey2 = yield* crypto.getPublicKey(privateKey2)

        // Publish from first key
        yield* handlerService.publishRecommendation(
          {
            eventKind: 8888,
            handlerAddress: `31990:${pubkey1}:app1`,
          },
          privateKey1
        )

        // Publish from second key
        yield* handlerService.publishRecommendation(
          {
            eventKind: 8888,
            handlerAddress: `31990:${pubkey2}:app2`,
          },
          privateKey2
        )

        yield* Effect.sleep(500)

        // Query only from first author
        const result = yield* handlerService.getRecommendations(8888, [pubkey1])

        // Should only get recommendation from pubkey1
        expect(result.recommendations.length).toBe(1)
        expect(result.recommendations[0]?.pubkey).toBe(pubkey1)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("getHandlerByAddress", () => {
    test("retrieves specific handler by pubkey and identifier", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const handlerService = yield* HandlerService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        // Publish handler
        yield* handlerService.publishHandlerInfo(
          {
            identifier: "specific-handler",
            kinds: [7777],
            urls: [{ platform: "web", url: "https://specific.com/<bech32>" }],
          },
          privateKey
        )

        yield* Effect.sleep(500)

        // Get by address
        const handler = yield* handlerService.getHandlerByAddress(pubkey, "specific-handler")

        expect(handler).toBeDefined()
        expect(handler?.kind as number).toBe(31990)

        const dTag = handler?.tags.find((t) => t[0] === "d")
        expect(dTag?.[1]).toBe("specific-handler")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns undefined for non-existent handler", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const handlerService = yield* HandlerService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const handler = yield* handlerService.getHandlerByAddress(pubkey, "nonexistent")

        expect(handler).toBeUndefined()

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("replaceable event semantics", () => {
    test("newer handler info replaces older one", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const handlerService = yield* HandlerService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        // Publish first version
        yield* handlerService.publishHandlerInfo(
          {
            identifier: "replaceable-app",
            kinds: [1111],
            urls: [{ platform: "web", url: "https://v1.com/<bech32>" }],
          },
          privateKey
        )

        yield* Effect.sleep(1100) // Different timestamp

        // Publish updated version
        yield* handlerService.publishHandlerInfo(
          {
            identifier: "replaceable-app",
            kinds: [1111, 2222],
            urls: [{ platform: "web", url: "https://v2.com/<bech32>" }],
          },
          privateKey
        )

        yield* Effect.sleep(500)

        // Get handler - should return v2
        const handler = yield* handlerService.getHandlerByAddress(pubkey, "replaceable-app")

        expect(handler).toBeDefined()
        const kTags = handler?.tags.filter((t) => t[0] === "k").map((t) => t[1])
        expect(kTags).toContain("1111")
        expect(kTags).toContain("2222")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })
})
