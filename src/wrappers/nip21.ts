/**
 * NIP-21: nostr: URI Scheme
 *
 * Parse and validate nostr: URIs for encoding NIP-19 entities.
 *
 * @example
 * ```typescript
 * import { NOSTR_URI_REGEX, test, parse } from 'nostr-effect/nip21'
 *
 * // Test if string is a valid nostr: URI
 * if (test('nostr:npub1...')) {
 *   const { uri, value, decoded } = parse('nostr:npub1...')
 * }
 * ```
 */

// Re-export all from core implementation
export {
  NOSTR_URI_REGEX,
  BECH32_REGEX,
  test,
  parse,
  safeParse,
  encode,
  safeEncode,
  extractBech32,
  type NostrURI,
  type ParsedNostrURI,
} from "../core/Nip21.js"
