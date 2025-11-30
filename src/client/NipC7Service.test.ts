/**
 * NipC7Service tests (NIP-C7 Chats)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { NipC7Service, NipC7ServiceLive } from "./NipC7Service.js"
import { ChatMessageC7 as CHAT_KIND } from "../wrappers/kinds.js"

describe("NipC7Service (NIP-C7)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 33000 + Math.floor(Math.random() * 10000)
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
      Layer.merge(ServiceLayer, NipC7ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("send chat and reply with q tag", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipC7Service
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const now = Math.floor(Date.now() / 1000)
      // Send a base chat
      const res1 = yield* svc.sendChat({ content: "GM", createdAt: now }, sk)
      expect(res1.accepted).toBe(true)

      // Fetch the base chat
      const baseList = yield* svc.listByAuthor({ author, limit: 1, timeoutMs: 800 })
      expect(baseList.length).toBeGreaterThanOrEqual(1)
      const base = baseList[0]!
      expect(base.kind as number).toBe(CHAT_KIND)
      expect(base.content).toBe("GM")

      // Reply quoting the base via q tag
      const relayUrl = `ws://localhost:${port}`
      const res2 = yield* svc.replyChat(
        { parent: base, content: "nostr:nevent1...\nyes", relayUrl, createdAt: now + 2 },
        sk
      )
      expect(res2.accepted).toBe(true)

      // Latest should be the reply
      const list = yield* svc.listByAuthor({ author, limit: 1, timeoutMs: 800 })
      const reply = list[0]!
      expect(reply.kind as number).toBe(CHAT_KIND)
      // q tag present
      const q = reply.tags.find((t) => t[0] === "q")
      expect(q).toBeDefined()
      expect(q![1]).toBe(base.id)
      expect(q![2]).toBe(relayUrl)
      expect(q![3]).toBe(author)

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})

