/**
 * NIP-77 Negentropy full (IdList) test
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "./index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "@effect/schema"
import { EventKind } from "../core/Schema.js"
import { encodeIdListMessage, decodeIdListMessage } from "./core/negentropy/Codec.js"

const decodeKind = Schema.decodeSync(EventKind)

const ServiceLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

describe("NIP-77 Negentropy (IdList)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 24000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  test("server returns missing IDs given client IdList", async () => {
    // Publish two events (kind 1)
    const ev1 = await Effect.runPromise(
      Effect.gen(function* () {
        const crypto = yield* CryptoService
        const events = yield* EventService
        const sk = yield* crypto.generatePrivateKey()
        return yield* events.createEvent({ kind: decodeKind(1), content: "a", tags: [] }, sk)
      }).pipe(Effect.provide(ServiceLayer))
    )
    const ev2 = await Effect.runPromise(
      Effect.gen(function* () {
        const crypto = yield* CryptoService
        const events = yield* EventService
        const sk = yield* crypto.generatePrivateKey()
        return yield* events.createEvent({ kind: decodeKind(1), content: "b", tags: [] }, sk)
      }).pipe(Effect.provide(ServiceLayer))
    )

    // Publish via WebSocket
    const ws = new WebSocket(`ws://localhost:${port}/`)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = (e) => reject(e)
    })
    ws.send(JSON.stringify(["EVENT", ev1]))
    await new Promise((r) => (ws.onmessage = () => r(null)))
    ws.send(JSON.stringify(["EVENT", ev2]))
    await new Promise((r) => (ws.onmessage = () => r(null)))

    // Client owns ev1 only; wants to reconcile kind 1
    const clientIds = [ev1.id]
    const initialHex = encodeIdListMessage(clientIds)
    const subId = "neg2"
    const filter = { kinds: [1] }

    const recv = async (): Promise<any[]> =>
      new Promise<any[]>((resolve) => {
        ws.onmessage = (ev) => resolve(JSON.parse(String(ev.data)))
      })

    ws.send(JSON.stringify(["NEG-OPEN", subId, filter, initialHex]))
    const msg1 = await recv()
    expect(msg1[0]).toBe("NEG-MSG")
    const diff1 = decodeIdListMessage(msg1[2]).ids
    expect(diff1).toContain(ev2.id)

    // Tell server we now have both ids; expect empty diff
    const nextHex = encodeIdListMessage([ev1.id, ev2.id])
    ws.send(JSON.stringify(["NEG-MSG", subId, nextHex]))
    const msg2 = await recv()
    const diff2 = decodeIdListMessage(msg2[2]).ids
    expect(diff2.length).toBe(0)

    ws.send(JSON.stringify(["NEG-CLOSE", subId]))
    ws.close()
  })
})
