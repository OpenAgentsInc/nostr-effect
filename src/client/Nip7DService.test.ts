/**
 * Nip7DService tests (NIP-7D Threads)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream, Option } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Nip7DService, Nip7DServiceLive } from "./Nip7DService.js"

describe("Nip7DService (NIP-7D)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 35000 + Math.floor(Math.random() * 10000)
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
      Layer.merge(ServiceLayer, Nip7DServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish thread with title and reply via NIP-22", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* Nip7DService
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)
      const now = Math.floor(Date.now() / 1000)

      // Create thread
      const res = yield* svc.publishThread(
        { content: "Good morning", title: "GM", createdAt: now },
        sk
      )
      expect(res.accepted).toBe(true)

      // Fetch the thread
      const list = yield* svc.listThreadsByAuthor({ author, limit: 1, timeoutMs: 800 })
      expect(list.length).toBeGreaterThanOrEqual(1)
      const thread = list[0]!
      expect(thread.kind as number).toBe(11)
      expect(thread.content).toBe("Good morning")
      expect(thread.tags.find(t => t[0] === "title")?.[1]).toBe("GM")

      // Reply via NIP-22 comment to the root
      const relayUrl = `ws://localhost:${port}`
      const res2 = yield* svc.replyToThread(
        { root: thread, content: "nostr:nevent1...\nyes", relayUrl, createdAt: now + 2 },
        sk
      )
      expect(res2.accepted).toBe(true)

      // Verify the reply by querying latest author event (kind 1111)
      // Use RelayService directly for a quick filter
      const filter = { kinds: [1111], authors: [author], limit: 1 } as any
      const sub = yield* relaySvc.subscribe([filter])
      const maybe = yield* sub.events.pipe(Stream.runHead)
      yield* sub.unsubscribe()
      expect(Option.isSome(maybe)).toBe(true)
      const ev = Option.getOrElse(maybe, () => { throw new Error("no event") })
      expect(ev.kind as number).toBe(1111)
      // q/E/K tags present (NIP-22)
      const tags = ev.tags
      expect(tags.find((t) => t[0] === "E")?.[1]).toBe(thread.id)
      expect(tags.find((t) => t[0] === "K")?.[1]).toBe("11")

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
