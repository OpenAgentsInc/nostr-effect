/**
 * Bun Backend
 *
 * Bun-specific implementations for the relay.
 * Uses bun:sqlite for storage and Bun.serve for WebSocket server.
 */

// Storage
export {
  BunSqliteStoreLive,
  MemoryEventStoreLive,
  SqliteEventStoreLive, // Legacy alias
} from "./BunSqliteStore.js"

// Server
export {
  RelayServer,
  RelayServerLive,
  type RelayConfig,
  type RelayHandle,
  type ConnectionData,
} from "./BunServer.js"
