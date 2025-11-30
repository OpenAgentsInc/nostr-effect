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
  // Base table
  sql.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      kind INTEGER NOT NULL,
      tags TEXT NOT NULL,
      content TEXT NOT NULL,
      sig TEXT NOT NULL
    )
  `)

  // Backward-compatible migration: add d_tag column if missing
  try {
    const cols = sql.exec<{ name: string }>("PRAGMA table_info(events)").toArray()
    const hasDTag = Array.isArray(cols) && cols.some((c) => (c as any).name === "d_tag")
    if (!hasDTag) {
      sql.exec("ALTER TABLE events ADD COLUMN d_tag TEXT")
    }
  } catch {
    // Ignore PRAGMA/ALTER errors and continue (older runtimes)
    try { sql.exec("ALTER TABLE events ADD COLUMN d_tag TEXT") } catch {}
  }

  // Indexes (safe to create idempotently)
  sql.exec("CREATE INDEX IF NOT EXISTS idx_pubkey ON events(pubkey)")
  sql.exec("CREATE INDEX IF NOT EXISTS idx_kind ON events(kind)")
  sql.exec("CREATE INDEX IF NOT EXISTS idx_created_at ON events(created_at)")
  sql.exec("CREATE INDEX IF NOT EXISTS idx_pubkey_kind ON events(pubkey, kind)")
  // Only create d_tag index if column exists
  try { sql.exec("CREATE INDEX IF NOT EXISTS idx_pubkey_kind_dtag ON events(pubkey, kind, d_tag)") } catch {}
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
        // If no filters, keep bounded
        const appliedFilters = filters.length > 0 ? filters : [{ limit: 100 } as any]

        const seen = new Set<string>()
        const results: NostrEvent[] = []

        for (const f of appliedFilters) {
          const { where, params } = buildWhereClause(f)
          const lim = typeof (f as any).limit === 'number' ? Math.max(1, Math.min((f as any).limit, 1000)) : 100
          const q = `SELECT * FROM events${where ? ' WHERE ' + where : ''} ORDER BY created_at DESC LIMIT ?`
          const rows = sql.exec<EventRow>(q, ...params, lim).toArray()
          for (const row of rows) {
            const ev = rowToEvent(row)
            if (seen.has(ev.id)) continue
            // Verify matches filter in case of string-based tag search edge cases
            if (!filters.length || filters.some((fl) => matchesFilter(ev, fl as any))) {
              seen.add(ev.id)
              results.push(ev)
            }
          }
        }

        return results
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

// =============================================================================
// SQL Builder
// =============================================================================
function buildWhereClause(filter: any): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (Array.isArray(filter.ids) && filter.ids.length > 0) {
    clauses.push(`id IN (${filter.ids.map(() => '?').join(',')})`)
    params.push(...filter.ids)
  }
  if (Array.isArray(filter.authors) && filter.authors.length > 0) {
    clauses.push(`pubkey IN (${filter.authors.map(() => '?').join(',')})`)
    params.push(...filter.authors)
  }
  if (Array.isArray(filter.kinds) && filter.kinds.length > 0) {
    clauses.push(`kind IN (${filter.kinds.map(() => '?').join(',')})`)
    params.push(...filter.kinds)
  }
  if (typeof filter.since === 'number') {
    clauses.push(`created_at >= ?`)
    params.push(filter.since)
  }
  if (typeof filter.until === 'number') {
    clauses.push(`created_at <= ?`)
    params.push(filter.until)
  }
  if (Array.isArray(filter['#d']) && filter['#d'].length > 0) {
    const dvals = filter['#d']
    clauses.push(`d_tag IN (${dvals.map(() => '?').join(',')})`)
    params.push(...dvals)
  }
  const tagClause = (tagKey: string, values: string[]) => {
    const ors: string[] = []
    for (const v of values) {
      ors.push(`instr(tags, ?) > 0`)
      params.push(`"${tagKey}","${v}"`)
    }
    if (ors.length > 0) clauses.push(`(${ors.join(' OR ')})`)
  }
  if (Array.isArray(filter['#e']) && filter['#e'].length > 0) tagClause('e', filter['#e'])
  if (Array.isArray(filter['#p']) && filter['#p'].length > 0) tagClause('p', filter['#p'])

  return { where: clauses.join(' AND '), params }
}
