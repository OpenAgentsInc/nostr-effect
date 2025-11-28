/**
 * Relay Core Module
 *
 * Platform-agnostic relay components.
 * These work unchanged across Bun, Cloudflare Workers, Node.js, etc.
 */

// Message handling
export {
  MessageHandler,
  MessageHandlerLive,
  type HandleResult,
  type BroadcastMessage,
} from "./MessageHandler.js"

// Subscription management
export {
  SubscriptionManager,
  SubscriptionManagerLive,
  type Subscription,
} from "./SubscriptionManager.js"

// Filter matching
export { matchesFilter, matchesFilters } from "./FilterMatcher.js"

// NIP-11 Relay info
export {
  RelayInfo,
  RelayLimitation,
  RelayFees,
  defaultRelayInfo,
  mergeRelayInfo,
  type RetentionSpec,
} from "./RelayInfo.js"

// Policy module
export * from "./policy/index.js"
