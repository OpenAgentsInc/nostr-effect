/**
 * NodeSqliteStore proof harness.
 *
 * Runs under Node (not Bun): Bun cannot load `node:sqlite`.
 * Invoked by NodeSqliteStore.test.ts via a Node child process.
 *
 * Exit 0 + stdout containing "OK" means all exit criteria passed.
 */
import { Effect, Layer, Schema } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DuplicateEvent } from "../../../core/Errors.js"
import { CryptoService, CryptoServiceLive } from "../../../services/CryptoService.js"
import { EventService, EventServiceLive } from "../../../services/EventService.js"
import {
  EventKind,
  Filter,
  Tag,
  type NostrEvent,
  type PrivateKey,
} from "../../../core/Schema.js"
import { openNodeSqliteStore } from "./NodeSqliteStore.js"

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

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message)
  }
}

const main = async (): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "node-sqlite-store-"))
  const dbPath = join(dir, "events.sqlite")

  try {
    // 1. Durable append survives reopen
    {
      const first = openNodeSqliteStore(dbPath)
      const { event } = await createEvent(1, "durable-append")
      const stored = await Effect.runPromise(first.store.storeEvent(event))
      assert(stored === true, "expected first storeEvent to return true")
      first.close()

      const second = openNodeSqliteStore(dbPath)
      const has = await Effect.runPromise(second.store.hasEvent(event.id))
      assert(has === true, "expected durable append to survive reopen")
      const count = await Effect.runPromise(second.store.count())
      assert(count === 1, `expected count 1 after reopen, got ${count}`)
      second.close()
    }

    // Fresh db for remaining cases
    rmSync(dbPath, { force: true })
    const { store, close } = openNodeSqliteStore(dbPath)

    // 2. Duplicate insert is idempotent (DuplicateEvent, no second row)
    {
      const { event } = await createEvent(1, "dup")
      await Effect.runPromise(store.storeEvent(event))
      const dup = await Effect.runPromise(
        store.storeEvent(event).pipe(Effect.flip)
      )
      assert(dup instanceof DuplicateEvent, "expected DuplicateEvent on duplicate insert")
      const count = await Effect.runPromise(store.count())
      assert(count === 1, `expected idempotent duplicate count 1, got ${count}`)
      await Effect.runPromise(store.deleteEvent(event.id))
    }

    // 3. Replaceable: older rejected; newer wins
    {
      const { event: older, privateKey } = await createEvent(0, "profile-v1")
      const first = await Effect.runPromise(store.storeReplaceableEvent(older))
      assert(first.stored === true, "expected first replaceable store")

      // Same pubkey+kind, older created_at relative to a fabricated newer event
      const { event: newer } = await createEvent(0, "profile-v2", [], privateKey)
      // Force timestamps: store a synthetic older candidate against the stored newer
      // by inserting a third event with an earlier created_at via replaceable API.
      // Create another signed event then reject if its created_at is not greater.
      if (newer.created_at <= older.created_at) {
        // Extremely unlikely same-second race: treat equal-ts lower-id path below.
      }

      const newerResult = await Effect.runPromise(store.storeReplaceableEvent(newer))
      if (newer.created_at > older.created_at || (newer.created_at === older.created_at && newer.id < older.id)) {
        assert(newerResult.stored === true, "expected newer replaceable to store")
        assert(newerResult.replacedId === older.id, "expected older id to be replaced")
      } else {
        assert(newerResult.stored === false, "expected non-winning replaceable to be rejected")
        assert(newerResult.reason === "older", "expected reason older")
      }

      // Explicit older rejection: attempt to re-store the original older event
      const rejectOlder = await Effect.runPromise(store.storeReplaceableEvent(older))
      assert(rejectOlder.stored === false, "expected older replaceable to be rejected")
      assert(rejectOlder.reason === "older" || rejectOlder.reason === "duplicate", "expected older/duplicate reason")

      const rows = await Effect.runPromise(
        store.queryEvents([decodeFilter({ kinds: [decodeKind(0)] })])
      )
      assert(rows.length === 1, `expected one replaceable row, got ${rows.length}`)
      await Effect.runPromise(store.deleteEvent(rows[0]!.id))
    }

    // 4. Parameterized replaceable keys on pubkey+kind+d
    {
      const { event: a1, privateKey } = await createEvent(
        30023,
        "article-a",
        [decodeTag(["d", "alpha"])]
      )
      const { event: a2 } = await createEvent(
        30023,
        "article-a-v2",
        [decodeTag(["d", "alpha"])],
        privateKey
      )
      const { event: b1 } = await createEvent(
        30023,
        "article-b",
        [decodeTag(["d", "beta"])],
        privateKey
      )

      const r1 = await Effect.runPromise(
        store.storeParameterizedReplaceableEvent(a1, "alpha")
      )
      assert(r1.stored === true, "expected alpha v1 stored")

      const rB = await Effect.runPromise(
        store.storeParameterizedReplaceableEvent(b1, "beta")
      )
      assert(rB.stored === true, "expected beta stored independently")

      const r2 = await Effect.runPromise(
        store.storeParameterizedReplaceableEvent(a2, "alpha")
      )
      if (a2.created_at > a1.created_at || (a2.created_at === a1.created_at && a2.id < a1.id)) {
        assert(r2.stored === true, "expected alpha v2 to replace")
        assert(r2.replacedId === a1.id, "expected alpha v1 replaced")
      }

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
      assert(alpha.length === 1, `expected one alpha row, got ${alpha.length}`)
      assert(beta.length === 1, `expected one beta row, got ${beta.length}`)
      assert(alpha[0]!.id !== beta[0]!.id, "alpha and beta must be distinct keys")
      assert(alpha[0]!.content.includes("article-a"), "alpha content should remain alpha-keyed")
    }

    // 5. Tag filter grammar smoke (#e / #p)
    {
      const eId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      const { event } = await createEvent(1, "tagged", [
        decodeTag(["e", eId]),
        decodeTag(["p", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]),
      ])
      await Effect.runPromise(store.storeEvent(event))
      const hit = await Effect.runPromise(
        store.queryEvents([decodeFilter({ "#e": [eId] })])
      )
      assert(hit.some((ev) => ev.id === event.id), "expected #e tag filter hit")
      const miss = await Effect.runPromise(
        store.queryEvents([
          decodeFilter({
            "#e": [
              "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            ],
          }),
        ])
      )
      assert(!miss.some((ev) => ev.id === event.id), "expected #e miss")
    }

    close()
    console.log("OK NodeSqliteStore proof")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error("FAIL", error)
  process.exit(1)
})
