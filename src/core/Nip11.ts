/**
 * NIP-11: Relay Information Document
 * https://github.com/nostr-protocol/nips/blob/master/11.md
 *
 * Client-side relay information fetching
 */

/** Basic relay information fields */
export interface BasicRelayInformation {
  name: string
  description: string
  pubkey: string
  contact: string
  supported_nips: number[]
  software: string
  version: string
}

/** Relay limitations */
export interface Limitations {
  max_message_length: number
  max_subscriptions: number
  max_filters: number
  max_limit: number
  max_subid_length: number
  min_prefix: number
  max_event_tags: number
  max_content_length: number
  min_pow_difficulty: number
  auth_required: boolean
  payment_required: boolean
  created_at_lower_limit: number
  created_at_upper_limit: number
  restricted_writes: boolean
}

/** Event retention details */
export interface RetentionDetails {
  kinds: (number | number[])[]
  time?: number | null
  count?: number | null
}

/** Retention configuration */
export interface Retention {
  retention: RetentionDetails[]
}

/** Content limitations based on jurisdiction */
export interface ContentLimitations {
  relay_countries: string[]
}

/** Community preferences */
export interface CommunityPreferences {
  language_tags: string[]
  tags: string[]
  posting_policy: string
}

/** Fee amount */
export interface Amount {
  amount: number
  unit: "msat"
}

/** Publication fee with kinds */
export interface PublicationAmount extends Amount {
  kinds: number[]
}

/** Subscription fee with period */
export interface Subscription extends Amount {
  period: number
}

/** Fee schedule */
export interface Fees {
  admission: Amount[]
  subscription: Subscription[]
  publication: PublicationAmount[]
}

/** Payment information */
export interface PayToRelay {
  payments_url: string
  fees: Fees
}

/** Relay icon */
export interface Icon {
  icon: string
}

/** Complete relay information */
export type RelayInformation = BasicRelayInformation &
  Partial<Retention> & {
    limitation?: Partial<Limitations>
  } & Partial<ContentLimitations> &
  Partial<CommunityPreferences> &
  Partial<PayToRelay> &
  Partial<Icon>

let _fetch: typeof fetch = globalThis.fetch

/**
 * Set a custom fetch implementation
 */
export function useFetchImplementation(fetchImplementation: typeof fetch): void {
  _fetch = fetchImplementation
}

/**
 * Fetch relay information document (NIP-11)
 * @param url - WebSocket URL of the relay (wss:// or ws://)
 * @returns Relay information document
 */
export async function fetchRelayInformation(url: string): Promise<RelayInformation> {
  const httpUrl = url.replace("ws://", "http://").replace("wss://", "https://")
  const response = await _fetch(httpUrl, {
    headers: { Accept: "application/nostr+json" },
  })
  return (await response.json()) as RelayInformation
}
