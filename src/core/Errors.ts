/**
 * Typed Error Classes
 *
 * All errors extend Schema.TaggedError for serialization support.
 */
import { Schema } from "@effect/schema"

// =============================================================================
// Validation Errors
// =============================================================================

export class InvalidEventId extends Schema.TaggedError<InvalidEventId>()(
  "InvalidEventId",
  { message: Schema.String }
) {}

export class InvalidSignature extends Schema.TaggedError<InvalidSignature>()(
  "InvalidSignature",
  { message: Schema.String }
) {}

export class InvalidEventFormat extends Schema.TaggedError<InvalidEventFormat>()(
  "InvalidEventFormat",
  { message: Schema.String }
) {}

export class EventValidationError extends Schema.TaggedError<EventValidationError>()(
  "EventValidationError",
  { message: Schema.String }
) {}

// =============================================================================
// Crypto Errors
// =============================================================================

export class CryptoError extends Schema.TaggedError<CryptoError>()(
  "CryptoError",
  {
    message: Schema.String,
    operation: Schema.Literal("sign", "verify", "hash", "generateKey"),
  }
) {}

export class InvalidPrivateKey extends Schema.TaggedError<InvalidPrivateKey>()(
  "InvalidPrivateKey",
  { message: Schema.String }
) {}

export class InvalidPublicKey extends Schema.TaggedError<InvalidPublicKey>()(
  "InvalidPublicKey",
  { message: Schema.String }
) {}

// =============================================================================
// Encoding Errors
// =============================================================================

export class EncodingError extends Schema.TaggedError<EncodingError>()(
  "EncodingError",
  { message: Schema.String }
) {}

export class DecodingError extends Schema.TaggedError<DecodingError>()(
  "DecodingError",
  { message: Schema.String }
) {}

// =============================================================================
// Connection Errors
// =============================================================================

export class ConnectionError extends Schema.TaggedError<ConnectionError>()(
  "ConnectionError",
  {
    message: Schema.String,
    url: Schema.String,
  }
) {}

export class ConnectionClosed extends Schema.TaggedError<ConnectionClosed>()(
  "ConnectionClosed",
  {
    message: Schema.String,
    code: Schema.optional(Schema.Number),
    reason: Schema.optional(Schema.String),
  }
) {}

export class MessageSendError extends Schema.TaggedError<MessageSendError>()(
  "MessageSendError",
  { message: Schema.String }
) {}

export class TimeoutError extends Schema.TaggedError<TimeoutError>()(
  "TimeoutError",
  {
    message: Schema.String,
    durationMs: Schema.Number,
  }
) {}

// =============================================================================
// Relay Errors
// =============================================================================

export class RelayError extends Schema.TaggedError<RelayError>()(
  "RelayError",
  {
    message: Schema.String,
    relay: Schema.String,
  }
) {}

export class RelayNotice extends Schema.TaggedError<RelayNotice>()(
  "RelayNotice",
  {
    message: Schema.String,
    relay: Schema.String,
  }
) {}

export class SubscriptionError extends Schema.TaggedError<SubscriptionError>()(
  "SubscriptionError",
  {
    message: Schema.String,
    subscriptionId: Schema.String,
  }
) {}

export class SubscriptionClosed extends Schema.TaggedError<SubscriptionClosed>()(
  "SubscriptionClosed",
  {
    subscriptionId: Schema.String,
    reason: Schema.String,
  }
) {}

// =============================================================================
// Storage Errors (Relay)
// =============================================================================

export class StorageError extends Schema.TaggedError<StorageError>()(
  "StorageError",
  {
    message: Schema.String,
    operation: Schema.Literal("insert", "query", "delete", "init", "upsert"),
  }
) {}

export class DuplicateEvent extends Schema.TaggedError<DuplicateEvent>()(
  "DuplicateEvent",
  {
    eventId: Schema.String,
  }
) {}

export class MessageParseError extends Schema.TaggedError<MessageParseError>()(
  "MessageParseError",
  {
    message: Schema.String,
    raw: Schema.String,
  }
) {}
