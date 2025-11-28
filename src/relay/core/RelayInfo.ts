/**
 * RelayInfo
 *
 * NIP-11 Relay Information Document schema and types.
 * Describes relay metadata served at the WebSocket endpoint.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/11.md
 */
import { Schema } from "@effect/schema"

// =============================================================================
// Limitation Schema
// =============================================================================

/**
 * Server limitations imposed by the relay
 */
export const RelayLimitation = Schema.Struct({
  /** Maximum bytes for incoming JSON messages */
  max_message_length: Schema.optional(Schema.Number),
  /** Maximum active subscriptions per connection */
  max_subscriptions: Schema.optional(Schema.Number),
  /** Maximum limit value in subscription filters */
  max_limit: Schema.optional(Schema.Number),
  /** Maximum length of subscription ID */
  max_subid_length: Schema.optional(Schema.Number),
  /** Maximum number of tags per event */
  max_event_tags: Schema.optional(Schema.Number),
  /** Maximum characters in event content */
  max_content_length: Schema.optional(Schema.Number),
  /** Minimum PoW difficulty required (NIP-13) */
  min_pow_difficulty: Schema.optional(Schema.Number),
  /** Whether NIP-42 auth is required before any action */
  auth_required: Schema.optional(Schema.Boolean),
  /** Whether payment is required */
  payment_required: Schema.optional(Schema.Boolean),
  /** Whether writes are restricted */
  restricted_writes: Schema.optional(Schema.Boolean),
  /** Lower limit for created_at (seconds in past) */
  created_at_lower_limit: Schema.optional(Schema.Number),
  /** Upper limit for created_at (seconds in future) */
  created_at_upper_limit: Schema.optional(Schema.Number),
  /** Default limit if not specified in filter */
  default_limit: Schema.optional(Schema.Number),
})

export type RelayLimitation = Schema.Schema.Type<typeof RelayLimitation>

// =============================================================================
// Fee Schema
// =============================================================================

export const FeeAmount = Schema.Struct({
  amount: Schema.Number,
  unit: Schema.String,
  period: Schema.optional(Schema.Number),
})

export const RelayFees = Schema.Struct({
  admission: Schema.optional(Schema.Array(FeeAmount)),
  subscription: Schema.optional(Schema.Array(FeeAmount)),
  publication: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kinds: Schema.optional(Schema.Array(Schema.Number)),
        amount: Schema.Number,
        unit: Schema.String,
      })
    )
  ),
})

export type RelayFees = Schema.Schema.Type<typeof RelayFees>

// =============================================================================
// Retention Schema
// =============================================================================

export const RetentionSpec = Schema.Struct({
  /** Kind numbers or ranges [start, end] */
  kinds: Schema.optional(
    Schema.Array(Schema.Union(Schema.Number, Schema.Tuple(Schema.Number, Schema.Number)))
  ),
  /** Time in seconds to retain (null = infinity) */
  time: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Maximum count to retain */
  count: Schema.optional(Schema.Number),
})

export type RetentionSpec = Schema.Schema.Type<typeof RetentionSpec>

// =============================================================================
// Main RelayInfo Schema
// =============================================================================

/**
 * NIP-11 Relay Information Document
 */
export const RelayInfo = Schema.Struct({
  // Basic info
  /** Relay name (< 30 chars recommended) */
  name: Schema.optional(Schema.String),
  /** Detailed relay description */
  description: Schema.optional(Schema.String),
  /** Banner image URL */
  banner: Schema.optional(Schema.String),
  /** Icon image URL */
  icon: Schema.optional(Schema.String),
  /** Admin contact pubkey (32-byte hex) */
  pubkey: Schema.optional(Schema.String),
  /** Relay's own pubkey (32-byte hex) */
  self: Schema.optional(Schema.String),
  /** Alternative contact (URI) */
  contact: Schema.optional(Schema.String),
  /** List of supported NIP numbers */
  supported_nips: Schema.optional(Schema.Array(Schema.Number)),
  /** Relay software URL */
  software: Schema.optional(Schema.String),
  /** Software version string */
  version: Schema.optional(Schema.String),
  /** Privacy policy URL */
  privacy_policy: Schema.optional(Schema.String),
  /** Terms of service URL */
  terms_of_service: Schema.optional(Schema.String),

  // Extra fields
  /** Server limitations */
  limitation: Schema.optional(RelayLimitation),
  /** Event retention policies */
  retention: Schema.optional(Schema.Array(RetentionSpec)),
  /** Countries whose laws may apply */
  relay_countries: Schema.optional(Schema.Array(Schema.String)),
  /** Supported languages (IETF tags) */
  language_tags: Schema.optional(Schema.Array(Schema.String)),
  /** Topic/content tags */
  tags: Schema.optional(Schema.Array(Schema.String)),
  /** Posting policy URL */
  posting_policy: Schema.optional(Schema.String),
  /** Payments URL */
  payments_url: Schema.optional(Schema.String),
  /** Fee schedules */
  fees: Schema.optional(RelayFees),
})

export type RelayInfo = Schema.Schema.Type<typeof RelayInfo>

// =============================================================================
// Default Info
// =============================================================================

/**
 * Default relay info for nostr-effect
 */
export const defaultRelayInfo: RelayInfo = {
  name: "nostr-effect relay",
  description: "Effect-based Nostr relay implementation",
  supported_nips: [1, 11, 16, 33],
  software: "https://github.com/OpenAgentsInc/nostr-effect",
  version: "0.1.0",
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Merge partial relay info with defaults
 */
export const mergeRelayInfo = (
  custom: Partial<RelayInfo>,
  defaults: RelayInfo = defaultRelayInfo
): RelayInfo => ({
  ...defaults,
  ...custom,
  // Merge nested objects properly
  limitation: custom.limitation
    ? { ...defaults.limitation, ...custom.limitation }
    : defaults.limitation,
  fees: custom.fees ? { ...defaults.fees, ...custom.fees } : defaults.fees,
})
