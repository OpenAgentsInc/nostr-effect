/**
 * Tests for Nip51Service (NIP-51 Lists)
 */
import { test, expect, describe, beforeAll, afterAll } from "vite-plus/test"
import { Effect, Layer } from "effect"
import { Nip51Service, Nip51ServiceLive } from "./Nip51Service.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/backends/node/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Nip44ServiceLive } from "../services/Nip44Service.js"
import type { NostrEvent } from "../core/Schema.js"
import { parsePublicItems } from "../wrappers/nip51.js"

describe("Nip51Service (NIP-51)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 27000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.mergeAll(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive)),
      Nip44ServiceLive,
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(ServiceLayer, Nip51ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish and fetch a standard list (bookmarks 10003) with private items", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip51Service
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const publicTags: string[][] = [
        ["r", "https://example.com"],
      ]
      const privateItems: string[][] = [
        ["e", "d78ba0d5dce22bfff9db0a9e996c9ef27e2c91051de0c4e1da340e0326b4941e"],
      ]

      const pub = yield* svc.publishList({ kind: 10003, publicTags, privateItems }, sk)
      expect(pub.accepted).toBe(true)

      const latest = yield* svc.getLatestList({ author, kind: 10003, limit: 1, timeoutMs: 1500 })
      expect(latest?.kind as number).toBe(10003)
      expect((latest?.content?.length ?? 0) > 0).toBe(true)
      expect(parsePublicItems(latest! as any)).toContainEqual(publicTags[0])

      const decrypted = yield* svc.decryptPrivateItems({ event: latest!, authorPrivateKey: sk })
      expect(decrypted?.[0]?.[0]).toBe("e")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("publish parameterized list (30003 bookmarks set) with d tag and fetch", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip51Service
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const d = "my-set"
      const publicTags: string[][] = [ ["t", "nostr"] ]
      const pub = yield* svc.publishList({ kind: 30003, d, publicTags }, sk)
      expect(pub.accepted).toBe(true)

      const latest = yield* svc.getLatestList({ author, kind: 30003, d, limit: 1, timeoutMs: 1200 })
      expect(latest?.kind as number).toBe(30003)
      const dTag = latest?.tags.find((t) => t[0] === "d")?.[1]
      expect(dTag).toBe(d)
      expect(parsePublicItems(latest! as any)).toContainEqual(["t", "nostr"])

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("publish list without private items", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip51Service
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const publicTags = [["p", "npub1..."]]
      const pub = yield* svc.publishList({ kind: 10000, publicTags }, sk)
      expect(pub.accepted).toBe(true)

      const latest = yield* svc.getLatestList({ author, kind: 10000, limit: 1, timeoutMs: 1500 })
      expect(latest?.content).toBe("")
      expect(parsePublicItems(latest! as any)).toContainEqual(publicTags[0])

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("getLatestList times out returns null", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip51Service
      yield* relayService.connect()

      const latest = yield* svc.getLatestList({
        author: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        kind: 10003,
        timeoutMs: 100,
      })
      expect(latest).toBeNull()

      yield* relayService.disconnect()
    }).pipe(Effect.provide(makeTestLayers()))

    await Effect.runPromise(program)
  })

  test("publishList parameterized without d fails", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* Nip51Service
      const crypto = yield* CryptoService

      const sk = yield* crypto.generatePrivateKey()

      const result = yield* svc.publishList({ kind: 30003 }, sk).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(error.message),
          onSuccess: () => Effect.succeed("unexpected success")
        })
      )

      return result
    }).pipe(Effect.provide(makeTestLayers()))

    const message = await Effect.runPromise(program)
    expect(message).toMatch(/d is required/)
  })

  test("decryptPrivateItems empty content returns null", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* Nip51Service
      const crypto = yield* CryptoService

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const emptyEvent = {
        id: "fake",
        sig: "fake",
        kind: 10003 as any,
        created_at: 1,
        pubkey: author,
        content: "",
        tags: []
      } as unknown as NostrEvent

      const decrypted = yield* svc.decryptPrivateItems({ event: emptyEvent, authorPrivateKey: sk })
      expect(decrypted).toBeNull()
    }).pipe(Effect.provide(makeTestLayers()))

    await Effect.runPromise(program)
  })
})
