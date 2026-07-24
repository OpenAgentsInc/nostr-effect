/**
 * Node Backend
 *
 * Node-specific host for the relay (node:http + ws) plus durable EventStore
 * adapters (node:sqlite for local/dev, Postgres for Cloud SQL).
 * The public `nostr-effect/relay` entry does not import this module.
 * Prefer `nostr-effect/relay/node` when you need a Node 24 host or stores.
 *
 * `startTestRelay` keeps MemoryEventStoreLive for zero-dep local tests.
 * Pass a NodeSqliteStoreLive or PostgresStoreLive layer for durable runs.
 */
import { Effect, Layer } from "effect"
import { CryptoServiceLive } from "../../../services/CryptoService.js"
import { EventServiceLive } from "../../../services/EventService.js"
import { Nip86AdminServiceLive } from "../../core/admin/Nip86AdminService.js"
import {
  MessageHandlerLive,
  MessageHandlerWithAuth,
  MessageHandlerWithRegistry,
} from "../../core/MessageHandler.js"
import { NipRegistryLive } from "../../core/nip/NipRegistry.js"
import { DefaultModules } from "../../core/nip/modules/index.js"
import type { NipModule } from "../../core/nip/NipModule.js"
import type { Nip42Config } from "../../core/nip/modules/Nip42Module.js"
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
import { ConnectionManagerLive } from "../../core/ConnectionManager.js"
import { makeAuthServiceLayer } from "../../core/AuthService.js"
import { MemoryEventStoreLive } from "../../storage/MemoryEventStore.js"
import {
  mintLivekitJwt,
  NodeHostDefaults,
  RelayServerLive,
  type ConnectionData,
  type LivekitConfig,
} from "./NodeServer.js"

export {
  MemoryEventStoreLive,
  RelayServer,
  RelayServerLive,
  mintLivekitJwt,
  NodeHostDefaults,
  type RelayConfig,
  type RelayHandle,
  type ConnectionData,
  type LivekitConfig,
}

// Durable stores are separate entry points so this host barrel stays free of
// `node:sqlite` / `postgres` and can load under bun:test:
//   nostr-effect/relay/node/sqlite
//   nostr-effect/relay/node/postgres

const defaultNip42Config = (port: number): Nip42Config => ({
  relayUrls: [
    `ws://127.0.0.1:${port}`,
    `ws://localhost:${port}`,
  ],
  authRequired: false,
})

/**
 * Full relay layer with in-memory storage (no NIP registry / AUTH)
 * @deprecated Prefer makeMemoryRelayLayerWithNips
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
 * In-memory relay layer with NIP modules, ConnectionManager, and AuthService.
 * Proactive NIP-42 AUTH challenges require AuthService in the host.
 */
export const makeMemoryRelayLayerWithNips = (
  modules: readonly NipModule[] = DefaultModules,
  nip42Config: Nip42Config = { relayUrls: ["ws://127.0.0.1"], authRequired: false }
) => {
  const authLive = makeAuthServiceLayer(nip42Config).pipe(
    Layer.provide(ConnectionManagerLive),
    Layer.provide(EventServiceLive),
    Layer.provide(CryptoServiceLive)
  )

  return RelayServerLive.pipe(
    Layer.provide(MessageHandlerWithAuth),
    Layer.provide(PolicyPipelineFromRegistry),
    Layer.provide(SubscriptionManagerLive),
    Layer.provide(NipRegistryLive(modules)),
    Layer.provide(MemoryEventStoreLive),
    Layer.provide(Nip86AdminServiceLive()),
    Layer.provide(Layer.merge(authLive, ConnectionManagerLive)),
    Layer.provide(EventServiceLive),
    Layer.provide(CryptoServiceLive)
  )
}

/**
 * Default in-memory relay layer with NIP module system
 */
export const MemoryRelayLayerWithNips = makeMemoryRelayLayerWithNips(DefaultModules)

/**
 * Start a Node test relay with in-memory storage and NIP modules.
 */
export const startTestRelay = async (
  port: number,
  modules: readonly NipModule[] = DefaultModules
): Promise<RelayHandle> => {
  const layer = makeMemoryRelayLayerWithNips(modules, defaultNip42Config(port))

  const program = Effect.gen(function* () {
    const server = yield* RelayServer
    return yield* server.start({ port })
  })

  return Effect.runPromise(Effect.provide(program, layer))
}

/**
 * Start a Node relay with in-memory storage (development / local dogfood).
 * For durable local storage, compose RelayServerLive with NodeSqliteStoreLive.
 */
export const startRelay = async (
  config: RelayConfig & { modules?: readonly NipModule[]; nip42?: Nip42Config }
): Promise<RelayHandle> => {
  const modules = config.modules ?? DefaultModules
  const nip42 =
    config.nip42 ??
    defaultNip42Config(config.port)
  const layer = makeMemoryRelayLayerWithNips(modules, nip42)

  const program = Effect.gen(function* () {
    const server = yield* RelayServer
    return yield* server.start(config)
  })

  return Effect.runPromise(Effect.provide(program, layer))
}

/**
 * Layer helper without AuthService (matches Bun MessageHandlerWithRegistry shape).
 * Useful when a caller wants NIP modules but host-local AUTH is unwanted.
 */
export const makeMemoryRelayLayerWithNipsNoAuth = (
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
