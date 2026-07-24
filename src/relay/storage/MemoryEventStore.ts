/**
 * In-memory EventStore
 *
 * Platform-agnostic Map-backed store for tests and local development.
 * Host-agnostic: no runtime-specific sqlite or server imports.
 */
import { Effect, Layer, Ref } from "effect"
import { DuplicateEvent } from "../../core/Errors.js"
import type { NostrEvent, EventId, Filter } from "../../core/Schema.js"
import { matchesFilter } from "../core/FilterMatcher.js"
import { EventStore, type ReplaceableStoreResult } from "./EventStore.js"

type StoredEvent = {
  readonly event: NostrEvent
  readonly dTag: string | null
}

const isExpired = (event: NostrEvent, nowSeconds: number): boolean => {
  try {
    const tag = event.tags.find((t) => t[0] === "expiration")
    if (!tag || !tag[1]) return false
    const ts = Number(tag[1])
    return Number.isFinite(ts) ? nowSeconds > ts : false
  } catch {
    return false
  }
}

const shouldReplace = (incoming: NostrEvent, existing: NostrEvent): boolean =>
  incoming.created_at > existing.created_at ||
  (incoming.created_at === existing.created_at && incoming.id < existing.id)

const makeMemoryStore = (state: Ref.Ref<Map<string, StoredEvent>>): EventStore => ({
  _tag: "EventStore",

  storeEvent: (event) =>
    Effect.gen(function* () {
      const events = yield* Ref.get(state)
      if (events.has(event.id)) {
        return yield* Effect.fail(new DuplicateEvent({ eventId: event.id }))
      }
      yield* Ref.set(
        state,
        new Map(events).set(event.id, { event, dTag: null })
      )
      return true
    }),

  storeReplaceableEvent: (event) =>
    Ref.modify(state, (events): readonly [ReplaceableStoreResult, Map<string, StoredEvent>] => {
      let existing: StoredEvent | undefined
      for (const stored of events.values()) {
        if (stored.event.pubkey === event.pubkey && stored.event.kind === event.kind) {
          existing = stored
          break
        }
      }

      if (existing) {
        if (existing.event.id === event.id) {
          return [{ stored: false, reason: "duplicate" }, events]
        }
        if (!shouldReplace(event, existing.event)) {
          return [{ stored: false, reason: "older" }, events]
        }
        const next = new Map(events)
        next.delete(existing.event.id)
        next.set(event.id, { event, dTag: null })
        return [
          { stored: true, replacedId: existing.event.id as EventId },
          next,
        ]
      }

      const next = new Map(events)
      next.set(event.id, { event, dTag: null })
      return [{ stored: true }, next]
    }),

  storeParameterizedReplaceableEvent: (event, dTagValue) =>
    Ref.modify(state, (events): readonly [ReplaceableStoreResult, Map<string, StoredEvent>] => {
      let existing: StoredEvent | undefined
      for (const stored of events.values()) {
        if (
          stored.event.pubkey === event.pubkey &&
          stored.event.kind === event.kind &&
          stored.dTag === dTagValue
        ) {
          existing = stored
          break
        }
      }

      if (existing) {
        if (existing.event.id === event.id) {
          return [{ stored: false, reason: "duplicate" }, events]
        }
        if (!shouldReplace(event, existing.event)) {
          return [{ stored: false, reason: "older" }, events]
        }
        const next = new Map(events)
        next.delete(existing.event.id)
        next.set(event.id, { event, dTag: dTagValue })
        return [
          { stored: true, replacedId: existing.event.id as EventId },
          next,
        ]
      }

      const next = new Map(events)
      next.set(event.id, { event, dTag: dTagValue })
      return [{ stored: true }, next]
    }),

  queryEvents: (filters) =>
    Ref.get(state).pipe(
      Effect.map((events) => {
        const nowSeconds = Date.now() / 1000
        const all = [...events.values()]
          .map((stored) => stored.event)
          .sort((a, b) => b.created_at - a.created_at)
          .filter((event) => !isExpired(event, nowSeconds))

        if (filters.length === 0) {
          return all.slice(0, 1000)
        }

        const matched = all.filter((event) =>
          filters.some((filter: Filter) => matchesFilter(event, filter))
        )

        const limit = filters[0]?.limit
        if (limit !== undefined) {
          return matched.slice(0, limit)
        }
        return matched
      })
    ),

  hasEvent: (id) => Ref.get(state).pipe(Effect.map((events) => events.has(id))),

  deleteEvent: (id) =>
    Ref.modify(state, (events) => {
      if (!events.has(id)) {
        return [false, events] as const
      }
      const next = new Map(events)
      next.delete(id)
      return [true, next] as const
    }),

  count: () => Ref.get(state).pipe(Effect.map((events) => events.size)),
})

/**
 * In-memory EventStore layer for testing and host-agnostic local use.
 */
export const MemoryEventStoreLive = Layer.effect(
  EventStore,
  Ref.make(new Map<string, StoredEvent>()).pipe(Effect.map(makeMemoryStore))
)
