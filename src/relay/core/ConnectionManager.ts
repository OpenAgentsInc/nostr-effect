/**
 * ConnectionManager
 *
 * Tracks per-connection state for WebSocket connections.
 * Used for authentication (NIP-42), rate limiting, and connection metadata.
 */
import { Context, Effect, Layer, Ref } from "effect"
import type { PublicKey } from "../../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

/**
 * Per-connection state
 */
export interface ConnectionContext {
  /** Unique connection identifier */
  readonly id: string
  /** Remote client IP address (if available) */
  readonly remoteAddress?: string
  /** When the connection was established */
  readonly connectedAt: Date
  /** NIP-42: Authenticated pubkey (set after successful AUTH) */
  readonly authPubkey?: PublicKey
  /** NIP-42: Challenge string sent to client */
  readonly challenge?: string
}

/**
 * Options for creating a new connection
 */
export interface ConnectionOptions {
  readonly id: string
  readonly remoteAddress?: string
}

// =============================================================================
// Service Interface
// =============================================================================

export interface ConnectionManager {
  readonly _tag: "ConnectionManager"

  /**
   * Register a new connection
   */
  connect(options: ConnectionOptions): Effect.Effect<ConnectionContext>

  /**
   * Remove a connection (on disconnect)
   */
  disconnect(connectionId: string): Effect.Effect<void>

  /**
   * Get connection context by ID
   */
  get(connectionId: string): Effect.Effect<ConnectionContext | undefined>

  /**
   * Update connection context (e.g., after AUTH)
   */
  update(
    connectionId: string,
    updater: (ctx: ConnectionContext) => ConnectionContext
  ): Effect.Effect<ConnectionContext | undefined>

  /**
   * Set NIP-42 challenge for a connection
   */
  setChallenge(connectionId: string, challenge: string): Effect.Effect<void>

  /**
   * Set authenticated pubkey after successful NIP-42 AUTH
   */
  setAuthPubkey(connectionId: string, pubkey: PublicKey): Effect.Effect<void>

  /**
   * Check if a connection is authenticated
   */
  isAuthenticated(connectionId: string): Effect.Effect<boolean>

  /**
   * Get all active connections
   */
  getAll(): Effect.Effect<readonly ConnectionContext[]>

  /**
   * Get connection count (for metrics)
   */
  count(): Effect.Effect<number>
}

// =============================================================================
// Service Tag
// =============================================================================

export const ConnectionManager = Context.GenericTag<ConnectionManager>("ConnectionManager")

// =============================================================================
// In-Memory Implementation
// =============================================================================

type ConnectionMap = Map<string, ConnectionContext>

const makeConnectionManager = (
  connectionsRef: Ref.Ref<ConnectionMap>
): ConnectionManager => ({
  _tag: "ConnectionManager",

  connect: (options) =>
    Ref.modify(connectionsRef, (conns) => {
      const ctx: ConnectionContext = {
        id: options.id,
        connectedAt: new Date(),
        ...(options.remoteAddress !== undefined && { remoteAddress: options.remoteAddress }),
      }
      const updated = new Map(conns)
      updated.set(options.id, ctx)
      return [ctx, updated]
    }),

  disconnect: (connectionId) =>
    Ref.update(connectionsRef, (conns) => {
      const updated = new Map(conns)
      updated.delete(connectionId)
      return updated
    }),

  get: (connectionId) =>
    Ref.get(connectionsRef).pipe(Effect.map((conns) => conns.get(connectionId))),

  update: (connectionId, updater) =>
    Ref.modify(connectionsRef, (conns) => {
      const existing = conns.get(connectionId)
      if (!existing) {
        return [undefined, conns]
      }
      const updated = new Map(conns)
      const newCtx = updater(existing)
      updated.set(connectionId, newCtx)
      return [newCtx, updated]
    }),

  setChallenge: (connectionId, challenge) =>
    Ref.update(connectionsRef, (conns) => {
      const existing = conns.get(connectionId)
      if (!existing) return conns
      const updated = new Map(conns)
      updated.set(connectionId, { ...existing, challenge })
      return updated
    }),

  setAuthPubkey: (connectionId, pubkey) =>
    Ref.update(connectionsRef, (conns) => {
      const existing = conns.get(connectionId)
      if (!existing) return conns
      const updated = new Map(conns)
      updated.set(connectionId, { ...existing, authPubkey: pubkey })
      return updated
    }),

  isAuthenticated: (connectionId) =>
    Ref.get(connectionsRef).pipe(
      Effect.map((conns) => {
        const ctx = conns.get(connectionId)
        return ctx?.authPubkey !== undefined
      })
    ),

  getAll: () =>
    Ref.get(connectionsRef).pipe(Effect.map((conns) => Array.from(conns.values()))),

  count: () => Ref.get(connectionsRef).pipe(Effect.map((conns) => conns.size)),
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * In-memory ConnectionManager layer
 */
export const ConnectionManagerLive = Layer.effect(
  ConnectionManager,
  Ref.make<ConnectionMap>(new Map()).pipe(Effect.map(makeConnectionManager))
)
