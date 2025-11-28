/**
 * SubscriptionManager
 *
 * Tracks active subscriptions per WebSocket connection.
 * Provides filter matching for event distribution.
 */
import { Context, Effect, Layer, Ref } from "effect"
import type { NostrEvent, Filter, SubscriptionId } from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

export interface Subscription {
  readonly connectionId: string
  readonly subscriptionId: SubscriptionId
  readonly filters: readonly Filter[]
}

// =============================================================================
// Service Interface
// =============================================================================

export interface SubscriptionManager {
  readonly _tag: "SubscriptionManager"

  /**
   * Register a subscription for a connection
   */
  subscribe(
    connectionId: string,
    subscriptionId: SubscriptionId,
    filters: readonly Filter[]
  ): Effect.Effect<void>

  /**
   * Remove a specific subscription
   */
  unsubscribe(connectionId: string, subscriptionId: SubscriptionId): Effect.Effect<void>

  /**
   * Remove all subscriptions for a connection (on disconnect)
   */
  removeConnection(connectionId: string): Effect.Effect<void>

  /**
   * Get all subscriptions matching an event (for broadcast)
   */
  getMatchingSubscriptions(event: NostrEvent): Effect.Effect<readonly Subscription[]>

  /**
   * Get all subscriptions for a connection
   */
  getSubscriptions(connectionId: string): Effect.Effect<readonly Subscription[]>

  /**
   * Get total subscription count (for metrics)
   */
  count(): Effect.Effect<number>
}

// =============================================================================
// Service Tag
// =============================================================================

export const SubscriptionManager = Context.GenericTag<SubscriptionManager>("SubscriptionManager")

// =============================================================================
// Filter Matching
// =============================================================================

/**
 * Check if an event matches a single filter (AND logic within filter)
 */
const matchesFilter = (event: NostrEvent, filter: Filter): boolean => {
  // ids - prefix match
  if (filter.ids && filter.ids.length > 0) {
    if (!filter.ids.some((id) => event.id.startsWith(id))) return false
  }

  // authors - prefix match
  if (filter.authors && filter.authors.length > 0) {
    if (!filter.authors.some((author) => event.pubkey.startsWith(author))) return false
  }

  // kinds - exact match
  if (filter.kinds && filter.kinds.length > 0) {
    if (!filter.kinds.includes(event.kind)) return false
  }

  // since - created_at >= since
  if (filter.since !== undefined) {
    if (event.created_at < filter.since) return false
  }

  // until - created_at <= until
  if (filter.until !== undefined) {
    if (event.created_at > filter.until) return false
  }

  // Tag filters (#e, #p, #a, #d, #t)
  const tagFilters: Array<[string, readonly string[] | undefined]> = [
    ["e", filter["#e"] as readonly string[] | undefined],
    ["p", filter["#p"] as readonly string[] | undefined],
    ["a", filter["#a"] as readonly string[] | undefined],
    ["d", filter["#d"] as readonly string[] | undefined],
    ["t", filter["#t"] as readonly string[] | undefined],
  ]

  for (const [tagName, tagValues] of tagFilters) {
    if (tagValues && tagValues.length > 0) {
      const eventTagValues = event.tags.filter((tag) => tag[0] === tagName).map((tag) => tag[1])
      if (!tagValues.some((v) => eventTagValues.includes(v))) return false
    }
  }

  return true
}

/**
 * Check if an event matches any filter in the subscription (OR logic between filters)
 */
const matchesSubscription = (event: NostrEvent, subscription: Subscription): boolean => {
  if (subscription.filters.length === 0) return false
  return subscription.filters.some((filter) => matchesFilter(event, filter))
}

// =============================================================================
// In-Memory Implementation
// =============================================================================

type SubscriptionMap = Map<string, Map<SubscriptionId, Subscription>>

const makeSubscriptionManager = (
  subscriptionsRef: Ref.Ref<SubscriptionMap>
): SubscriptionManager => ({
  _tag: "SubscriptionManager",

  subscribe: (connectionId, subscriptionId, filters) =>
    Ref.update(subscriptionsRef, (subs) => {
      const updated = new Map(subs)
      const connSubs = updated.get(connectionId) ?? new Map<SubscriptionId, Subscription>()
      const updatedConnSubs = new Map(connSubs)
      updatedConnSubs.set(subscriptionId, { connectionId, subscriptionId, filters })
      updated.set(connectionId, updatedConnSubs)
      return updated
    }),

  unsubscribe: (connectionId, subscriptionId) =>
    Ref.update(subscriptionsRef, (subs) => {
      const updated = new Map(subs)
      const connSubs = updated.get(connectionId)
      if (connSubs) {
        const updatedConnSubs = new Map(connSubs)
        updatedConnSubs.delete(subscriptionId)
        if (updatedConnSubs.size === 0) {
          updated.delete(connectionId)
        } else {
          updated.set(connectionId, updatedConnSubs)
        }
      }
      return updated
    }),

  removeConnection: (connectionId) =>
    Ref.update(subscriptionsRef, (subs) => {
      const updated = new Map(subs)
      updated.delete(connectionId)
      return updated
    }),

  getMatchingSubscriptions: (event) =>
    Ref.get(subscriptionsRef).pipe(
      Effect.map((subs) => {
        const matching: Subscription[] = []
        for (const connSubs of subs.values()) {
          for (const sub of connSubs.values()) {
            if (matchesSubscription(event, sub)) {
              matching.push(sub)
            }
          }
        }
        return matching
      })
    ),

  getSubscriptions: (connectionId) =>
    Ref.get(subscriptionsRef).pipe(
      Effect.map((subs) => {
        const connSubs = subs.get(connectionId)
        return connSubs ? Array.from(connSubs.values()) : []
      })
    ),

  count: () =>
    Ref.get(subscriptionsRef).pipe(
      Effect.map((subs) => {
        let total = 0
        for (const connSubs of subs.values()) {
          total += connSubs.size
        }
        return total
      })
    ),
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * In-memory SubscriptionManager layer
 */
export const SubscriptionManagerLive = Layer.effect(
  SubscriptionManager,
  Ref.make<SubscriptionMap>(new Map()).pipe(Effect.map(makeSubscriptionManager))
)
