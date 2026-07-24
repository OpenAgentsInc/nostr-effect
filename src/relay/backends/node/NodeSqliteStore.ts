/**
 * Node SQLite EventStore
 *
 * Development / non-production EventStore on Node's experimental `node:sqlite`.
 * Production durable storage is PostgresStore (Cloud SQL). Do not deploy this
 * store as the live relay backend.
 */
import { Effect, Layer } from "effect"
import { DatabaseSync } from "node:sqlite"
import { StorageError, DuplicateEvent } from "../../../core/Errors.js"
import type { NostrEvent, EventId } from "../../../core/Schema.js"
import { EventStore, type ReplaceableStoreResult } from "../../storage/EventStore.js"
import { matchesFilter } from "../../core/FilterMatcher.js"

// =============================================================================
// Schema Initialization
// =============================================================================

const initSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      kind INTEGER NOT NULL,
      tags TEXT NOT NULL,
      content TEXT NOT NULL,
      sig TEXT NOT NULL,
      d_tag TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pubkey ON events(pubkey);
    CREATE INDEX IF NOT EXISTS idx_kind ON events(kind);
    CREATE INDEX IF NOT EXISTS idx_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_pubkey_kind ON events(pubkey, kind);
    CREATE INDEX IF NOT EXISTS idx_pubkey_kind_dtag ON events(pubkey, kind, d_tag);
  `)
  db.exec("PRAGMA journal_mode=WAL")
}

// =============================================================================
// Row Conversion Helpers
// =============================================================================

type EventRow = {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: string
  readonly content: string
  readonly sig: string
}

const eventParams = (event: NostrEvent, dTagValue?: string): Array<string | number | null> => [
  event.id,
  event.pubkey,
  event.created_at,
  event.kind,
  JSON.stringify(event.tags),
  event.content,
  event.sig,
  dTagValue ?? null,
]

const rowToEvent = (row: EventRow): NostrEvent =>
  ({
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    tags: JSON.parse(row.tags),
    content: row.content,
    sig: row.sig,
  }) as NostrEvent

const isUniqueConstraintError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("UNIQUE constraint failed")
}

const shouldReplace = (incoming: NostrEvent, existingCreatedAt: number, existingId: string): boolean =>
  incoming.created_at > existingCreatedAt ||
  (incoming.created_at === existingCreatedAt && incoming.id < existingId)

const isExpired = (event: NostrEvent): boolean => {
  try {
    const tag = event.tags.find((t) => t[0] === "expiration")
    if (!tag || !tag[1]) return false
    const ts = Number(tag[1])
    return Number.isFinite(ts) ? Date.now() / 1000 > ts : false
  } catch {
    return false
  }
}

const INSERT_SQL = `
  INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`

// =============================================================================
// Store Implementation
// =============================================================================

const makeNodeSqliteStore = (db: DatabaseSync): EventStore => ({
  _tag: "EventStore",

  storeEvent: (event) =>
    Effect.try({
      try: () => {
        db.prepare(INSERT_SQL).run(...eventParams(event))
        return true
      },
      catch: (error) => {
        if (isUniqueConstraintError(error)) {
          return new DuplicateEvent({ eventId: event.id })
        }
        return new StorageError({
          message: `Failed to store event: ${error instanceof Error ? error.message : String(error)}`,
          operation: "insert",
        })
      },
    }),

  storeReplaceableEvent: (event) =>
    Effect.try({
      try: (): ReplaceableStoreResult => {
        const existing = db
          .prepare("SELECT id, created_at FROM events WHERE pubkey = ? AND kind = ?")
          .get(event.pubkey, event.kind) as { id: string; created_at: number } | undefined

        if (existing) {
          if (existing.id === event.id) {
            return { stored: false, reason: "duplicate" }
          }

          if (!shouldReplace(event, existing.created_at, existing.id)) {
            return { stored: false, reason: "older" }
          }

          db.prepare("DELETE FROM events WHERE id = ?").run(existing.id)
          db.prepare(INSERT_SQL).run(...eventParams(event))
          return { stored: true, replacedId: existing.id as EventId }
        }

        db.prepare(INSERT_SQL).run(...eventParams(event))
        return { stored: true }
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to store replaceable event: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "upsert",
        }),
    }),

  storeParameterizedReplaceableEvent: (event, dTagValue) =>
    Effect.try({
      try: (): ReplaceableStoreResult => {
        const existing = db
          .prepare(
            "SELECT id, created_at FROM events WHERE pubkey = ? AND kind = ? AND d_tag = ?"
          )
          .get(event.pubkey, event.kind, dTagValue) as
          | { id: string; created_at: number }
          | undefined

        if (existing) {
          if (existing.id === event.id) {
            return { stored: false, reason: "duplicate" }
          }

          if (!shouldReplace(event, existing.created_at, existing.id)) {
            return { stored: false, reason: "older" }
          }

          db.prepare("DELETE FROM events WHERE id = ?").run(existing.id)
          db.prepare(INSERT_SQL).run(...eventParams(event, dTagValue))
          return { stored: true, replacedId: existing.id as EventId }
        }

        db.prepare(INSERT_SQL).run(...eventParams(event, dTagValue))
        return { stored: true }
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to store parameterized replaceable event: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "upsert",
        }),
    }),

  queryEvents: (filters) =>
    Effect.try({
      try: () => {
        const rows = db.prepare("SELECT * FROM events ORDER BY created_at DESC").all() as Array<
          EventRow
        >
        const events = rows.map(rowToEvent).filter((event) => !isExpired(event))

        if (filters.length === 0) {
          return events.slice(0, 1000)
        }

        const matched = events.filter((event) =>
          filters.some((filter) => matchesFilter(event, filter))
        )

        const limit = filters[0]?.limit
        if (limit !== undefined) {
          return matched.slice(0, limit)
        }
        return matched
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to query events: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "query",
        }),
    }),

  hasEvent: (id) =>
    Effect.try({
      try: () => {
        const row = db.prepare("SELECT 1 AS found FROM events WHERE id = ?").get(id)
        return row != null
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to check event: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "query",
        }),
    }),

  deleteEvent: (id) =>
    Effect.try({
      try: () => {
        const result = db.prepare("DELETE FROM events WHERE id = ?").run(id)
        return result.changes > 0
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to delete event: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "delete",
        }),
    }),

  count: () =>
    Effect.try({
      try: () => {
        const row = db.prepare("SELECT COUNT(*) AS count FROM events").get() as {
          count: number
        }
        return row.count
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to count events: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "query",
        }),
    }),
})

// =============================================================================
// Service Layers
// =============================================================================

/**
 * Node SQLite EventStore layer for local development and non-production proofs.
 * Database is not automatically closed — call `closeNodeSqliteStore` when done.
 */
export const NodeSqliteStoreLive = (dbPath: string) =>
  Layer.effect(
    EventStore,
    Effect.try({
      try: () => {
        const db = new DatabaseSync(dbPath)
        initSchema(db)
        return makeNodeSqliteStore(db)
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to initialize Node SQLite: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "init",
        }),
    })
  )

/**
 * Open a Node SQLite EventStore and return both the store and a close handle.
 * Prefer this in scripts and proofs that need durable reopen checks.
 */
export const openNodeSqliteStore = (
  dbPath: string
): { readonly store: EventStore; readonly close: () => void } => {
  const db = new DatabaseSync(dbPath)
  initSchema(db)
  return {
    store: makeNodeSqliteStore(db),
    close: () => db.close(),
  }
}
