/**
 * NIP-17: Private Direct Messages
 *
 * Private direct messages using NIP-59 gift wrap.
 *
 * @example
 * ```typescript
 * import { wrapEvent, unwrapEvent } from 'nostr-effect/nip17'
 *
 * // Send a private DM
 * const wrapped = wrapEvent(senderPrivateKey, { publicKey: recipientPubkey }, 'Hello!')
 *
 * // Unwrap a received DM
 * const rumor = unwrapEvent(wrapped, recipientPrivateKey)
 * ```
 */

// Re-export all from core implementation
export {
  PRIVATE_DIRECT_MESSAGE_KIND,
  wrapEvent,
  wrapManyEvents,
  unwrapEvent,
  unwrapManyEvents,
  type Recipient,
  type ReplyTo,
  type GiftWrappedEvent,
  type Rumor,
} from "../core/Nip17.js"
