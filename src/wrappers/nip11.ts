/**
 * NIP-11: Relay Information Document
 *
 * Fetch relay metadata and capabilities from the NIP-11 information endpoint.
 *
 * @example
 * ```typescript
 * import { fetchRelayInformation, useFetchImplementation } from 'nostr-effect/nip11'
 *
 * const info = await fetchRelayInformation('wss://relay.damus.io')
 * console.log(info.name, info.supported_nips)
 * ```
 */

// Re-export all from core implementation
export {
  fetchRelayInformation,
  useFetchImplementation,
  type BasicRelayInformation,
  type Limitations,
  type RetentionDetails,
  type Retention,
  type ContentLimitations,
  type CommunityPreferences,
  type Amount,
  type PublicationAmount,
  type Subscription,
  type Fees,
  type PayToRelay,
  type Icon,
  type RelayInformation,
} from "../core/Nip11.js"
