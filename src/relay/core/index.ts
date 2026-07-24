/**
 * Relay Core Module
 *
 * Platform-agnostic relay components.
 * These work unchanged across any JavaScript host.
 */

// Message handling
export {
  MessageHandler,
  MessageHandlerLive,
  MessageHandlerWithRegistry,
  MessageHandlerWithAuth,
  type HandleResult,
  type BroadcastMessage,
} from "./MessageHandler.js"

// Subscription management
export {
  SubscriptionManager,
  SubscriptionManagerLive,
  type Subscription,
} from "./SubscriptionManager.js"

// Connection management
export {
  ConnectionManager,
  ConnectionManagerLive,
  type ConnectionContext,
  type ConnectionOptions,
} from "./ConnectionManager.js"

// Authentication (NIP-42)
export {
  AuthService,
  makeAuthServiceLayer,
  type AuthResult,
} from "./AuthService.js"

// Filter matching
export {
  matchesFilter,
  matchesFilters,
  parseSearchQuery,
  matchesSearch,
  scoreSearchResult,
  rankSearchResults,
} from "./FilterMatcher.js"

// NIP-11 Relay info
export {
  RelayInfo,
  RelayLimitation,
  RelayFees,
  defaultRelayInfo,
  mergeRelayInfo,
  type RetentionSpec,
} from "./RelayInfo.js"

// Relay server contract
export {
  RelayServer,
  type RelayConfig,
  type RelayHandle,
  type ConnectionData,
  type LivekitConfig,
} from "./RelayServer.js"

// Policy module
export * from "./policy/index.js"

// NIP module system
export * from "./nip/index.js"
