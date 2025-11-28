/**
 * EventStore
 *
 * Event storage interface with SQLite implementation.
 * Designed for pluggability - other backends can implement the interface.
 */
import { Context, Effect, Layer } from "effect"
import { Database } from "bun:sqlite"
import { StorageError, DuplicateEvent } from "../core/Errors.js"
import type { NostrEvent, Filter, EventId } from "../core/Schema.js"
import { matchesFilter } from "./FilterMatcher.js"

// =============================================================================
// Service Interface
// =============================================================================

export interface EventStore {
  readonly _tag: "EventStore"

  /**
   * Store an event. Returns true if new, false if duplicate.
   */
  storeEvent(event: NostrEvent): Effect.Effect<boolean, StorageError | DuplicateEvent>

  /**
   * Query events matching filters (OR logic between filters, AND within filter)
   */
  queryEvents(filters: readonly Filter[]): Effect.Effect<readonly NostrEvent[], StorageError>

  /**
   * Check if event exists by ID
   */
  hasEvent(id: EventId): Effect.Effect<boolean, StorageError>

  /**
   * Delete event by ID (for testing/admin)
   */
  deleteEvent(id: EventId): Effect.Effect<boolean, StorageError>

  /**
   * Get event count
   */
  count(): Effect.Effect<number, StorageError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const EventStore = Context.GenericTag<EventStore>("EventStore")

// =============================================================================
// SQLite Implementation
// =============================================================================

const initSchema = (db: Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      kind INTEGER NOT NULL,
      tags TEXT NOT NULL,
      content TEXT NOT NULL,
      sig TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pubkey ON events(pubkey);
    CREATE INDEX IF NOT EXISTS idx_kind ON events(kind);
    CREATE INDEX IF NOT EXISTS idx_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_pubkey_kind ON events(pubkey, kind);
  `)
  // Enable WAL mode for better concurrent performance
  db.exec("PRAGMA journal_mode=WAL")
}

const eventToRow = (event: NostrEvent) => ({
  $id: event.id,
  $pubkey: event.pubkey,
  $created_at: event.created_at,
  $kind: event.kind,
  $tags: JSON.stringify(event.tags),
  $content: event.content,
  $sig: event.sig,
})

const rowToEvent = (row: {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string
  content: string
  sig: string
}): NostrEvent =>
  ({
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    tags: JSON.parse(row.tags),
    content: row.content,
    sig: row.sig,
  }) as NostrEvent

const makeSqliteStore = (db: Database): EventStore => ({
  _tag: "EventStore",

  storeEvent: (event) =>
    Effect.try({
      try: () => {
        const stmt = db.prepare(`
          INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig)
          VALUES ($id, $pubkey, $created_at, $kind, $tags, $content, $sig)
        `)
        stmt.run(eventToRow(event))
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

  queryEvents: (filters) =>
    Effect.try({
      try: () => {
        // For simplicity, query all events and filter in-memory
        // A production implementation would build SQL WHERE clauses
        const stmt = db.prepare("SELECT * FROM events ORDER BY created_at DESC")
        const rows = stmt.all() as Array<{
          id: string
          pubkey: string
          created_at: number
          kind: number
          tags: string
          content: string
          sig: string
        }>

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
        const stmt = db.prepare("SELECT 1 FROM events WHERE id = ?")
        const row = stmt.get(id)
        return row != null
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
        const stmt = db.prepare("DELETE FROM events WHERE id = ?")
        const result = stmt.run(id)
        return result.changes > 0
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
        const stmt = db.prepare("SELECT COUNT(*) as count FROM events")
        const row = stmt.get() as { count: number }
        return row.count
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to count events: ${(error as Error).message}`,
          operation: "query",
        }),
    }),
})

// =============================================================================
// Service Layers
// =============================================================================

/**
 * SQLite EventStore layer - creates database at given path
 * Note: Database is not automatically closed - call db.close() when done
 */
export const SqliteEventStoreLive = (dbPath: string) =>
  Layer.effect(
    EventStore,
    Effect.try({
      try: () => {
        const db = new Database(dbPath)
        initSchema(db)
        return makeSqliteStore(db)
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to initialize SQLite: ${(error as Error).message}`,
          operation: "init",
        }),
    })
  )

/**
 * In-memory SQLite for testing
 */
export const MemoryEventStoreLive = SqliteEventStoreLive(":memory:")
