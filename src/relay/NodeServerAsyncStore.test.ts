/**
 * Node host regression: the message loop must tolerate an ASYNCHRONOUS EventStore.
 *
 * Production failure this pins (2026-07-25, relay.openagents.com):
 *
 *   AsyncFiberError: An asynchronous Effect was executed with Effect.runSync
 *     at WebSocket.<anonymous> (dist-relay/main.mjs)
 *   Container called exit(1).
 *
 * The host handled inbound frames with `Effect.runSync`. Every synchronous path
 * worked, so NIP-11, the WSS handshake, and NIP-42 auth all looked healthy, and
 * the in-memory store used by local tests is synchronous too. The Cloud SQL
 * store is not: the first EVENT publish raised AsyncFiberError out of the `ws`
 * emitter and killed the process, and the client saw only a 1006 close with no
 * OK and no NOTICE.
 *
 * A memory-store test cannot catch that. This suite forces the store to be
 * genuinely asynchronous, which is what a real database backend always is.
 */
import { describe, test, expect, afterAll } from "vite-plus/test"
import { Effect, Schema } from "effect"
import WebSocket from "ws"
import { startRelayWithEventStore, type RelayHandle } from "./backends/node/index.js"
import { EventKind, type NostrEvent, type Filter, type EventId } from "../core/Schema.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Layer } from "effect"
import { matchesFilter } from "./core/FilterMatcher.js"

const decodeKind = Schema.decodeSync(EventKind)
const PORT = 7791

/** Resolve on a later tick, so every store call is genuinely asynchronous. */
const later = <A>(value: () => A): Effect.Effect<A> =>
  Effect.flatMap(
    Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
    () => Effect.sync(value)
  )

/**
 * Minimal asynchronous EventStore. A real database backend is always async, so
 * this is the shape the host must tolerate.
 */
const makeAsyncStore = () => {
  const byId = new Map<string, NostrEvent>()
  return {
    _tag: "EventStore" as const,
    storeEvent: (event: NostrEvent) =>
      later(() => {
        const isNew = !byId.has(event.id)
        byId.set(event.id, event)
        return isNew
      }),
    storeReplaceableEvent: (event: NostrEvent) =>
      later(() => {
        byId.set(event.id, event)
        return { stored: true }
      }),
    storeParameterizedReplaceableEvent: (event: NostrEvent) =>
      later(() => {
        byId.set(event.id, event)
        return { stored: true }
      }),
    queryEvents: (filters: readonly Filter[]) =>
      later(() =>
        [...byId.values()].filter((event) =>
          filters.some((filter) => matchesFilter(event, filter))
        )
      ),
    hasEvent: (id: EventId) => later(() => byId.has(id)),
    deleteEvent: (id: EventId) => later(() => byId.delete(id)),
    count: () => later(() => byId.size),
  }
}

let handle: RelayHandle | undefined
afterAll(async () => {
  if (handle) await handle.stop()
})

describe("Node host with an asynchronous EventStore", () => {
  test("publishes and reads back without killing the connection", async () => {
    handle = await startRelayWithEventStore(
      { port: PORT, nip42: { enabled: false } as never },
      makeAsyncStore() as never
    )

    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    const event = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const events = yield* EventService
          const sk = yield* crypto.generatePrivateKey()
          return yield* events.createEvent(
            { kind: decodeKind(1), content: "async store proof" },
            sk
          )
        }),
        ServiceLayer
      )
    )

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const frames: unknown[] = []
    const closed = { code: 0 }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 10000)
      ws.on("open", () => ws.send(JSON.stringify(["EVENT", event])))
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as unknown[]
        frames.push(msg)
        if (msg[0] === "OK") {
          ws.send(JSON.stringify(["REQ", "sub", { ids: [(event as NostrEvent).id] }]))
        }
        if (msg[0] === "EOSE") {
          clearTimeout(timer)
          resolve()
        }
      })
      ws.on("close", (code) => {
        closed.code = code
      })
      ws.on("error", reject)
    })

    ws.close()

    // The process is still alive and the socket was never abnormally closed.
    expect(closed.code).not.toBe(1006)

    const ok = frames.find((f) => Array.isArray(f) && f[0] === "OK") as
      | [string, string, boolean, string]
      | undefined
    expect(ok).toBeDefined()
    expect(ok?.[2]).toBe(true)

    const returned = frames.find(
      (f) => Array.isArray(f) && f[0] === "EVENT"
    ) as [string, string, NostrEvent] | undefined
    expect(returned?.[2]?.id).toBe((event as NostrEvent).id)
  })
})
