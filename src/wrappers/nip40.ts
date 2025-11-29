/**
 * NIP-40: Expiration Timestamp
 *
 * Handle event expiration timestamps.
 *
 * @example
 * ```typescript
 * import { getExpiration, isEventExpired, onExpire } from 'nostr-effect/nip40'
 *
 * // Check if event is expired
 * if (isEventExpired(event)) {
 *   console.log('Event has expired')
 * }
 *
 * // Get expiration date
 * const expiration = getExpiration(event)
 * if (expiration) {
 *   console.log('Expires at:', expiration)
 * }
 *
 * // React when event expires
 * onExpire(event, (e) => console.log('Event expired!'))
 * ```
 */

// Re-export all from core implementation
export {
  getExpiration,
  isEventExpired,
  waitForExpire,
  onExpire,
  createExpirationTag,
  hasExpiration,
} from "../core/Nip40.js"
