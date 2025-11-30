/**
 * NipA0Service tests (lettered spec placeholder)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { NipA0Service, NipA0ServiceLive, VOICE_ROOT_KIND, VOICE_REPLY_KIND } from "./NipA0Service.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { EventKind } from "../core/Schema.js"
import { Schema } from "@effect/schema"

const decodeKind = Schema.decodeSync(EventKind)

let relay: RelayHandle
let port: number

beforeAll(async () => {
  port = 31000 + Math.floor(Math.random() * 10000)
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
    Layer.merge(ServiceLayer, NipA0ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
  )
}

describe("NipA0Service", () => {
  test("publish root voice and query", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipA0Service
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const res = yield* svc.publishRootVoice({
        url: "https://example.com/audio.m4a",
        imeta: { url: "https://example.com/audio.m4a", duration: 8, waveform: [0, 10, 100] },
      }, sk)
      expect(res.accepted).toBe(true)

      const list = yield* svc.listRecentRootVoices({ limit: 1, timeoutMs: 800 })
      expect(list.length).toBeGreaterThanOrEqual(1)
      expect(list[0]?.kind as number).toBe(VOICE_ROOT_KIND)
      expect(list[0]?.content).toBe("https://example.com/audio.m4a")

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("publish reply voice following NIP-22 tags", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipA0Service
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      // Publish a root voice to reply to
      const skRoot = yield* crypto.generatePrivateKey()
      const rootRes = yield* svc.publishRootVoice({ url: "https://example.com/root.m4a" }, skRoot)
      expect(rootRes.accepted).toBe(true)

      // We did not wait for OK id content; publish a dummy event to get an event to reference
      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)
      // Publish a parent text note to reference by e-tag
      const events = yield* EventService
      const ev = yield* events.createEvent({ kind: decodeKind(1), content: "parent", tags: [] }, sk)
      const ok = yield* relaySvc.publish(ev)
      expect(ok.accepted).toBe(true)

      const rep = yield* svc.publishReplyVoice({
        url: "https://example.com/reply.m4a",
        root: { type: "e", value: ev.id },
        parent: { type: "e", value: ev.id },
        rootKind: 1,
        parentKind: 1,
        parentAuthor: { pubkey: author },
      }, sk)
      expect(rep.accepted).toBe(true)

      const replies = yield* svc.listRepliesTo(ev.id, { limit: 1, timeoutMs: 800 })
      expect(replies.length).toBeGreaterThanOrEqual(1)
      expect(replies[0]?.kind as number).toBe(VOICE_REPLY_KIND)
      expect(replies[0]?.tags.some((t) => t[0] === "e" && t[1] === ev.id)).toBe(true)

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
