/**
 * Nostr Relay Module
 *
 * Effect-based NIP-01 relay implementation.
 * Default backend uses Bun (bun:sqlite + Bun.serve).
 *
 * @example
 * ```ts
 * import { startRelay } from "nostr-effect/relay"
 *
 * const handle = await startRelay({ port: 8080, dbPath: "./relay.db" })
 * console.log(`Relay running on port ${handle.port}`)
 *
 * // Later...
 * await handle.stop()
 * ```
 */
import { Effect, Layer } from "effect"

// Import from new structure
import {
  BunSqliteStoreLive,
  MemoryEventStoreLive,
  RelayServer,
  RelayServerLive,
  type RelayConfig,
  type RelayHandle,
} from "./backends/bun/index.js"
import {
  MessageHandlerLive,
  SubscriptionManagerLive,
  PolicyPipelineLive,
} from "./core/index.js"
import { EventServiceLive } from "../services/EventService.js"
import { CryptoServiceLive } from "../services/CryptoService.js"

// =============================================================================
// Re-exports - Storage
// =============================================================================

export { EventStore, type ReplaceableStoreResult } from "./storage/EventStore.js"

// =============================================================================
// Re-exports - Core (platform-agnostic)
// =============================================================================

export {
  MessageHandler,
  MessageHandlerLive,
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

// =============================================================================
// Re-exports - Bun Backend (default)
// =============================================================================

export {
  BunSqliteStoreLive,
  MemoryEventStoreLive,
  SqliteEventStoreLive, // Legacy alias
  RelayServer,
  RelayServerLive,
  type RelayConfig,
  type RelayHandle,
  type ConnectionData,
} from "./backends/bun/index.js"

// =============================================================================
// Full Relay Layer
// =============================================================================

/**
 * Create full relay layer stack with SQLite storage
 */
export const makeRelayLayer = (dbPath: string) =>
  RelayServerLive.pipe(
    Layer.provide(MessageHandlerLive),
    Layer.provide(PolicyPipelineLive),
    Layer.provide(SubscriptionManagerLive),
    Layer.provide(BunSqliteStoreLive(dbPath)),
    Layer.provide(EventServiceLive),
    Layer.provide(CryptoServiceLive)
  )

/**
 * Full relay layer with in-memory storage (for testing)
 */
export const MemoryRelayLayer = RelayServerLive.pipe(
  Layer.provide(MessageHandlerLive),
  Layer.provide(PolicyPipelineLive),
  Layer.provide(SubscriptionManagerLive),
  Layer.provide(MemoryEventStoreLive),
  Layer.provide(EventServiceLive),
  Layer.provide(CryptoServiceLive)
)

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Start a relay server with default configuration
 *
 * @example
 * ```ts
 * const handle = await startRelay({ port: 8080 })
 * console.log(`Relay running on ws://localhost:${handle.port}`)
 * ```
 */
export const startRelay = async (
  config: RelayConfig & { dbPath?: string }
): Promise<RelayHandle> => {
  const dbPath = config.dbPath ?? ":memory:"
  const layer = makeRelayLayer(dbPath)

  const program = Effect.gen(function* () {
    const server = yield* RelayServer
    return yield* server.start(config)
  })

  const runnable = Effect.provide(program, layer)
  return Effect.runPromise(runnable)
}

/**
 * Start a relay server for testing (in-memory storage)
 */
export const startTestRelay = async (port: number): Promise<RelayHandle> => {
  const program = Effect.gen(function* () {
    const server = yield* RelayServer
    return yield* server.start({ port })
  })

  const runnable = Effect.provide(program, MemoryRelayLayer)
  return Effect.runPromise(runnable)
}
