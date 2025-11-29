/**
 * NIP-46: Nostr Connect (Remote Signing)
 *
 * Connect to remote signers (bunkers) for signing events.
 *
 * @example
 * ```typescript
 * import { parseBunkerUrl, createBunkerUrl } from 'nostr-effect/nip46'
 *
 * // Parse a bunker URL
 * const { remoteSignerPubkey, relays, secret } = await parseBunkerUrl('bunker://...')
 *
 * // Create a bunker URL
 * const url = createBunkerUrl(pubkey, relays, secret)
 * ```
 */

// Re-export URL parsing and creation (sync functions)
export {
  NIP46_KIND,
  parseBunkerUrl,
  parseNostrConnectUrl,
  parseNip46Url,
  createBunkerUrl,
  createNostrConnectUrl,
  generateRequestId,
  encodeRequest,
  decodeResponse,
  type BunkerUrl,
  type NostrConnectUrl,
  type Nip46Url,
  type Nip46Request,
  type Nip46Response,
  type Nip46Method,
  type Nip46UnsignedEvent,
  type Nip46ConnectionState,
  type AuthChallenge,
  Nip46Error,
  Nip46ParseError,
  Nip46MethodError,
} from "../client/Nip46Service.js"
