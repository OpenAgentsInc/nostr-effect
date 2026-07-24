/**
 * RelayServer contract
 *
 * Platform-agnostic service tag and types for the NIP-01 relay host.
 * Host implementations live under backends/ (Bun today, Node next).
 */
import { Context, Effect } from "effect"
import type { RelayInfo } from "./RelayInfo.js"

// =============================================================================
// Types
// =============================================================================

export interface LivekitConfig {
  /** LiveKit server WebSocket URL returned to clients */
  readonly url: string
  /** Optional HS256 secret for JWT minting (dev/test). Production should use LiveKit API keys. */
  readonly jwtSecret?: string
  /** Token TTL seconds (default 3600) */
  readonly tokenTtlSeconds?: number
}

export interface RelayConfig {
  readonly port: number
  readonly host?: string
  readonly dbPath?: string
  /** NIP-11 relay info configuration */
  readonly relayInfo?: Partial<RelayInfo>
  /** NIP-29 LiveKit AV chat support */
  readonly livekit?: LivekitConfig
  /**
   * Host connection discipline (Node host; Bun may ignore).
   * Defaults are applied by the Node backend when unset.
   */
  readonly maxConnections?: number
  /** WebSocket ping interval in ms (heartbeat) */
  readonly heartbeatIntervalMs?: number
  /** Consecutive missed pongs before the host terminates the socket */
  readonly heartbeatMissLimit?: number
  /** Close slow consumers when buffered outbound bytes exceed this */
  readonly slowClientBufferedBytes?: number
}

export interface ConnectionData {
  readonly connectionId: string
}

export interface RelayHandle {
  readonly port: number
  readonly stop: () => Effect.Effect<void>
}

// =============================================================================
// Service Interface
// =============================================================================

export interface RelayServer {
  readonly _tag: "RelayServer"

  /**
   * Start the relay server
   */
  start(config: RelayConfig): Effect.Effect<RelayHandle>

  /**
   * Get connection count
   */
  connectionCount(): Effect.Effect<number>
}

// =============================================================================
// Service Tag
// =============================================================================

export const RelayServer = Context.Service<RelayServer>("RelayServer")
