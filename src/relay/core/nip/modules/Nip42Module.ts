/**
 * NIP-42 Module
 *
 * Authentication of clients to relays.
 * Handles AUTH message flow and event verification.
 */
import { Effect } from "effect"
import { type NipModule, createModule } from "../NipModule.js"
import { type Policy, Shadow } from "../../policy/Policy.js"
import type { NostrEvent, PublicKey } from "../../../../core/Schema.js"
import { AUTH_EVENT_KIND } from "../../../../core/Schema.js"
import { EventService } from "../../../../services/EventService.js"
import type { CryptoError, InvalidPublicKey } from "../../../../core/Errors.js"

// =============================================================================
// Configuration
// =============================================================================

export interface Nip42Config {
  /**
   * Relay URL(s) to match against auth event's relay tag
   * Supports multiple URLs for relays with different endpoints
   */
  readonly relayUrls: readonly string[]
  /**
   * Maximum age of auth events in seconds (default: 600 = 10 minutes)
   */
  readonly maxAuthAge?: number
  /**
   * Whether auth is required for all connections (default: false)
   * If true, unauthenticated clients will receive auth-required errors
   */
  readonly authRequired?: boolean
}

interface InternalConfig {
  relayUrls: readonly string[]
  maxAuthAge: number
  authRequired: boolean
}

const DEFAULT_CONFIG: Omit<InternalConfig, "relayUrls"> = {
  maxAuthAge: 600, // 10 minutes
  authRequired: false,
}

// =============================================================================
// Auth Event Verification
// =============================================================================

export interface AuthVerificationResult {
  readonly valid: boolean
  readonly pubkey?: PublicKey
  readonly error?: string
}

/**
 * Verify a NIP-42 auth event
 * Checks: kind, created_at, challenge tag, relay tag, signature
 */
export const verifyAuthEvent = (
  event: NostrEvent,
  expectedChallenge: string,
  relayUrls: readonly string[],
  maxAuthAge: number
): Effect.Effect<AuthVerificationResult, CryptoError | InvalidPublicKey, EventService> =>
  Effect.gen(function* () {
    // Check kind
    if (event.kind !== AUTH_EVENT_KIND) {
      return { valid: false, error: `invalid: expected kind ${AUTH_EVENT_KIND}, got ${event.kind}` }
    }

    // Check created_at is within maxAuthAge
    const now = Math.floor(Date.now() / 1000)
    const age = Math.abs(now - event.created_at)
    if (age > maxAuthAge) {
      return { valid: false, error: `invalid: auth event too old (${age}s > ${maxAuthAge}s)` }
    }

    // Find and verify challenge tag
    const challengeTag = event.tags.find((tag) => tag[0] === "challenge")
    if (!challengeTag || challengeTag[1] !== expectedChallenge) {
      return { valid: false, error: "invalid: challenge mismatch" }
    }

    // Find and verify relay tag (URL normalization: just check domain match)
    const relayTag = event.tags.find((tag) => tag[0] === "relay")
    if (!relayTag || !relayTag[1]) {
      return { valid: false, error: "invalid: missing relay tag" }
    }

    const eventRelayUrl = normalizeRelayUrl(relayTag[1])
    const normalizedRelayUrls = relayUrls.map(normalizeRelayUrl)
    if (!normalizedRelayUrls.some((url) => urlsMatch(url, eventRelayUrl))) {
      return { valid: false, error: "invalid: relay URL mismatch" }
    }

    // Verify signature
    const eventService = yield* EventService
    const isValid = yield* eventService.verifyEvent(event)
    if (!isValid) {
      return { valid: false, error: "invalid: signature verification failed" }
    }

    return { valid: true, pubkey: event.pubkey }
  })

/**
 * Normalize relay URL for comparison
 * Removes trailing slashes, converts to lowercase
 */
const normalizeRelayUrl = (url: string): string => {
  try {
    const parsed = new URL(url)
    // Remove trailing slash and convert to lowercase
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase()
  } catch {
    // If URL parsing fails, just lowercase and remove trailing slash
    return url.toLowerCase().replace(/\/$/, "")
  }
}

/**
 * Check if two URLs match (domain match is sufficient per NIP-42)
 */
const urlsMatch = (url1: string, url2: string): boolean => {
  try {
    const parsed1 = new URL(url1)
    const parsed2 = new URL(url2)
    // NIP-42: "For most cases just checking if the domain name is correct should be enough"
    return parsed1.host.toLowerCase() === parsed2.host.toLowerCase()
  } catch {
    // Fallback to exact match if URL parsing fails
    return url1 === url2
  }
}

// =============================================================================
// Policy: Reject AUTH events from being stored
// =============================================================================

/**
 * Policy that shadows kind 22242 events (AUTH events should not be stored)
 * NIP-42: "Relays MUST exclude kind: 22242 events from being broadcasted to any client"
 */
const rejectAuthKind: Policy<never> = (ctx) =>
  Effect.succeed(
    ctx.event.kind === AUTH_EVENT_KIND ? Shadow : { _tag: "Accept" }
  )

// =============================================================================
// Challenge Generation
// =============================================================================

/**
 * Generate a random challenge string
 * Uses crypto.randomUUID() for simplicity
 */
export const generateChallenge = (): string => crypto.randomUUID()

// =============================================================================
// Module
// =============================================================================

/**
 * Create NIP-42 module with configuration
 */
export const createNip42Module = (config: Nip42Config): NipModule => {
  const cfg: InternalConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  }

  return createModule({
    id: "nip-42",
    nips: [42],
    description: "Authentication of clients to relays",
    kinds: [AUTH_EVENT_KIND],
    policies: [rejectAuthKind],
    relayInfo: {
      ...(cfg.authRequired && { limitation: { auth_required: true } }),
    },
    limitations: {
      ...(cfg.authRequired && { auth_required: true }),
    },
  })
}

/**
 * NIP-42 module requires configuration (relay URLs), so no default instance
 * Use createNip42Module(config) to create one
 */
