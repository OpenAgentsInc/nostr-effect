/**
 * PostgresStore tests.
 *
 * Postgres is the relay's production store, so this suite is the only thing
 * standing between a storage defect and relay.openagents.com. It needs a live
 * Postgres, which means it needs `DATABASE_URL`.
 *
 * That requirement used to be satisfied by skipping. It is now satisfied by
 * failing: `describeRequiringEnv` runs the suite when `DATABASE_URL` is set,
 * and in CI turns an unset `DATABASE_URL` into a red run instead of an absent
 * one. CI provisions a `postgres:17` service container (matching the Cloud SQL
 * major version behind the relay), so the suite always runs there.
 */
import { expect, test } from "vite-plus/test"
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
import { describeRequiringEnv } from "../../../testing/env-gate.js"
import { openPostgresStore } from "./PostgresStore.js"

const databaseUrl = process.env["DATABASE_URL"]

const describeIfDb = describeRequiringEnv("DATABASE_URL")

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

  /**
   * Production regression (2026-07-25, relay.openagents.com).
   *
   * Every `#p` REQ answered `["NOTICE","error: Handler error: StorageError"]`
   * with no EOSE. The tag predicate passed an ALREADY-stringified JSON value
   * into a `::jsonb` parameter; postgres.js infers the parameter type from the
   * cast and JSON-encodes it a second time, so the query saw a jsonb scalar
   * string instead of an array and Postgres raised SQLSTATE 22023
   * "cannot extract elements from a scalar".
   *
   * `#p` is the addressing tag for NIP-17 / NIP-44 / NIP-59, so this made the
   * entire gift-wrapped private lane unreadable.
   */
  test("#p tag filters resolve gift-wrapped events", async () => {
    const handle = await openPostgresStore(databaseUrl!)
    const { store, close } = handle

    try {
      const existing = await Effect.runPromise(store.queryEvents([]))
      for (const event of existing) {
        await Effect.runPromise(store.deleteEvent(event.id))
      }

      const recipient = "a".repeat(64)
      const other = "b".repeat(64)

      // NIP-59 gift wrap addressed to `recipient`.
      const { event: wrap } = await createEvent(1059, "gift-wrap", [
        decodeTag(["p", recipient]),
      ])
      const { event: otherWrap } = await createEvent(1059, "other-wrap", [
        decodeTag(["p", other]),
      ])
      await Effect.runPromise(store.storeEvent(wrap))
      await Effect.runPromise(store.storeEvent(otherWrap))

      // The exact filter shape Omega sends.
      const mine = await Effect.runPromise(
        store.queryEvents([
          decodeFilter({ kinds: [decodeKind(1059)], "#p": [recipient] }),
        ])
      )
      expect(mine.map((ev) => ev.id)).toEqual([wrap.id])

      // A non-matching #p value must return empty, not error and not everything.
      const none = await Effect.runPromise(
        store.queryEvents([
          decodeFilter({ kinds: [decodeKind(1059)], "#p": ["c".repeat(64)] }),
        ])
      )
      expect(none).toHaveLength(0)

      // Multiple single-letter tag filters AND together within one filter.
      const { event: both } = await createEvent(1, "both-tags", [
        decodeTag(["p", recipient]),
        decodeTag(["t", "omega"]),
      ])
      await Effect.runPromise(store.storeEvent(both))
      const andHit = await Effect.runPromise(
        store.queryEvents([decodeFilter({ "#p": [recipient], "#t": ["omega"] })])
      )
      expect(andHit.map((ev) => ev.id)).toEqual([both.id])
      const andMiss = await Effect.runPromise(
        store.queryEvents([decodeFilter({ "#p": [recipient], "#t": ["nope"] })])
      )
      expect(andMiss).toHaveLength(0)
    } finally {
      await close()
    }
  })

  /**
   * Rows written before the fix hold `tags` as a jsonb scalar string. Fixing
   * the write path alone would leave that corpus permanently unsearchable by
   * tag, so `initSchema` repairs it. This plants the corrupt shape the old
   * code produced and proves a reopen heals it.
   */
  test("startup repairs rows whose tags were stored as a jsonb scalar string", async () => {
    const first = await openPostgresStore(databaseUrl!)
    const recipient = "e".repeat(64)
    let plantedId: string

    try {
      const existing = await Effect.runPromise(first.store.queryEvents([]))
      for (const event of existing) {
        await Effect.runPromise(first.store.deleteEvent(event.id))
      }

      const { event } = await createEvent(1059, "legacy-wrap", [
        decodeTag(["p", recipient]),
      ])
      plantedId = event.id

      // Exactly what the pre-fix write path produced: pre-stringified into
      // ::jsonb, which postgres.js encodes a second time.
      await first.sql`
        INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
        VALUES (${event.id}, ${event.pubkey}, ${event.created_at}, ${event.kind},
                ${JSON.stringify(event.tags)}::jsonb, ${event.content}, ${event.sig}, NULL)
      `
      const planted = await first.sql<Array<{ t: string }>>`
        SELECT jsonb_typeof(tags) AS t FROM events WHERE id = ${event.id}
      `
      expect(planted[0]!.t).toBe("string")

      // The corrupt row is unsearchable by tag.
      const beforeRepair = await Effect.runPromise(
        first.store
          .queryEvents([decodeFilter({ "#p": [recipient] })])
          .pipe(Effect.result)
      )
      expect(beforeRepair._tag).toBe("Failure")
    } finally {
      await first.close()
    }

    // Reopening runs initSchema, which repairs the corpus.
    const second = await openPostgresStore(databaseUrl!)
    try {
      const typed = await second.sql<Array<{ t: string }>>`
        SELECT jsonb_typeof(tags) AS t FROM events WHERE id = ${plantedId!}
      `
      expect(typed[0]!.t).toBe("array")

      const found = await Effect.runPromise(
        second.store.queryEvents([decodeFilter({ "#p": [recipient] })])
      )
      expect(found.map((ev) => ev.id)).toEqual([plantedId!])
      // Tags survived the repair intact.
      expect(found[0]!.tags).toEqual([["p", recipient]])
    } finally {
      await second.close()
    }
  })
})
