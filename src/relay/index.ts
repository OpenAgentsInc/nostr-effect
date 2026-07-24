/**
 * Nostr Relay Module
 *
 * Effect-based NIP-01 relay implementation.
 * This entry point is host-agnostic: no Bun or Cloudflare imports.
 *
 * For a running Node host use `nostr-effect/relay/node`.
 *
 * @example
 * ```ts
 * import { MemoryEventStoreLive, RelayServer } from "nostr-effect/relay"
 * ```
 */

// =============================================================================
// Re-exports - Storage
// =============================================================================

export { EventStore, type ReplaceableStoreResult } from "./storage/EventStore.js"
export { MemoryEventStoreLive } from "./storage/MemoryEventStore.js"

// =============================================================================
// Re-exports - Core (platform-agnostic)
// =============================================================================

export {
  RelayServer,
  type RelayConfig,
  type RelayHandle,
  type ConnectionData,
  type LivekitConfig,
} from "./core/RelayServer.js"

export {
  MessageHandler,
  MessageHandlerLive,
  MessageHandlerWithRegistry,
  type HandleResult,
  type BroadcastMessage,
} from "./core/MessageHandler.js"

export {
  SubscriptionManager,
  SubscriptionManagerLive,
  type Subscription,
} from "./core/SubscriptionManager.js"

export { matchesFilter, matchesFilters } from "./core/FilterMatcher.js"

export {
  RelayInfo,
  RelayLimitation,
  RelayFees,
  defaultRelayInfo,
  mergeRelayInfo,
  type RetentionSpec,
} from "./core/RelayInfo.js"

// Policy module
export * from "./core/policy/index.js"

// NIP module system
export * from "./core/nip/index.js"
