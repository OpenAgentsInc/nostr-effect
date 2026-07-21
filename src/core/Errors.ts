/**
 * Typed Error Classes
 *
 * All errors extend Schema.TaggedErrorClass for serialization support.
 */
import { Schema } from "effect"

// =============================================================================
// Validation Errors
// =============================================================================

export class InvalidEventId extends Schema.TaggedErrorClass<InvalidEventId>()(
  "InvalidEventId",
  { message: Schema.String }
) {}

export class InvalidSignature extends Schema.TaggedErrorClass<InvalidSignature>()(
  "InvalidSignature",
  { message: Schema.String }
) {}

export class InvalidEventFormat extends Schema.TaggedErrorClass<InvalidEventFormat>()(
  "InvalidEventFormat",
  { message: Schema.String }
) {}

export class EventValidationError extends Schema.TaggedErrorClass<EventValidationError>()(
  "EventValidationError",
  { message: Schema.String }
) {}

// =============================================================================
// Crypto Errors
// =============================================================================

export class CryptoError extends Schema.TaggedErrorClass<CryptoError>()(
  "CryptoError",
  {
    message: Schema.String,
    operation: Schema.Literals([
      "sign",
      "verify",
      "hash",
      "generateKey",
      "encrypt",
      "decrypt",
      "getConversationKey",
      "encryptWithNonce",
    ]),
  }
) {}

export class InvalidPrivateKey extends Schema.TaggedErrorClass<InvalidPrivateKey>()(
  "InvalidPrivateKey",
  { message: Schema.String }
) {}

export class InvalidPublicKey extends Schema.TaggedErrorClass<InvalidPublicKey>()(
  "InvalidPublicKey",
  { message: Schema.String }
) {}

// =============================================================================
// Observability Errors (NIP-AO)
// =============================================================================

export class ObservabilityError extends Schema.TaggedErrorClass<ObservabilityError>()(
  "ObservabilityError",
  {
    message: Schema.String,
    operation: Schema.Literals([
      "buildTelemetryFrame",
      "buildControlFrame",
      "readFrame",
      "wrapFrame",
      "unwrapFrame",
    ]),
  }
) {}

// =============================================================================
// Agent Metrics Errors (NIP-AM)
// =============================================================================

export class AgentMetricsError extends Schema.TaggedErrorClass<AgentMetricsError>()(
  "AgentMetricsError",
  {
    message: Schema.String,
    operation: Schema.Literals(["buildTurnMetric", "readTurnMetric"]),
  }
) {}

// =============================================================================
// Encoding Errors
// =============================================================================

export class EncodingError extends Schema.TaggedErrorClass<EncodingError>()(
  "EncodingError",
  { message: Schema.String }
) {}

export class DecodingError extends Schema.TaggedErrorClass<DecodingError>()(
  "DecodingError",
  { message: Schema.String }
) {}

// =============================================================================
// Connection Errors
// =============================================================================

export class ConnectionError extends Schema.TaggedErrorClass<ConnectionError>()(
  "ConnectionError",
  {
    message: Schema.String,
    url: Schema.String,
  }
) {}

export class ConnectionClosed extends Schema.TaggedErrorClass<ConnectionClosed>()(
  "ConnectionClosed",
  {
    message: Schema.String,
    code: Schema.optional(Schema.Number),
    reason: Schema.optional(Schema.String),
  }
) {}

export class MessageSendError extends Schema.TaggedErrorClass<MessageSendError>()(
  "MessageSendError",
  { message: Schema.String }
) {}

export class TimeoutError extends Schema.TaggedErrorClass<TimeoutError>()(
  "TimeoutError",
  {
    message: Schema.String,
    durationMs: Schema.Number,
  }
) {}

// =============================================================================
// Relay Errors
// =============================================================================

export class RelayError extends Schema.TaggedErrorClass<RelayError>()(
  "RelayError",
  {
    message: Schema.String,
    relay: Schema.String,
  }
) {}

export class RelayNotice extends Schema.TaggedErrorClass<RelayNotice>()(
  "RelayNotice",
  {
    message: Schema.String,
    relay: Schema.String,
  }
) {}

export class SubscriptionError extends Schema.TaggedErrorClass<SubscriptionError>()(
  "SubscriptionError",
  {
    message: Schema.String,
    subscriptionId: Schema.String,
  }
) {}

export class SubscriptionClosed extends Schema.TaggedErrorClass<SubscriptionClosed>()(
  "SubscriptionClosed",
  {
    subscriptionId: Schema.String,
    reason: Schema.String,
  }
) {}

// =============================================================================
// Storage Errors (Relay)
// =============================================================================

export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  "StorageError",
  {
    message: Schema.String,
    operation: Schema.Literals(["insert", "query", "delete", "init", "upsert"]),
  }
) {}

export class DuplicateEvent extends Schema.TaggedErrorClass<DuplicateEvent>()(
  "DuplicateEvent",
  {
    eventId: Schema.String,
  }
) {}

export class MessageParseError extends Schema.TaggedErrorClass<MessageParseError>()(
  "MessageParseError",
  {
    message: Schema.String,
    raw: Schema.String,
  }
) {}
