/**
 * NIP-01 Core Schemas
 *
 * Type-safe Nostr event types using Effect Schema.
 * @see https://github.com/nostr-protocol/nips/blob/master/01.md
 */
import { Schema } from "@effect/schema"

// =============================================================================
// Branded Primitive Types
// =============================================================================

/** 64-character lowercase hex string (sha256 hash) */
export const EventId = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
  Schema.brand("EventId")
)
export type EventId = typeof EventId.Type

/** 64-character lowercase hex string (secp256k1 public key) */
export const PublicKey = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
  Schema.brand("PublicKey")
)
export type PublicKey = typeof PublicKey.Type

/** 64-character lowercase hex string (secp256k1 private key) */
export const PrivateKey = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
  Schema.brand("PrivateKey")
)
export type PrivateKey = typeof PrivateKey.Type

/** 128-character lowercase hex string (schnorr signature) */
export const Signature = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{128}$/),
  Schema.brand("Signature")
)
export type Signature = typeof Signature.Type

/** Unix timestamp in seconds (can be 0) */
export const UnixTimestamp = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
  Schema.brand("UnixTimestamp")
)
export type UnixTimestamp = typeof UnixTimestamp.Type

/** Event kind (0-65535) */
export const EventKind = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(65535),
  Schema.brand("EventKind")
)
export type EventKind = typeof EventKind.Type

/** Tag array (at least one element) */
export const Tag = Schema.Array(Schema.String).pipe(
  Schema.minItems(1),
  Schema.brand("Tag")
)
export type Tag = typeof Tag.Type

/** Subscription ID (1-64 characters) */
export const SubscriptionId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(64),
  Schema.brand("SubscriptionId")
)
export type SubscriptionId = typeof SubscriptionId.Type

// =============================================================================
// Event Types
// =============================================================================

/** Signed Nostr event (NIP-01) */
export const NostrEvent = Schema.Struct({
  id: EventId,
  pubkey: PublicKey,
  created_at: UnixTimestamp,
  kind: EventKind,
  tags: Schema.Array(Tag),
  content: Schema.String,
  sig: Signature,
})
export type NostrEvent = typeof NostrEvent.Type

/** Unsigned event (before signing) */
export const UnsignedEvent = Schema.Struct({
  pubkey: PublicKey,
  created_at: UnixTimestamp,
  kind: EventKind,
  tags: Schema.Array(Tag),
  content: Schema.String,
})
export type UnsignedEvent = typeof UnsignedEvent.Type

/** Event creation parameters */
export const EventParams = Schema.Struct({
  kind: EventKind,
  tags: Schema.Array(Tag),
  content: Schema.String,
})
export type EventParams = typeof EventParams.Type

// =============================================================================
// Filter Type
// =============================================================================

/** Event filter for subscriptions (NIP-01) */
export const Filter = Schema.Struct({
  ids: Schema.optional(Schema.Array(EventId)),
  authors: Schema.optional(Schema.Array(PublicKey)),
  kinds: Schema.optional(Schema.Array(EventKind)),
  since: Schema.optional(UnixTimestamp),
  until: Schema.optional(UnixTimestamp),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  // Tag filters (#e, #p, #a, #d, #t, etc.)
  "#e": Schema.optional(Schema.Array(EventId)),
  "#p": Schema.optional(Schema.Array(PublicKey)),
  "#a": Schema.optional(Schema.Array(Schema.String)),
  "#d": Schema.optional(Schema.Array(Schema.String)),
  "#t": Schema.optional(Schema.Array(Schema.String)),
}).pipe(Schema.brand("Filter"))
export type Filter = typeof Filter.Type

// =============================================================================
// Relay Messages (Client → Relay)
// =============================================================================

/** EVENT message: publish an event */
export const ClientEventMessage = Schema.Tuple(
  Schema.Literal("EVENT"),
  NostrEvent
)
export type ClientEventMessage = typeof ClientEventMessage.Type

/** REQ message: subscribe with filters (variadic: ["REQ", subId, filter, filter, ...]) */
export const ClientReqMessage = Schema.Tuple(
  [Schema.Literal("REQ"), SubscriptionId],
  Filter
)
export type ClientReqMessage = typeof ClientReqMessage.Type

/** CLOSE message: close subscription */
export const ClientCloseMessage = Schema.Tuple(
  Schema.Literal("CLOSE"),
  SubscriptionId
)
export type ClientCloseMessage = typeof ClientCloseMessage.Type

/** All client message types */
export const ClientMessage = Schema.Union(
  ClientEventMessage,
  ClientReqMessage,
  ClientCloseMessage
)
export type ClientMessage = typeof ClientMessage.Type

// =============================================================================
// Relay Messages (Relay → Client)
// =============================================================================

/** EVENT message: relay sends matching event */
export const RelayEventMessage = Schema.Tuple(
  Schema.Literal("EVENT"),
  SubscriptionId,
  NostrEvent
)
export type RelayEventMessage = typeof RelayEventMessage.Type

/** OK message: event accepted/rejected */
export const RelayOkMessage = Schema.Tuple(
  Schema.Literal("OK"),
  EventId,
  Schema.Boolean,
  Schema.String // reason
)
export type RelayOkMessage = typeof RelayOkMessage.Type

/** EOSE message: end of stored events */
export const RelayEoseMessage = Schema.Tuple(
  Schema.Literal("EOSE"),
  SubscriptionId
)
export type RelayEoseMessage = typeof RelayEoseMessage.Type

/** CLOSED message: subscription closed by relay */
export const RelayClosedMessage = Schema.Tuple(
  Schema.Literal("CLOSED"),
  SubscriptionId,
  Schema.String // reason
)
export type RelayClosedMessage = typeof RelayClosedMessage.Type

/** NOTICE message: human-readable message */
export const RelayNoticeMessage = Schema.Tuple(
  Schema.Literal("NOTICE"),
  Schema.String
)
export type RelayNoticeMessage = typeof RelayNoticeMessage.Type

/** All relay message types */
export const RelayMessage = Schema.Union(
  RelayEventMessage,
  RelayOkMessage,
  RelayEoseMessage,
  RelayClosedMessage,
  RelayNoticeMessage
)
export type RelayMessage = typeof RelayMessage.Type
