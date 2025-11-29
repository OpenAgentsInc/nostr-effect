/**
 * Tests for Nip88Service (NIP-88 Polls)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream, Option } from "effect"
import { Nip88Service, Nip88ServiceLive } from "./Nip88Service.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind, Filter, type NostrEvent } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)

describe("Nip88Service (NIP-88)", () => {
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
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(ServiceLayer, Nip88ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("singlechoice poll with dedup latest response per pubkey", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip88Service
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const author = yield* crypto.generatePrivateKey()
      const voter1 = yield* crypto.generatePrivateKey()
      const voter2 = yield* crypto.generatePrivateKey()

      // Publish poll
      const pollRes = yield* svc.publishPoll(
        {
          label: "Pineapple on pizza?",
          polltype: "singlechoice",
          options: [
            { id: "yay", label: "Yay" },
            { id: "nay", label: "Nay" },
          ],
        },
        author
      )
      expect(pollRes.accepted).toBe(true)

      // Fetch the poll event from the relay so we know its ID
      // Quick subscribe: kind 1068, latest by this author
      const sub = yield* relayService.subscribe([
        decodeFilter({ kinds: [decodeKind(1068)], authors: [yield* crypto.getPublicKey(author)], limit: 1 }),
      ])
      const maybePoll = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(400).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      const pollEvent = Option.isSome(maybePoll) ? maybePoll.value : null
      expect(pollEvent?.kind as number).toBe(1068)
      const pollId = pollEvent!.id
      yield* sub.unsubscribe()

      // Voter1 responds twice; latest should win
      const r1 = yield* svc.publishResponse({ pollEventId: pollId, selectedOptionIds: ["yay"] }, voter1)
      expect(r1.accepted).toBe(true)
      // Small delay to ensure created_at difference
      yield* Effect.sleep(50)
      const r1b = yield* svc.publishResponse({ pollEventId: pollId, selectedOptionIds: ["nay"] }, voter1)
      expect(r1b.accepted).toBe(true)

      // Voter2 picks yay
      const r2 = yield* svc.publishResponse({ pollEventId: pollId, selectedOptionIds: ["yay"] }, voter2)
      expect(r2.accepted).toBe(true)

      // List responses and count
      const responses = yield* svc.listResponses({ pollEventId: pollId, limit: 10, timeoutMs: 1000 })
      const result = yield* svc.countResults({ pollEvent: pollEvent!, responses })

      expect((result.counts.get("yay") ?? 0) >= 1).toBe(true)
      expect((result.counts.get("nay") ?? 0) >= 1).toBe(true)
      // Should be exactly 2 votes total (one per pubkey)
      const total = Array.from(result.counts.values()).reduce((a, b) => a + b, 0)
      expect(total).toBe(2)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("multiplechoice poll counts first of each id per pubkey", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip88Service
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const author = yield* crypto.generatePrivateKey()
      const voter = yield* crypto.generatePrivateKey()

      const pollRes = yield* svc.publishPoll(
        {
          label: "Select fruits",
          polltype: "multiplechoice",
          options: [
            { id: "apple", label: "Apple" },
            { id: "banana", label: "Banana" },
          ],
        },
        author
      )
      expect(pollRes.accepted).toBe(true)

      const sub = yield* relayService.subscribe([
        decodeFilter({ kinds: [decodeKind(1068)], authors: [yield* crypto.getPublicKey(author)], limit: 1 }),
      ])
      const maybePoll = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(400).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      const pollEvent = Option.isSome(maybePoll) ? maybePoll.value : null
      expect(pollEvent?.kind as number).toBe(1068)
      const pollId = pollEvent!.id
      yield* sub.unsubscribe()

      // One response with two response tags
      const r = yield* svc.publishResponse({ pollEventId: pollId, selectedOptionIds: ["banana", "banana", "apple"] }, voter)
      expect(r.accepted).toBe(true)

      const responses = yield* svc.listResponses({ pollEventId: pollId, limit: 5, timeoutMs: 800 })
      const result = yield* svc.countResults({ pollEvent: pollEvent!, responses })
      // Both counted once (first occurrence wins) -> apple:1 banana:1
      expect(result.counts.get("banana")).toBe(1)
      expect(result.counts.get("apple")).toBe(1)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
