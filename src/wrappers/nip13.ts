/**
 * NIP-13: Proof of Work
 *
 * Mining and verification of Proof of Work for Nostr events.
 *
 * @example
 * ```typescript
 * import { getPow, minePow, verifyPow, fastEventHash } from 'nostr-effect/nip13'
 *
 * // Get POW difficulty from event ID
 * const difficulty = getPow(eventId)
 *
 * // Mine an event with target difficulty
 * const minedEvent = minePow(unsignedEvent, 20)
 *
 * // Verify POW meets minimum
 * const valid = verifyPow(eventId, 16)
 * ```
 */

// Re-export all from core implementation
export {
  getPow,
  minePow,
  fastEventHash,
  verifyPow,
  getClaimedDifficulty,
  type UnsignedEvent,
  type MinedEvent,
} from "../core/Nip13.js"
