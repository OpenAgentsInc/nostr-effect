/**
 * AuthService
 *
 * NIP-42 authentication service that integrates with ConnectionManager.
 * Handles challenge generation, storage, and auth event verification.
 */
import { Context, Effect, Layer } from "effect"
import { ConnectionManager } from "./ConnectionManager.js"
import { EventService } from "../../services/EventService.js"
import { verifyAuthEvent, generateChallenge, type Nip42Config } from "./nip/modules/Nip42Module.js"
import type { NostrEvent, PublicKey, RelayMessage } from "../../core/Schema.js"
import type { CryptoError, InvalidPublicKey } from "../../core/Errors.js"

// =============================================================================
// Types
// =============================================================================

export interface AuthResult {
  readonly success: boolean
  readonly pubkey?: PublicKey
  readonly message: string
}

// =============================================================================
// Service Interface
// =============================================================================

export interface AuthService {
  readonly _tag: "AuthService"

  /**
   * Get or create a challenge for a connection
   * If a challenge already exists, returns it; otherwise creates a new one
   */
  getChallenge(connectionId: string): Effect.Effect<string>

  /**
   * Create a new challenge for a connection (replacing any existing one)
   */
  createChallenge(connectionId: string): Effect.Effect<string>

  /**
   * Handle an AUTH message from a client
   * Verifies the auth event and updates connection state if valid
   */
  handleAuth(
    connectionId: string,
    authEvent: NostrEvent
  ): Effect.Effect<AuthResult, CryptoError | InvalidPublicKey>

  /**
   * Check if a connection is authenticated
   */
  isAuthenticated(connectionId: string): Effect.Effect<boolean>

  /**
   * Get the authenticated pubkey for a connection (if any)
   */
  getAuthPubkey(connectionId: string): Effect.Effect<PublicKey | undefined>

  /**
   * Build an AUTH challenge message to send to the client
   */
  buildAuthMessage(challenge: string): RelayMessage
}

// =============================================================================
// Service Tag
// =============================================================================

export const AuthService = Context.GenericTag<AuthService>("AuthService")

// =============================================================================
// Service Implementation
// =============================================================================

const make = (config: Nip42Config) =>
  Effect.gen(function* () {
    const connectionManager = yield* ConnectionManager
    const eventService = yield* EventService

    const getChallenge: AuthService["getChallenge"] = (connectionId) =>
      Effect.gen(function* () {
        const conn = yield* connectionManager.get(connectionId)
        if (conn?.challenge) {
          return conn.challenge
        }
        // Create a new challenge
        const challenge = generateChallenge()
        yield* connectionManager.setChallenge(connectionId, challenge)
        return challenge
      })

    const createChallenge: AuthService["createChallenge"] = (connectionId) =>
      Effect.gen(function* () {
        const challenge = generateChallenge()
        yield* connectionManager.setChallenge(connectionId, challenge)
        return challenge
      })

    const handleAuth: AuthService["handleAuth"] = (connectionId, authEvent) =>
      Effect.gen(function* () {
        // Get the connection's challenge
        const conn = yield* connectionManager.get(connectionId)
        if (!conn) {
          return {
            success: false,
            message: "error: connection not found",
          }
        }

        if (!conn.challenge) {
          return {
            success: false,
            message: "error: no challenge issued for this connection",
          }
        }

        // Verify the auth event
        const result = yield* verifyAuthEvent(
          authEvent,
          conn.challenge,
          config.relayUrls,
          config.maxAuthAge ?? 600
        ).pipe(Effect.provideService(EventService, eventService))

        if (!result.valid) {
          return {
            success: false,
            message: result.error ?? "auth-required: invalid auth event",
          }
        }

        // Set the authenticated pubkey on the connection
        const pubkey = result.pubkey!
        yield* connectionManager.setAuthPubkey(connectionId, pubkey)

        return {
          success: true,
          pubkey,
          message: "",
        }
      })

    const isAuthenticated: AuthService["isAuthenticated"] = (connectionId) =>
      connectionManager.isAuthenticated(connectionId)

    const getAuthPubkey: AuthService["getAuthPubkey"] = (connectionId) =>
      Effect.gen(function* () {
        const conn = yield* connectionManager.get(connectionId)
        return conn?.authPubkey
      })

    const buildAuthMessage: AuthService["buildAuthMessage"] = (challenge) =>
      ["AUTH", challenge] as RelayMessage

    return {
      _tag: "AuthService" as const,
      getChallenge,
      createChallenge,
      handleAuth,
      isAuthenticated,
      getAuthPubkey,
      buildAuthMessage,
    }
  })

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Create AuthService layer with NIP-42 configuration
 */
export const makeAuthServiceLayer = (config: Nip42Config) =>
  Layer.effect(AuthService, make(config))
