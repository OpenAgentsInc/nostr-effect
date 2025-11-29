/**
 * NIP-38: User Statuses service tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Option, Stream } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Nip38Service, Nip38ServiceLive } from "./Nip38Service.js"
import { Schema } from "@effect/schema"
import { EventKind, Filter } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)

describe("Nip38Service (NIP-38 User Statuses)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 21000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const Base = Layer.merge(CryptoServiceLive, EventServiceLive.pipe(Layer.provide(CryptoServiceLive)))
    const Service = Nip38ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(Base))
    return Layer.merge(RelayLayer, Layer.merge(Base, Service))
  }

  test("publish and fetch general status (replaceable by d-tag)", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* Nip38Service
      const crypto = yield* CryptoService

      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      // Publish initial status
      const r1 = yield* svc.publishStatus({ type: "general", content: "Working", r: ["https://example"] }, sk)
      expect(r1.accepted).toBe(true)

      // Verify fetch returns the event
      const s1 = yield* svc.getStatus({ author: pk, type: "general" })
      expect(s1?.kind as number).toBe(30315)
      expect(s1?.content).toBe("Working")
      expect(s1?.tags.find((t) => t[0] === "d")?.[1]).toBe("general")
      expect(s1?.tags.find((t) => t[0] === "r")?.[1]).toBe("https://example")

      // Update with the same d-tag (should replace) and different content
      const r2 = yield* svc.publishStatus({ type: "general", content: "Hiking" }, sk)
      expect(r2.accepted).toBe(true)

      const s2 = yield* svc.getStatus({ author: pk, type: "general" })
      expect(s2?.content).toBe("Hiking")

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("music status with expiration tag", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* Nip38Service
      const crypto = yield* CryptoService

      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)
      const exp = Math.floor(Date.now() / 1000) + 3600

      const r = yield* svc.publishStatus({ type: "music", content: "Intergalactic - Beastie Boys", expiration: exp }, sk)
      expect(r.accepted).toBe(true)

      // Fetch manually by REQ to assert expiration tag exists
      const sub = yield* relaySvc.subscribe([
        decodeFilter({ kinds: [decodeKind(30315)], authors: [pk], "#d": ["music"], limit: 1 }),
      ])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(800).pipe(Effect.as(Option.none()))
      )
      yield* sub.unsubscribe()
      expect(Option.isSome(maybe)).toBe(true)
      const ev = Option.isSome(maybe) ? (maybe.value as any) : null
      expect(ev.tags.find((t: string[]) => t[0] === "expiration")?.[1]).toBe(String(exp))

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
