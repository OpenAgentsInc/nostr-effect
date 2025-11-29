/**
 * NIP-59: Gift Wrap
 *
 * Private event wrapping using NIP-44 encryption.
 *
 * @example
 * ```typescript
 * import { wrapEvent, unwrapEvent, createRumor, createSeal, createWrap } from 'nostr-effect/nip59'
 *
 * // Wrap an event for a recipient
 * const wrapped = wrapEvent(event, senderPrivateKey, recipientPublicKey)
 *
 * // Unwrap a gift-wrapped event
 * const rumor = unwrapEvent(wrapped, recipientPrivateKey)
 * ```
 */

// Re-export all from core implementation
export {
  SEAL_KIND,
  GIFT_WRAP_KIND,
  createRumor,
  createSeal,
  createWrap,
  wrapEvent,
  wrapManyEvents,
  unwrapEvent,
  unwrapManyEvents,
  type UnsignedEvent,
  type Rumor,
  type SealedEvent,
  type GiftWrappedEvent,
} from "../core/Nip59.js"
