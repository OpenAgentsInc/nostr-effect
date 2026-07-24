/**
 * Postgres EventStore
 *
 * Production EventStore against Cloud SQL Postgres (or any Postgres URL).
 * Implements the seven EventStore methods with NIP-16 / NIP-33 replaceable
 * semantics and full NIP-01 tag-filter grammar (`#e` `#p` `#a` `#d` and open
 * single-letter `#` tags) via SQL candidates + FilterMatcher.
 */
import { Effect, Layer } from "effect"
import postgres from "postgres"
import { StorageError, DuplicateEvent } from "../../../core/Errors.js"
import type { NostrEvent, EventId, Filter } from "../../../core/Schema.js"
import { EventStore, type ReplaceableStoreResult } from "../../storage/EventStore.js"
import { matchesFilter } from "../../core/FilterMatcher.js"

type Sql = postgres.Sql

type EventRow = {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number | string
  readonly kind: number
  readonly tags: unknown
  readonly content: string
  readonly sig: string
  readonly d_tag: string | null
}

const rowToEvent = (row: EventRow): NostrEvent => {
  const tags =
    typeof row.tags === "string"
      ? (JSON.parse(row.tags) as NostrEvent["tags"])
      : (row.tags as NostrEvent["tags"])
  return {
    id: row.id,
    pubkey: row.pubkey,
    created_at: Number(row.created_at),
    kind: row.kind,
    tags,
    content: row.content,
    sig: row.sig,
  } as NostrEvent
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

const isUniqueViolation = (error: unknown): boolean => {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code?: string }).code === "23505"
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("duplicate key") || message.includes("unique constraint")
}

const isTagFilterKey = (key: string): boolean =>
  key.length === 2 && key.startsWith("#") && /^[a-zA-Z]$/.test(key[1]!)

const tagsJson = (tags: NostrEvent["tags"]): string => JSON.stringify(tags)

/**
 * Load candidate rows. Applies kinds / since / until / `#d` and open `#` tag
 * predicates in SQL when present. ids/authors/search stay in matchesFilter
 * (prefix and NIP-50 rules).
 */
const loadCandidates = async (
  sql: Sql,
  filter: Filter | undefined,
  limit: number
): Promise<Array<EventRow>> => {
  const kinds =
    filter?.kinds && filter.kinds.length > 0 ? (filter.kinds as unknown as number[]) : null
  const since = filter?.since ?? null
  const until = filter?.until ?? null

  const filterRecord = (filter ?? {}) as unknown as Record<string, unknown>
  const dValues =
    Array.isArray(filterRecord["#d"]) && filterRecord["#d"].length > 0
      ? (filterRecord["#d"] as string[])
      : null

  const tagFilters: Array<{ name: string; values: string[] }> = []
  for (const [key, rawValues] of Object.entries(filterRecord)) {
    if (!isTagFilterKey(key) || key === "#d") continue
    if (!Array.isArray(rawValues) || rawValues.length === 0) continue
    tagFilters.push({ name: key[1]!, values: rawValues as string[] })
  }

  // Encode open tag filters as a JSON string so parameter typing stays simple.
  const tagFilterJson =
    tagFilters.length > 0 ? JSON.stringify(tagFilters) : null

  const rows = await sql<Array<EventRow>>`
    SELECT * FROM events e
    WHERE
      (${kinds}::int[] IS NULL OR e.kind = ANY(${kinds}))
      AND (${since}::bigint IS NULL OR e.created_at >= ${since})
      AND (${until}::bigint IS NULL OR e.created_at <= ${until})
      AND (${dValues}::text[] IS NULL OR e.d_tag = ANY(${dValues}))
      AND (
        ${tagFilterJson}::jsonb IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${tagFilterJson}::jsonb) AS req
          WHERE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(e.tags) AS tag
            WHERE tag->>0 = req->>'name'
              AND tag->>1 = ANY(
                SELECT jsonb_array_elements_text(req->'values')
              )
          )
        )
      )
    ORDER BY e.created_at DESC
    LIMIT ${limit}
  `
  return [...rows]
}

const initSchema = async (sql: Sql): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      kind INTEGER NOT NULL,
      tags JSONB NOT NULL,
      content TEXT NOT NULL,
      sig TEXT NOT NULL,
      d_tag TEXT
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey)`
  await sql`CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)`
  await sql`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_events_pubkey_kind ON events(pubkey, kind)`
  await sql`CREATE INDEX IF NOT EXISTS idx_events_pubkey_kind_dtag ON events(pubkey, kind, d_tag)`
  await sql`CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING GIN (tags)`
}

const makePostgresStore = (sql: Sql): EventStore => ({
  _tag: "EventStore",

  storeEvent: (event) =>
    Effect.tryPromise({
      try: async () => {
        await sql`
          INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
          VALUES (
            ${event.id},
            ${event.pubkey},
            ${event.created_at},
            ${event.kind},
            ${tagsJson(event.tags)}::jsonb,
            ${event.content},
            ${event.sig},
            ${null}
          )
        `
        return true
      },
      catch: (error) => {
        if (isUniqueViolation(error)) {
          return new DuplicateEvent({ eventId: event.id })
        }
        return new StorageError({
          message: `Failed to store event: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "insert",
        })
      },
    }),

  storeReplaceableEvent: (event) =>
    Effect.tryPromise({
      try: async (): Promise<ReplaceableStoreResult> =>
        sql.begin(async (tx) => {
          const existingRows = await tx<Array<{ id: string; created_at: number | string }>>`
            SELECT id, created_at FROM events
            WHERE pubkey = ${event.pubkey} AND kind = ${event.kind}
            FOR UPDATE
          `
          const existing = existingRows[0]

          if (existing) {
            if (existing.id === event.id) {
              return { stored: false, reason: "duplicate" as const }
            }

            const existingCreatedAt = Number(existing.created_at)
            if (!shouldReplace(event, existingCreatedAt, existing.id)) {
              return { stored: false, reason: "older" as const }
            }

            await tx`DELETE FROM events WHERE id = ${existing.id}`
            await tx`
              INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
              VALUES (
                ${event.id},
                ${event.pubkey},
                ${event.created_at},
                ${event.kind},
                ${tagsJson(event.tags)}::jsonb,
                ${event.content},
                ${event.sig},
                ${null}
              )
            `
            return { stored: true, replacedId: existing.id as EventId }
          }

          await tx`
            INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
            VALUES (
              ${event.id},
              ${event.pubkey},
              ${event.created_at},
              ${event.kind},
              ${tagsJson(event.tags)}::jsonb,
              ${event.content},
              ${event.sig},
              ${null}
            )
          `
          return { stored: true }
        }),
      catch: (error) =>
        new StorageError({
          message: `Failed to store replaceable event: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "upsert",
        }),
    }),

  storeParameterizedReplaceableEvent: (event, dTagValue) =>
    Effect.tryPromise({
      try: async (): Promise<ReplaceableStoreResult> =>
        sql.begin(async (tx) => {
          const existingRows = await tx<Array<{ id: string; created_at: number | string }>>`
            SELECT id, created_at FROM events
            WHERE pubkey = ${event.pubkey} AND kind = ${event.kind} AND d_tag = ${dTagValue}
            FOR UPDATE
          `
          const existing = existingRows[0]

          if (existing) {
            if (existing.id === event.id) {
              return { stored: false, reason: "duplicate" as const }
            }

            const existingCreatedAt = Number(existing.created_at)
            if (!shouldReplace(event, existingCreatedAt, existing.id)) {
              return { stored: false, reason: "older" as const }
            }

            await tx`DELETE FROM events WHERE id = ${existing.id}`
            await tx`
              INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
              VALUES (
                ${event.id},
                ${event.pubkey},
                ${event.created_at},
                ${event.kind},
                ${tagsJson(event.tags)}::jsonb,
                ${event.content},
                ${event.sig},
                ${dTagValue}
              )
            `
            return { stored: true, replacedId: existing.id as EventId }
          }

          await tx`
            INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
            VALUES (
              ${event.id},
              ${event.pubkey},
              ${event.created_at},
              ${event.kind},
              ${tagsJson(event.tags)}::jsonb,
              ${event.content},
              ${event.sig},
              ${dTagValue}
            )
          `
          return { stored: true }
        }),
      catch: (error) =>
        new StorageError({
          message: `Failed to store parameterized replaceable event: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "upsert",
        }),
    }),

  queryEvents: (filters) =>
    Effect.tryPromise({
      try: async () => {
        if (filters.length === 0) {
          const rows = await loadCandidates(sql, undefined, 1000)
          return rows.map(rowToEvent).filter((event) => !isExpired(event))
        }

        const seen = new Set<string>()
        const results: NostrEvent[] = []

        for (const filter of filters) {
          const lim =
            typeof filter.limit === "number" ? Math.max(1, Math.min(filter.limit, 1000)) : 1000
          const rows = await loadCandidates(sql, filter, lim)
          for (const row of rows) {
            const event = rowToEvent(row)
            if (seen.has(event.id) || isExpired(event)) continue
            if (!matchesFilter(event, filter)) continue
            seen.add(event.id)
            results.push(event)
          }
        }

        const limit = filters[0]?.limit
        if (limit !== undefined) {
          return results.slice(0, limit)
        }
        return results
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
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<Array<{ found: number }>>`
          SELECT 1 AS found FROM events WHERE id = ${id} LIMIT 1
        `
        return rows.length > 0
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
    Effect.tryPromise({
      try: async () => {
        const rows = await sql`
          DELETE FROM events WHERE id = ${id} RETURNING id
        `
        return rows.length > 0
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
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<Array<{ count: number | string }>>`
          SELECT COUNT(*)::int AS count FROM events
        `
        return Number(rows[0]?.count ?? 0)
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

export type PostgresStoreHandle = {
  readonly store: EventStore
  readonly close: () => Promise<void>
}

/**
 * Open a Postgres EventStore against a connection string (Cloud SQL or local).
 */
export const openPostgresStore = async (
  connectionString: string
): Promise<PostgresStoreHandle> => {
  const sql = postgres(connectionString, { max: 10 })
  await initSchema(sql)
  return {
    store: makePostgresStore(sql),
    close: async () => {
      await sql.end({ timeout: 5 })
    },
  }
}

/**
 * Postgres EventStore layer for Cloud SQL / production hosts.
 */
export const PostgresStoreLive = (connectionString: string) =>
  Layer.effect(
    EventStore,
    Effect.tryPromise({
      try: async () => {
        const { store } = await openPostgresStore(connectionString)
        return store
      },
      catch: (error) =>
        new StorageError({
          message: `Failed to initialize Postgres store: ${
            error instanceof Error ? error.message : String(error)
          }`,
          operation: "init",
        }),
    })
  )
