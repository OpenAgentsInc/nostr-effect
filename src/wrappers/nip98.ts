/**
 * NIP-98: HTTP Auth
 *
 * HTTP authentication using Nostr events.
 *
 * @example
 * ```typescript
 * import { getToken, validateToken } from 'nostr-effect/nip98'
 *
 * // Get auth token
 * const token = await getToken(url, 'GET', signEvent)
 *
 * // Validate auth token
 * const isValid = await validateToken(token, url, 'GET')
 * ```
 */

// Re-export all from core implementation
export {
  HTTP_AUTH_KIND,
  getToken,
  validateToken,
  unpackEventFromToken,
  validateEventTimestamp,
  validateEventKind,
  validateEventUrlTag,
  validateEventMethodTag,
  hashPayload,
  validateEventPayloadTag,
  validateEventFull,
  validateEvent,
  type EventTemplate,
  type SignerFunction,
} from "../core/Nip98.js"
