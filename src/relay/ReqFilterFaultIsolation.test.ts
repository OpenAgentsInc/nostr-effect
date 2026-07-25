/**
 * REQ filter fault isolation + unconditional EOSE.
 *
 * Production failure this pins (2026-07-25, relay.openagents.com):
 *
 *   -> ["REQ","probe-c",{"kinds":[1],"limit":2},
 *                       {"kinds":[1059],"#p":["aaaa..."],"limit":5}]
 *   <- ["NOTICE","error: Handler error: StorageError"]
 *   (no EVENT, no EOSE, ever)
 *
 * Three separate defects stacked to produce total read blindness:
 *
 *   1. The Postgres store could not answer ANY single-letter tag filter
 *      (`#p`, `#e`, `#t`), raising StorageError. Covered by
 *      `PostgresStore.test.ts`.
 *   2. That one bad filter poisoned the WHOLE REQ. The healthy sibling
 *      `{"kinds":[1]}` filter returned nothing either, because the store
 *      queried all filters inside one try block and the first throw aborted
 *      the batch. NIP-01 filters are OR'd and independent, so this is a bug
 *      on its own no matter why a filter failed.
 *   3. No EOSE was ever sent. A client blocks on EOSE to end the stored
 *      phase, so the subscription hung forever rather than failing fast.
 *
 * These tests use a store that fails on demand, so they hold regardless of
 * which backend is mounted and without needing a live database.
 */
import { describe, test, expect, afterAll } from "vite-plus/test"
import { Effect, Layer, Schema } from "effect"
import WebSocket from "ws"
import { startRelayWithEventStore, type RelayHandle } from "./backends/node/index.js"
import { EventKind, type NostrEvent, type Filter, type EventId } from "../core/Schema.js"
import { StorageError } from "../core/Errors.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { matchesFilter } from "./core/FilterMatcher.js"

const decodeKind = Schema.decodeSync(EventKind)
const PORT = 7793

const later = <A>(value: () => A): Effect.Effect<A> =>
  Effect.flatMap(
    Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
    () => Effect.sync(value)
  )

const isTagFilterKey = (key: string): boolean =>
  key.length === 2 && key.startsWith("#") && /^[a-zA-Z]$/.test(key[1]!)

/**
 * Store that reproduces the production shape: any filter carrying a
 * single-letter tag key fails the way the broken Postgres tag query did.
 */
const makeTagHostileStore = () => {
  const byId = new Map<string, NostrEvent>()
  const failsOnTagFilter = (filter: Filter): boolean =>
    Object.keys(filter as unknown as Record<string, unknown>).some(isTagFilterKey)

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
      Effect.flatMap(
        Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
        () =>
          filters.some(failsOnTagFilter)
            ? Effect.fail(
                new StorageError({
                  message: "cannot extract elements from a scalar",
                  operation: "query",
                })
              )
            : Effect.succeed(
                [...byId.values()].filter((event) =>
                  filters.some((filter) => matchesFilter(event, filter))
                )
              )
      ),
    hasEvent: (id: EventId) => later(() => byId.has(id)),
    deleteEvent: (id: EventId) => later(() => byId.delete(id)),
    count: () => later(() => byId.size),
  }
}

const ServiceLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

const makeEvent = (content: string): Promise<NostrEvent> =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const crypto = yield* CryptoService
        const events = yield* EventService
        const sk = yield* crypto.generatePrivateKey()
        return yield* events.createEvent({ kind: decodeKind(1), content }, sk)
      }),
      ServiceLayer
    )
  )

/** Send one REQ and collect frames until EOSE, or time out. */
const reqAndCollect = (
  port: number,
  req: unknown[],
  publish?: NostrEvent
): Promise<{ frames: unknown[]; sawEose: boolean }> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const frames: unknown[] = []
    const finish = (sawEose: boolean) => {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      resolve({ frames, sawEose })
    }
    // Deliberately generous: a hung subscription is exactly the defect, so we
    // resolve with sawEose=false rather than throwing, and assert on it.
    const timer = setTimeout(() => finish(false), 6000)

    ws.on("open", () => {
      if (publish) ws.send(JSON.stringify(["EVENT", publish]))
      else ws.send(JSON.stringify(req))
    })
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as unknown[]
      frames.push(msg)
      if (msg[0] === "OK" && publish) ws.send(JSON.stringify(req))
      if (msg[0] === "EOSE") finish(true)
    })
    ws.on("error", reject)
  })

let handle: RelayHandle | undefined
afterAll(async () => {
  if (handle) await handle.stop()
})

describe("REQ filter fault isolation", () => {
  test("a failing filter does not poison sibling filters in the same REQ", async () => {
    handle ??= await startRelayWithEventStore(
      { port: PORT, nip42: { enabled: false } as never },
      makeTagHostileStore() as never
    )
    const event = await makeEvent("healthy sibling must survive")

    const { frames, sawEose } = await reqAndCollect(
      PORT,
      [
        "REQ",
        "mixed",
        { ids: [event.id] },
        { kinds: [1059], "#p": ["a".repeat(64)] },
      ],
      event
    )

    expect(sawEose).toBe(true)

    // Defect 2: the healthy `ids` filter must still deliver its event even
    // though the sibling `#p` filter could not be served.
    const delivered = frames.filter(
      (f) => Array.isArray(f) && f[0] === "EVENT" && f[1] === "mixed"
    ) as Array<[string, string, NostrEvent]>
    expect(delivered.length).toBe(1)
    expect(delivered[0]![2].id).toBe(event.id)

    // The client is told the result set was partial rather than being lied to.
    const notice = frames.find(
      (f) => Array.isArray(f) && f[0] === "NOTICE" && String(f[1]).includes("partial results")
    )
    expect(notice).toBeDefined()
  })

  test("EOSE is sent even when every filter fails", async () => {
    handle ??= await startRelayWithEventStore(
      { port: PORT, nip42: { enabled: false } as never },
      makeTagHostileStore() as never
    )

    const { frames, sawEose } = await reqAndCollect(PORT, [
      "REQ",
      "all-bad",
      { kinds: [1059], "#p": ["b".repeat(64)] },
    ])

    // Defect 3: the stored phase must always terminate. Before the fix this
    // REQ produced a bare NOTICE and the client waited forever.
    expect(sawEose).toBe(true)
    const eose = frames.find((f) => Array.isArray(f) && f[0] === "EOSE") as
      | [string, string, Array<string>?]
      | undefined
    expect(eose?.[1]).toBe("all-bad")
    // Nothing was provably complete, so it must not claim "finish".
    expect(eose?.[2]?.[0]).not.toBe("finish")
  })
})
