/**
 * NIP-77 Client Negentropy tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Option, Stream } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind, Filter } from "../core/Schema.js"
import { makeRelayService, RelayService } from "./RelayService.js"
import { Nip77Service, Nip77ServiceLive } from "./Nip77Service.js"
import { decodeIdListMessage } from "../relay/core/negentropy/Codec.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)

const ServiceLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

describe("Nip77Service (client)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 26000 + Math.floor(Math.random() * 10000)
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

    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        Nip77ServiceLive.pipe(
          Layer.provide(RelayLayer)
        )
      )
    )
  }

  test("reconcile returns server-only ids (IdList)", async () => {
    // Publish two events (kind 1)
    const [ev1, ev2] = await Promise.all([
      Effect.runPromise(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const sk = yield* crypto.generatePrivateKey()
          return yield* events.createEvent({ kind: decodeKind(1), content: "a", tags: [] }, sk)
        }).pipe(Effect.provide(ServiceLayer))
      ),
      Effect.runPromise(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const sk = yield* crypto.generatePrivateKey()
          return yield* events.createEvent({ kind: decodeKind(1), content: "b", tags: [] }, sk)
        }).pipe(Effect.provide(ServiceLayer))
      ),
    ])

    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const nip77 = yield* Nip77Service
      yield* relaySvc.connect()

      // Publish both events so the relay can compute diffs
      const ok1 = yield* relaySvc.publish(ev1)
      const ok2 = yield* relaySvc.publish(ev2)
      expect(ok1.accepted).toBe(true)
      expect(ok2.accepted).toBe(true)

      // Client has only ev1; reconcile against kind 1
      const res = yield* nip77.reconcile(decodeFilter({ kinds: [decodeKind(1)] }), [ev1.id])
      expect(res.missingOnClient).toContain(ev2.id)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("open session and read first diff", async () => {
    // Publish two events (kind 1)
    const [ev1, ev2] = await Promise.all([
      Effect.runPromise(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const sk = yield* crypto.generatePrivateKey()
          return yield* events.createEvent({ kind: decodeKind(1), content: "x", tags: [] }, sk)
        }).pipe(Effect.provide(ServiceLayer))
      ),
      Effect.runPromise(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const sk = yield* crypto.generatePrivateKey()
          return yield* events.createEvent({ kind: decodeKind(1), content: "y", tags: [] }, sk)
        }).pipe(Effect.provide(ServiceLayer))
      ),
    ])

    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const nip77 = yield* Nip77Service
      yield* relaySvc.connect()

      // Publish both events
      const ok1 = yield* relaySvc.publish(ev1)
      const ok2 = yield* relaySvc.publish(ev2)
      expect(ok1.accepted).toBe(true)
      expect(ok2.accepted).toBe(true)

      // Open with only ev1
      const sess = yield* nip77.open(decodeFilter({ kinds: [decodeKind(1)] }), [ev1.id], "neg-cli-1")
      const first = yield* Effect.race(
        sess.messages.pipe(Stream.runHead),
        Effect.sleep(800).pipe(Effect.as(Option.none<string>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<string>())))
      const diff1Hex = Option.isSome(first) ? first.value : ""
      const diff1 = decodeIdListMessage(diff1Hex).ids
      expect(diff1).toContain(ev2.id)

      // Close session
      yield* sess.close()

      yield* sess.close()
      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
