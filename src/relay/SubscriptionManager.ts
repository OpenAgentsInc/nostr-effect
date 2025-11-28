/**
 * SubscriptionManager
 *
 * Tracks active subscriptions per WebSocket connection.
 * Provides filter matching for event distribution.
 */
import { Context, Effect, Layer, Ref } from "effect"
import type { NostrEvent, Filter, SubscriptionId } from "../core/Schema.js"
import { matchesFilters } from "./FilterMatcher.js"

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

/**
 * Check if an event matches a subscription's filters
 */
const matchesSubscription = (event: NostrEvent, subscription: Subscription): boolean =>
  matchesFilters(event, subscription.filters)

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
