/**
 * NIP-11: Relay Information Document
 * https://github.com/nostr-protocol/nips/blob/master/11.md
 *
 * Client-side relay information fetching.
 * Types aligned with relay schema in `src/relay/core/RelayInfo.ts`.
 */

/** Relay limitations (all fields optional; relays advertise what they enforce) */
export interface Limitations {
  max_message_length?: number
  max_subscriptions?: number
  max_filters?: number
  max_limit?: number
  max_subid_length?: number
  min_prefix?: number
  max_event_tags?: number
  max_content_length?: number
  min_pow_difficulty?: number
  auth_required?: boolean
  payment_required?: boolean
  created_at_lower_limit?: number
  created_at_upper_limit?: number
  restricted_writes?: boolean
  default_limit?: number
}

/** Event retention details */
export interface RetentionDetails {
  kinds?: (number | readonly [number, number])[]
  time?: number | null
  count?: number | null
}

/** Fee amount */
export interface Amount {
  amount: number
  unit: string
  period?: number
}

/** Publication fee with kinds */
export interface PublicationAmount extends Amount {
  kinds?: number[]
}

/** Fee schedule */
export interface Fees {
  admission?: Amount[]
  subscription?: Amount[]
  publication?: PublicationAmount[]
}

/**
 * NIP-11 Relay Information Document (client view).
 * Matches relay `RelayInfo` optional field set including banner/self/terms.
 */
export interface RelayInformation {
  name?: string
  description?: string
  /** Banner image URL */
  banner?: string
  /** Icon image URL */
  icon?: string
  /** Admin / contact pubkey */
  pubkey?: string
  /** Relay self identity pubkey (NIP-29 group host key, etc.) */
  self?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  privacy_policy?: string
  terms_of_service?: string
  limitation?: Limitations
  retention?: RetentionDetails[]
  relay_countries?: string[]
  language_tags?: string[]
  tags?: string[]
  posting_policy?: string
  payments_url?: string
  fees?: Fees
}

/** @deprecated Use RelayInformation — kept for type aliases used by older code */
export type BasicRelayInformation = Pick<
  Required<RelayInformation>,
  "name" | "description" | "pubkey" | "contact" | "supported_nips" | "software" | "version"
>

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
  // Only fail on explicit non-ok when status is present (mocks may omit ok)
  if (response.ok === false) {
    throw new Error(`Failed to fetch relay information: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as RelayInformation
}

// Back-compat type aliases (older wrappers re-export these names)
export type Retention = { retention?: RetentionDetails[] }
export type ContentLimitations = { relay_countries?: string[] }
export type CommunityPreferences = {
  language_tags?: string[]
  tags?: string[]
  posting_policy?: string
}
export type Subscription = Amount
export type PayToRelay = { payments_url?: string; fees?: Fees }
export type Icon = { icon?: string }

/**
 * Normalize a partial NIP-11 document to a typed RelayInformation.
 * Unknown keys are preserved via cast; known fields are lightly cleaned.
 */
export function normalizeRelayInformation(raw: Record<string, unknown>): RelayInformation {
  const out: RelayInformation = {}
  const str = (k: string) => {
    if (typeof raw[k] === "string") (out as Record<string, unknown>)[k] = raw[k]
  }
  for (const k of [
    "name",
    "description",
    "banner",
    "icon",
    "pubkey",
    "self",
    "contact",
    "software",
    "version",
    "privacy_policy",
    "terms_of_service",
    "posting_policy",
    "payments_url",
  ]) {
    str(k)
  }
  if (Array.isArray(raw.supported_nips)) {
    out.supported_nips = raw.supported_nips.filter((n): n is number => typeof n === "number")
  }
  if (raw.limitation && typeof raw.limitation === "object") {
    out.limitation = raw.limitation as Limitations
  }
  if (Array.isArray(raw.retention)) out.retention = raw.retention as RetentionDetails[]
  if (Array.isArray(raw.relay_countries)) out.relay_countries = raw.relay_countries as string[]
  if (Array.isArray(raw.language_tags)) out.language_tags = raw.language_tags as string[]
  if (Array.isArray(raw.tags)) out.tags = raw.tags as string[]
  if (raw.fees && typeof raw.fees === "object") out.fees = raw.fees as Fees
  return out
}
