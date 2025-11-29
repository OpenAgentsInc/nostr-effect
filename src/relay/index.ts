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
  MessageHandlerWithRegistry,
  SubscriptionManagerLive,
  PolicyPipelineLive,
  PolicyPipelineFromRegistry,
} from "./core/index.js"
import { NipRegistryLive } from "./core/nip/NipRegistry.js"
import { DefaultModules } from "./core/nip/modules/index.js"
import type { NipModule } from "./core/nip/NipModule.js"
import { EventServiceLive } from "../services/EventService.js"
import { CryptoServiceLive } from "../services/CryptoService.js"
import { Nip86AdminServiceLive } from "./core/admin/Nip86AdminService.js"

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

// NIP module system
export * from "./core/nip/index.js"

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
 * @deprecated Use makeRelayLayerWithNips for full NIP module support
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
 * @deprecated Use MemoryRelayLayerWithNips for full NIP module support
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
// NIP-enabled Relay Layers (recommended)
// =============================================================================

/**
 * Create relay layer with NIP module system
 * Uses NipRegistry for policies and event treatment hooks
 *
 * @param dbPath - Path to SQLite database
 * @param modules - NIP modules to load (defaults to DefaultModules)
 */
export const makeRelayLayerWithNips = (
  dbPath: string,
  modules: readonly NipModule[] = DefaultModules
) =>
  RelayServerLive.pipe(
    Layer.provide(MessageHandlerWithRegistry),
    Layer.provide(PolicyPipelineFromRegistry),
    Layer.provide(SubscriptionManagerLive),
    Layer.provide(NipRegistryLive(modules)),
    Layer.provide(BunSqliteStoreLive(dbPath)),
    Layer.provide(Nip86AdminServiceLive()),
    Layer.provide(EventServiceLive),
    Layer.provide(CryptoServiceLive)
  )

/**
 * In-memory relay layer with NIP module system (for testing)
 *
 * @param modules - NIP modules to load (defaults to DefaultModules)
 */
export const makeMemoryRelayLayerWithNips = (
  modules: readonly NipModule[] = DefaultModules
) =>
  RelayServerLive.pipe(
    Layer.provide(MessageHandlerWithRegistry),
    Layer.provide(PolicyPipelineFromRegistry),
    Layer.provide(SubscriptionManagerLive),
    Layer.provide(NipRegistryLive(modules)),
    Layer.provide(MemoryEventStoreLive),
    Layer.provide(Nip86AdminServiceLive()),
    Layer.provide(EventServiceLive),
    Layer.provide(CryptoServiceLive)
  )

/**
 * Default in-memory relay layer with NIP module system
 */
export const MemoryRelayLayerWithNips = makeMemoryRelayLayerWithNips(DefaultModules)

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Start a relay server with default configuration
 * Uses NIP module system for full NIP support
 *
 * @example
 * ```ts
 * const handle = await startRelay({ port: 8080 })
 * console.log(`Relay running on ws://localhost:${handle.port}`)
 * ```
 */
export const startRelay = async (
  config: RelayConfig & { dbPath?: string; modules?: readonly NipModule[] }
): Promise<RelayHandle> => {
  const dbPath = config.dbPath ?? ":memory:"
  const modules = config.modules ?? DefaultModules
  const layer = makeRelayLayerWithNips(dbPath, modules)

  const program = Effect.gen(function* () {
    const server = yield* RelayServer
    return yield* server.start(config)
  })

  const runnable = Effect.provide(program, layer)
  return Effect.runPromise(runnable)
}

/**
 * Start a relay server for testing (in-memory storage with NIP module system)
 */
export const startTestRelay = async (
  port: number,
  modules: readonly NipModule[] = DefaultModules
): Promise<RelayHandle> => {
  const layer = makeMemoryRelayLayerWithNips(modules)

  const program = Effect.gen(function* () {
    const server = yield* RelayServer
    return yield* server.start({ port })
  })

  const runnable = Effect.provide(program, layer)
  return Effect.runPromise(runnable)
}
