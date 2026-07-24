/**
 * Bun Backend
 *
 * Bun-specific host and SQLite store for the relay.
 * The public `nostr-effect/relay` entry does not import this module.
 * Prefer `nostr-effect/relay/bun` when you need Bun.serve.
 */
import { Effect, Layer } from "effect"
import { CryptoServiceLive } from "../../../services/CryptoService.js"
import { EventServiceLive } from "../../../services/EventService.js"
import { Nip86AdminServiceLive } from "../../core/admin/Nip86AdminService.js"
import {
  MessageHandlerLive,
  MessageHandlerWithRegistry,
} from "../../core/MessageHandler.js"
import { NipRegistryLive } from "../../core/nip/NipRegistry.js"
import { DefaultModules } from "../../core/nip/modules/index.js"
import type { NipModule } from "../../core/nip/NipModule.js"
import {
  PolicyPipelineFromRegistry,
  PolicyPipelineLive,
} from "../../core/policy/index.js"
import {
  RelayServer,
  type RelayConfig,
  type RelayHandle,
} from "../../core/RelayServer.js"
import { SubscriptionManagerLive } from "../../core/SubscriptionManager.js"
import { MemoryEventStoreLive } from "../../storage/MemoryEventStore.js"
import { BunSqliteStoreLive, SqliteEventStoreLive } from "./BunSqliteStore.js"
import {
  mintLivekitJwt,
  RelayServerLive,
  type ConnectionData,
  type LivekitConfig,
} from "./BunServer.js"

export {
  BunSqliteStoreLive,
  SqliteEventStoreLive,
  MemoryEventStoreLive,
  RelayServer,
  RelayServerLive,
  mintLivekitJwt,
  type RelayConfig,
  type RelayHandle,
  type ConnectionData,
  type LivekitConfig,
}

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

/**
 * Create relay layer with NIP module system
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

/**
 * Start a relay server with Bun.serve and SQLite storage.
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

  return Effect.runPromise(Effect.provide(program, layer))
}

/**
 * Start a Bun test relay with in-memory storage and NIP modules.
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

  return Effect.runPromise(Effect.provide(program, layer))
}
