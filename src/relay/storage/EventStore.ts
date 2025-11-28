/**
 * EventStore Interface
 *
 * Platform-agnostic event storage interface.
 * Implementations provided by backend modules (bun, cloudflare, etc.)
 */
import { Context, Effect } from "effect"
import { StorageError, DuplicateEvent } from "../../core/Errors.js"
import type { NostrEvent, Filter, EventId } from "../../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

/** Result of storing a replaceable event */
export interface ReplaceableStoreResult {
  /** Whether the event was stored (new or replaced older) */
  readonly stored: boolean
  /** The ID of the event that was replaced, if any */
  readonly replacedId?: EventId
  /** If not stored, the reason why */
  readonly reason?: "older" | "duplicate"
}

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
   * Store a replaceable event (NIP-16).
   * Replaces existing event with same pubkey+kind if newer.
   */
  storeReplaceableEvent(event: NostrEvent): Effect.Effect<ReplaceableStoreResult, StorageError>

  /**
   * Store a parameterized replaceable event (NIP-33).
   * Replaces existing event with same pubkey+kind+d-tag if newer.
   */
  storeParameterizedReplaceableEvent(
    event: NostrEvent,
    dTagValue: string
  ): Effect.Effect<ReplaceableStoreResult, StorageError>

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
