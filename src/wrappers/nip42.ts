/**
 * NIP-42: Authentication of clients to relays
 *
 * Create auth events for client authentication to relays.
 *
 * @example
 * ```typescript
 * import { makeAuthEvent } from 'nostr-effect/nip42'
 *
 * // Create auth event template to sign
 * const template = makeAuthEvent('wss://relay.example.com', challengeString)
 * const signedEvent = await signer.sign(template)
 * ```
 */

// Re-export all from core implementation
export {
  CLIENT_AUTH_KIND,
  makeAuthEvent,
  type EventTemplate,
} from "../core/Nip42.js"
