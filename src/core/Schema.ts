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
  // NIP-50 search capability
  search: Schema.optional(Schema.String),
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

/** AUTH message: client authentication (NIP-42) */
export const ClientAuthMessage = Schema.Tuple(
  Schema.Literal("AUTH"),
  NostrEvent // kind 22242 signed event
)
export type ClientAuthMessage = typeof ClientAuthMessage.Type

/** All client message types */
/** COUNT message (NIP-45): request event counts */
export const ClientCountMessage = Schema.Tuple(
  [Schema.Literal("COUNT"), SubscriptionId],
  Filter
)
export type ClientCountMessage = typeof ClientCountMessage.Type

// NIP-77: Negentropy messages (client side)
export const ClientNegOpenMessage = Schema.Tuple(
  Schema.Literal("NEG-OPEN"),
  SubscriptionId,
  Filter,
  Schema.String
)
export type ClientNegOpenMessage = typeof ClientNegOpenMessage.Type

export const ClientNegMsgMessage = Schema.Tuple(
  Schema.Literal("NEG-MSG"),
  SubscriptionId,
  Schema.String
)
export type ClientNegMsgMessage = typeof ClientNegMsgMessage.Type

export const ClientNegCloseMessage = Schema.Tuple(
  Schema.Literal("NEG-CLOSE"),
  SubscriptionId
)
export type ClientNegCloseMessage = typeof ClientNegCloseMessage.Type

export const ClientMessage = Schema.Union(
  ClientEventMessage,
  ClientReqMessage,
  ClientCloseMessage,
  ClientAuthMessage,
  ClientCountMessage,
  ClientNegOpenMessage,
  ClientNegMsgMessage,
  ClientNegCloseMessage
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

/** AUTH message: authentication challenge (NIP-42) */
export const RelayAuthMessage = Schema.Tuple(
  Schema.Literal("AUTH"),
  Schema.String // challenge string
)
export type RelayAuthMessage = typeof RelayAuthMessage.Type

/** All relay message types */
/** COUNT response (NIP-45): relay returns count for a query id */
export const RelayCountMessage = Schema.Tuple(
  Schema.Literal("COUNT"),
  SubscriptionId,
  Schema.Struct({
    count: Schema.Number,
    approximate: Schema.optional(Schema.Boolean),
  })
)
export type RelayCountMessage = typeof RelayCountMessage.Type

export const RelayMessage = Schema.Union(
  RelayEventMessage,
  RelayOkMessage,
  RelayEoseMessage,
  RelayClosedMessage,
  RelayNoticeMessage,
  RelayAuthMessage,
  RelayCountMessage,
  // NIP-77
  Schema.Tuple(Schema.Literal("NEG-MSG"), SubscriptionId, Schema.String),
  Schema.Tuple(Schema.Literal("NEG-ERR"), SubscriptionId, Schema.String)
)
export type RelayMessage = typeof RelayMessage.Type

// =============================================================================
// NIP-42 Auth Event Kind
// =============================================================================

/** Auth event kind (NIP-42) */
export const AUTH_EVENT_KIND = 22242 as EventKind

// =============================================================================
// NIP-28 Public Chat Event Kinds
// =============================================================================

/** Channel creation (NIP-28) */
export const CHANNEL_CREATE_KIND = 40 as EventKind

/** Channel metadata update (NIP-28) */
export const CHANNEL_METADATA_KIND = 41 as EventKind

/** Channel message (NIP-28) */
export const CHANNEL_MESSAGE_KIND = 42 as EventKind

/** Hide message - client-side moderation (NIP-28) */
export const CHANNEL_HIDE_MESSAGE_KIND = 43 as EventKind

/** Mute user - client-side moderation (NIP-28) */
export const CHANNEL_MUTE_USER_KIND = 44 as EventKind

// =============================================================================
// NIP-57 Lightning Zaps Event Kinds
// =============================================================================

/** Zap request - sent to LNURL endpoint (NIP-57) */
export const ZAP_REQUEST_KIND = 9734 as EventKind

/** Zap receipt - published after payment (NIP-57) */
export const ZAP_RECEIPT_KIND = 9735 as EventKind

// =============================================================================
// Event Kind Classification (NIP-16/33)
// =============================================================================

/**
 * Check if an event kind is replaceable (NIP-16)
 * Replaceable kinds: 0, 3, 10000-19999
 * Only one event per pubkey+kind is kept (latest by created_at)
 */
export const isReplaceableKind = (kind: EventKind | number): boolean => {
  const k = kind as number
  return k === 0 || k === 3 || (k >= 10000 && k <= 19999)
}

/**
 * Check if an event kind is parameterized replaceable (NIP-33)
 * Parameterized replaceable kinds: 30000-39999
 * Only one event per pubkey+kind+d-tag is kept (latest by created_at)
 */
export const isParameterizedReplaceableKind = (kind: EventKind | number): boolean => {
  const k = kind as number
  return k >= 30000 && k <= 39999
}

/**
 * Check if an event kind is any type of replaceable
 */
export const isAnyReplaceableKind = (kind: EventKind | number): boolean =>
  isReplaceableKind(kind) || isParameterizedReplaceableKind(kind)

/**
 * Check if an event kind is ephemeral (NIP-16)
 * Ephemeral kinds: 20000-29999
 * These events are not stored, only broadcast to subscribers
 */
export const isEphemeralKind = (kind: EventKind | number): boolean => {
  const k = kind as number
  return k >= 20000 && k <= 29999
}

/**
 * Get the d-tag value from an event's tags
 * Used for parameterized replaceable events
 */
export const getDTagValue = (event: NostrEvent): string | undefined => {
  const dTag = event.tags.find((tag) => tag[0] === "d")
  return dTag?.[1]
}
