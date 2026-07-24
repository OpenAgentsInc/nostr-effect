/**
 * NIP-67 EOSE completeness hints (finish / more)
 */
import { test, expect, describe, beforeAll, afterAll } from "vite-plus/test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "./backends/node/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Schema } from "effect"
import { EventKind, type NostrEvent } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)

const openWs = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error("ws open failed"))
  })

const waitFor = (ws: WebSocket, pred: (msg: unknown[]) => boolean): Promise<unknown[]> =>
  new Promise((resolve) => {
    const handler = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as unknown[]
      if (pred(msg)) {
        ws.removeEventListener("message", handler)
        resolve(msg)
      }
    }
    ws.addEventListener("message", handler)
  })

describe("NIP-67 EOSE hints", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 32000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const cryptoLayer = Layer.merge(
    CryptoServiceLive,
    EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
  )

  test("EOSE includes finish when all matching stored events were sent", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const crypto = yield* CryptoService
        const events = yield* EventService
        const sk = yield* crypto.generatePrivateKey()
        const note = yield* events.createEvent(
          { kind: decodeKind(1), content: "hello eose finish", tags: [] },
          sk
        )

        yield* Effect.tryPromise({
          try: async () => {
            const ws = await openWs(port)
            const okP = waitFor(ws, (m) => m[0] === "OK" && m[1] === note.id)
            ws.send(JSON.stringify(["EVENT", note]))
            const ok = await okP
            expect(ok[2]).toBe(true)

            const eoseP = waitFor(ws, (m) => m[0] === "EOSE" && m[1] === "sub-finish")
            ws.send(
              JSON.stringify([
                "REQ",
                "sub-finish",
                { ids: [note.id], limit: 10 },
              ])
            )
            const eose = await eoseP
            expect(eose[0]).toBe("EOSE")
            expect(eose[1]).toBe("sub-finish")
            expect(eose[2]).toEqual(["finish"])
            ws.close()
          },
          catch: (e) => e as Error,
        })
      }).pipe(Effect.provide(cryptoLayer))
    )
  })

  test("EOSE includes more when limit truncates results", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const crypto = yield* CryptoService
        const events = yield* EventService
        const sk = yield* crypto.generatePrivateKey()
        const author = yield* crypto.getPublicKey(sk)
        const notes: NostrEvent[] = []
        for (let i = 0; i < 3; i++) {
          notes.push(
            yield* events.createEvent(
              { kind: decodeKind(1), content: `note more ${i}`, tags: [] },
              sk
            )
          )
        }

        yield* Effect.tryPromise({
          try: async () => {
            const ws = await openWs(port)
            for (const note of notes) {
              const okP = waitFor(ws, (m) => m[0] === "OK" && m[1] === note.id)
              ws.send(JSON.stringify(["EVENT", note]))
              const ok = await okP
              expect(ok[2]).toBe(true)
            }

            const eoseP = waitFor(ws, (m) => m[0] === "EOSE" && m[1] === "sub-more")
            ws.send(
              JSON.stringify([
                "REQ",
                "sub-more",
                { kinds: [1], authors: [author], limit: 1 },
              ])
            )
            const eose = await eoseP
            expect(eose[0]).toBe("EOSE")
            expect(eose[1]).toBe("sub-more")
            expect(eose[2]).toEqual(["more"])
            ws.close()
          },
          catch: (e) => e as Error,
        })
      }).pipe(Effect.provide(cryptoLayer))
    )
  })
})
