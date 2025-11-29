/**
 * NIP-47: Nostr Wallet Connect
 *
 * Protocol for clients to access a remote lightning wallet.
 *
 * @example
 * ```typescript
 * import { parseConnectionString, makeNwcRequestEvent } from 'nostr-effect/nip47'
 *
 * // Parse a NWC connection string
 * const { pubkey, relay, secret } = parseConnectionString(connectionUri)
 *
 * // Create a payment request event
 * const event = makeNwcRequestEvent(pubkey, secretKey, bolt11Invoice)
 * ```
 */

// Re-export all from core implementation
export {
  NWC_INFO_KIND,
  NWC_REQUEST_KIND,
  NWC_RESPONSE_KIND,
  NWC_NOTIFICATION_KIND,
  NWC_NOTIFICATION_LEGACY_KIND,
  NWC_ERROR_CODES,
  NWC_METHODS,
  NWC_NOTIFICATIONS,
  parseConnectionString,
  makeNwcRequestEvent,
  makeNwcRequest,
  type NWCConnection,
  type NWCRequest,
  type NWCResponse,
  type NWCNotification,
} from "../core/Nip47.js"
