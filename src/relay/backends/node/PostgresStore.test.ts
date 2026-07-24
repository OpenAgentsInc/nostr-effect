/**
 * PostgresStore tests.
 *
 * Skips when DATABASE_URL is unset. Against a live Postgres URL, exercises the
 * same EventStore exit criteria as NodeSqliteStore.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { DuplicateEvent } from "../../../core/Errors.js"
import {
  EventKind,
  Filter,
  Tag,
  type NostrEvent,
  type PrivateKey,
} from "../../../core/Schema.js"
import { CryptoService, CryptoServiceLive } from "../../../services/CryptoService.js"
import { EventService, EventServiceLive } from "../../../services/EventService.js"
import { openPostgresStore } from "./PostgresStore.js"

const databaseUrl = process.env["DATABASE_URL"]
const describeIfDb = databaseUrl ? describe : describe.skip

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)
const decodeFilter = Schema.decodeSync(Filter)

const TestLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

const createEvent = async (
  kind: number,
  content: string,
  tags: Tag[] = [],
  privateKey?: PrivateKey
): Promise<{ event: NostrEvent; privateKey: PrivateKey }> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const crypto = yield* CryptoService
      const events = yield* EventService
      const key = privateKey ?? (yield* crypto.generatePrivateKey())
      const event = yield* events.createEvent(
        {
          kind: decodeKind(kind),
          content,
          tags,
        },
        key
      )
      return { event, privateKey: key }
    }).pipe(Effect.provide(TestLayer))
  )

describeIfDb("PostgresStore", () => {
  test("append, duplicate, replaceable, parameterized d-key, tag filters", async () => {
    const handle = await openPostgresStore(databaseUrl!)
    const { store, close } = handle

    try {
      // Isolate: wipe table rows for this proof
      const existing = await Effect.runPromise(store.queryEvents([]))
      for (const event of existing) {
        await Effect.runPromise(store.deleteEvent(event.id))
      }

      const { event } = await createEvent(1, "pg-append")
      expect(await Effect.runPromise(store.storeEvent(event))).toBe(true)
      expect(await Effect.runPromise(store.hasEvent(event.id))).toBe(true)

      const dup = await Effect.runPromise(store.storeEvent(event).pipe(Effect.flip))
      expect(dup).toBeInstanceOf(DuplicateEvent)
      expect(await Effect.runPromise(store.count())).toBe(1)

      const { event: profile1, privateKey } = await createEvent(0, "v1")
      expect((await Effect.runPromise(store.storeReplaceableEvent(profile1))).stored).toBe(true)
      const { event: profile2 } = await createEvent(0, "v2", [], privateKey)
      const replaced = await Effect.runPromise(store.storeReplaceableEvent(profile2))
      if (
        profile2.created_at > profile1.created_at ||
        (profile2.created_at === profile1.created_at && profile2.id < profile1.id)
      ) {
        expect(replaced.stored).toBe(true)
        expect(replaced.replacedId).toBe(profile1.id)
      }
      const older = await Effect.runPromise(store.storeReplaceableEvent(profile1))
      expect(older.stored).toBe(false)

      const { event: alpha1, privateKey: author } = await createEvent(
        30023,
        "a1",
        [decodeTag(["d", "alpha"])]
      )
      const { event: alpha2 } = await createEvent(
        30023,
        "a2",
        [decodeTag(["d", "alpha"])],
        author
      )
      const { event: beta1 } = await createEvent(
        30023,
        "b1",
        [decodeTag(["d", "beta"])],
        author
      )
      await Effect.runPromise(store.storeParameterizedReplaceableEvent(alpha1, "alpha"))
      await Effect.runPromise(store.storeParameterizedReplaceableEvent(beta1, "beta"))
      await Effect.runPromise(store.storeParameterizedReplaceableEvent(alpha2, "alpha"))

      const alpha = await Effect.runPromise(
        store.queryEvents([
          decodeFilter({ kinds: [decodeKind(30023)], "#d": ["alpha"] }),
        ])
      )
      const beta = await Effect.runPromise(
        store.queryEvents([
          decodeFilter({ kinds: [decodeKind(30023)], "#d": ["beta"] }),
        ])
      )
      expect(alpha).toHaveLength(1)
      expect(beta).toHaveLength(1)
      expect(alpha[0]!.id).not.toBe(beta[0]!.id)

      const eId = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      const { event: tagged } = await createEvent(1, "tagged", [decodeTag(["e", eId])])
      await Effect.runPromise(store.storeEvent(tagged))
      const hit = await Effect.runPromise(
        store.queryEvents([decodeFilter({ "#e": [eId] })])
      )
      expect(hit.some((ev) => ev.id === tagged.id)).toBe(true)
    } finally {
      await close()
    }
  })
})

describe("PostgresStore (skip gate)", () => {
  test("skips live cases when DATABASE_URL is unset", () => {
    if (!databaseUrl) {
      expect(true).toBe(true)
    } else {
      expect(databaseUrl.length).toBeGreaterThan(0)
    }
  })
})
