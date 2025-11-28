/**
 * Durable Object SQLite EventStore
 *
 * EventStore implementation using Cloudflare Durable Object's built-in SQLite.
 * Uses storage.sql API which is colocated with the DO for low-latency access.
 */
import { Effect, Layer } from "effect"
import { StorageError, DuplicateEvent } from "../../../core/Errors.js"
import type { NostrEvent, EventId } from "../../../core/Schema.js"
import { EventStore, type ReplaceableStoreResult } from "../../storage/EventStore.js"
import { matchesFilter } from "../../core/FilterMatcher.js"

// Cloudflare's SqlStorage type from DurableObjectState
type SqlStorage = {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): SqlStorageCursor<T>
}

type SqlStorageCursor<T> = {
  toArray(): T[]
  one(): T | null
  readonly rowsRead: number
  readonly rowsWritten: number
}

// =============================================================================
// Schema Initialization
// =============================================================================

const initSchema = (sql: SqlStorage): void => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      kind INTEGER NOT NULL,
      tags TEXT NOT NULL,
      content TEXT NOT NULL,
      sig TEXT NOT NULL,
      d_tag TEXT
    )
  `)
  sql.exec("CREATE INDEX IF NOT EXISTS idx_pubkey ON events(pubkey)")
  sql.exec("CREATE INDEX IF NOT EXISTS idx_kind ON events(kind)")
  sql.exec("CREATE INDEX IF NOT EXISTS idx_created_at ON events(created_at)")
  sql.exec("CREATE INDEX IF NOT EXISTS idx_pubkey_kind ON events(pubkey, kind)")
  sql.exec("CREATE INDEX IF NOT EXISTS idx_pubkey_kind_dtag ON events(pubkey, kind, d_tag)")
}

// =============================================================================
// Row Types and Conversion Helpers
// =============================================================================

interface EventRow {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string
  content: string
  sig: string
  d_tag: string | null
}

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

// =============================================================================
// Store Implementation
// =============================================================================

const makeDoSqliteStore = (sql: SqlStorage): EventStore => ({
  _tag: "EventStore",

  storeEvent: (event) =>
    Effect.try({
      try: () => {
        sql.exec(
          `INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          event.id,
          event.pubkey,
          event.created_at,
          event.kind,
          JSON.stringify(event.tags),
          event.content,
          event.sig,
          null
        )
        return true
      },
      catch: (error) => {
        const err = error as Error
        // SQLite UNIQUE constraint violation
        if (err.message.includes("UNIQUE constraint failed")) {
          return new DuplicateEvent({ eventId: event.id })
        }
        return new StorageError({
          message: `Failed to store event: ${err.message}`,
          operation: "insert",
        })
      },
    }),

  storeReplaceableEvent: (event) =>
    Effect.try({
      try: (): ReplaceableStoreResult => {
        // Check for existing event with same pubkey+kind
        const existing = sql
          .exec<{ id: string; created_at: number }>(
            "SELECT id, created_at FROM events WHERE pubkey = ? AND kind = ?",
            event.pubkey,
            event.kind
          )
          .one()

        if (existing) {
          // Same event ID = duplicate
          if (existing.id === event.id) {
            return { stored: false, reason: "duplicate" }
          }

          // Per NIP-16: Keep newer event, or if same timestamp, keep lower ID
          const shouldReplace =
            event.created_at > existing.created_at ||
            (event.created_at === existing.created_at && event.id < existing.id)

          if (!shouldReplace) {
            return { stored: false, reason: "older" }
          }

          // New event wins - replace
          sql.exec("DELETE FROM events WHERE id = ?", existing.id)
          sql.exec(
            `INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            event.id,
            event.pubkey,
            event.created_at,
            event.kind,
            JSON.stringify(event.tags),
            event.content,
            event.sig,
            null
          )

          return { stored: true, replacedId: existing.id as EventId }
        }

        // No existing event - insert new
        sql.exec(
          `INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          event.id,
          event.pubkey,
          event.created_at,
          event.kind,
          JSON.stringify(event.tags),
          event.content,
          event.sig,
          null
        )

        return { stored: true }
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to store replaceable event: ${(error as Error).message}`,
          operation: "upsert",
        }),
    }),

  storeParameterizedReplaceableEvent: (event, dTagValue) =>
    Effect.try({
      try: (): ReplaceableStoreResult => {
        // Check for existing event with same pubkey+kind+d_tag
        const existing = sql
          .exec<{ id: string; created_at: number }>(
            "SELECT id, created_at FROM events WHERE pubkey = ? AND kind = ? AND d_tag = ?",
            event.pubkey,
            event.kind,
            dTagValue
          )
          .one()

        if (existing) {
          // Same event ID = duplicate
          if (existing.id === event.id) {
            return { stored: false, reason: "duplicate" }
          }

          // Per NIP-33: Keep newer event, or if same timestamp, keep lower ID
          const shouldReplace =
            event.created_at > existing.created_at ||
            (event.created_at === existing.created_at && event.id < existing.id)

          if (!shouldReplace) {
            return { stored: false, reason: "older" }
          }

          // New event wins - replace
          sql.exec("DELETE FROM events WHERE id = ?", existing.id)
          sql.exec(
            `INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            event.id,
            event.pubkey,
            event.created_at,
            event.kind,
            JSON.stringify(event.tags),
            event.content,
            event.sig,
            dTagValue
          )

          return { stored: true, replacedId: existing.id as EventId }
        }

        // No existing event - insert new
        sql.exec(
          `INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          event.id,
          event.pubkey,
          event.created_at,
          event.kind,
          JSON.stringify(event.tags),
          event.content,
          event.sig,
          dTagValue
        )

        return { stored: true }
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to store parameterized replaceable event: ${(error as Error).message}`,
          operation: "upsert",
        }),
    }),

  queryEvents: (filters) =>
    Effect.try({
      try: () => {
        // For simplicity, query all events and filter in-memory
        // A production implementation would build SQL WHERE clauses
        const rows = sql
          .exec<EventRow>("SELECT * FROM events ORDER BY created_at DESC")
          .toArray()

        const events = rows.map(rowToEvent)

        // If no filters, return all (up to reasonable limit)
        if (filters.length === 0) {
          return events.slice(0, 1000)
        }

        // OR logic between filters
        const matched = events.filter((event) =>
          filters.some((filter) => matchesFilter(event, filter))
        )

        // Apply limit from first filter if specified
        const limit = filters[0]?.limit
        if (limit !== undefined) {
          return matched.slice(0, limit)
        }

        return matched
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to query events: ${(error as Error).message}`,
          operation: "query",
        }),
    }),

  hasEvent: (id) =>
    Effect.try({
      try: () => {
        const result = sql
          .exec<{ found: number }>("SELECT 1 as found FROM events WHERE id = ?", id)
          .one()
        return result !== null
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to check event: ${(error as Error).message}`,
          operation: "query",
        }),
    }),

  deleteEvent: (id) =>
    Effect.try({
      try: () => {
        const cursor = sql.exec("DELETE FROM events WHERE id = ?", id)
        return cursor.rowsWritten > 0
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to delete event: ${(error as Error).message}`,
          operation: "delete",
        }),
    }),

  count: () =>
    Effect.try({
      try: () => {
        const result = sql.exec<{ count: number }>("SELECT COUNT(*) as count FROM events").one()
        return result?.count ?? 0
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to count events: ${(error as Error).message}`,
          operation: "query",
        }),
    }),
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Create EventStore layer from Durable Object SqlStorage
 * Call initSchema before using the store
 */
export const DoSqliteStoreLive = (sql: SqlStorage) =>
  Layer.succeed(EventStore, makeDoSqliteStore(sql))

/**
 * Initialize the database schema
 * Should be called once in the DO constructor
 */
export const initDoSchema = initSchema

// Export types for use in NostrRelayDO
export type { SqlStorage }
