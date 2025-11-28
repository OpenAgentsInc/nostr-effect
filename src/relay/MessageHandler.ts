/**
 * MessageHandler
 *
 * Routes NIP-01 client messages to appropriate handlers.
 * Returns relay messages for the client and broadcasts.
 */
import { Context, Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import { EventStore } from "./EventStore.js"
import { SubscriptionManager, type Subscription } from "./SubscriptionManager.js"
import { EventService } from "../services/EventService.js"
import { MessageParseError, DuplicateEvent, StorageError } from "../core/Errors.js"
import type { CryptoError, InvalidPublicKey } from "../core/Errors.js"
import {
  ClientMessage,
  type NostrEvent,
  type RelayMessage,
  type SubscriptionId,
  type EventId,
} from "../core/Schema.js"

// =============================================================================
// Response Types
// =============================================================================

export interface HandleResult {
  /** Messages to send back to the originating connection */
  readonly responses: readonly RelayMessage[]
  /** Messages to broadcast to other connections (subscription matches) */
  readonly broadcasts: readonly BroadcastMessage[]
}

export interface BroadcastMessage {
  readonly connectionId: string
  readonly subscriptionId: SubscriptionId
  readonly event: NostrEvent
}

// =============================================================================
// Service Interface
// =============================================================================

export interface MessageHandler {
  readonly _tag: "MessageHandler"

  /**
   * Handle a raw message string from a client
   */
  handleRaw(connectionId: string, raw: string): Effect.Effect<HandleResult, MessageParseError>

  /**
   * Handle a parsed client message
   */
  handleMessage(
    connectionId: string,
    message: ClientMessage
  ): Effect.Effect<HandleResult, StorageError | CryptoError | InvalidPublicKey | DuplicateEvent>
}

// =============================================================================
// Service Tag
// =============================================================================

export const MessageHandler = Context.GenericTag<MessageHandler>("MessageHandler")

// =============================================================================
// Message Building Helpers
// =============================================================================

const okMessage = (eventId: EventId, success: boolean, message: string): RelayMessage =>
  ["OK", eventId, success, message] as RelayMessage

const eventMessage = (subscriptionId: SubscriptionId, event: NostrEvent): RelayMessage =>
  ["EVENT", subscriptionId, event] as RelayMessage

const eoseMessage = (subscriptionId: SubscriptionId): RelayMessage =>
  ["EOSE", subscriptionId] as RelayMessage

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const eventStore = yield* EventStore
  const subscriptionManager = yield* SubscriptionManager
  const eventService = yield* EventService

  const handleEvent = (
    event: NostrEvent
  ): Effect.Effect<
    HandleResult,
    StorageError | CryptoError | InvalidPublicKey | DuplicateEvent
  > =>
    Effect.gen(function* () {
      // Validate event signature and ID
      const isValid = yield* eventService.verifyEvent(event)

      if (!isValid) {
        return {
          responses: [okMessage(event.id, false, "invalid: event verification failed")],
          broadcasts: [],
        }
      }

      // Store the event
      const storeResult = yield* eventStore.storeEvent(event).pipe(
        Effect.catchTag("DuplicateEvent", () =>
          Effect.succeed({ duplicate: true, stored: false })
        ),
        Effect.map((result) =>
          typeof result === "boolean" ? { duplicate: false, stored: result } : result
        )
      )

      if (storeResult.duplicate) {
        return {
          responses: [okMessage(event.id, true, "duplicate: event already exists")],
          broadcasts: [],
        }
      }

      // Find matching subscriptions for broadcast
      const matchingSubs = yield* subscriptionManager.getMatchingSubscriptions(event)

      const broadcasts: BroadcastMessage[] = matchingSubs.map((sub: Subscription) => ({
        connectionId: sub.connectionId,
        subscriptionId: sub.subscriptionId,
        event,
      }))

      return {
        responses: [okMessage(event.id, true, "")],
        broadcasts,
      }
    })

  const handleReq = (
    connectionId: string,
    subscriptionId: SubscriptionId,
    filters: readonly (typeof import("../core/Schema.js").Filter.Type)[]
  ): Effect.Effect<HandleResult, StorageError> =>
    Effect.gen(function* () {
      // Register the subscription
      yield* subscriptionManager.subscribe(connectionId, subscriptionId, filters)

      // Query matching events from storage
      const events = yield* eventStore.queryEvents(filters)

      // Build response: EVENT messages + EOSE
      const responses: RelayMessage[] = [
        ...events.map((event) => eventMessage(subscriptionId, event)),
        eoseMessage(subscriptionId),
      ]

      return { responses, broadcasts: [] }
    })

  const handleClose = (
    connectionId: string,
    subscriptionId: SubscriptionId
  ): Effect.Effect<HandleResult> =>
    Effect.gen(function* () {
      yield* subscriptionManager.unsubscribe(connectionId, subscriptionId)
      // NIP-01: CLOSE doesn't require a response
      return { responses: [], broadcasts: [] }
    })

  const handleMessage: MessageHandler["handleMessage"] = (connectionId, message) => {
    const [type] = message

    switch (type) {
      case "EVENT":
        return handleEvent(message[1])

      case "REQ":
        // REQ message is ["REQ", subscriptionId, ...filters]
        // With variadic tuple, message[1] is subId, rest are filters
        const [, subscriptionId, ...filters] = message
        return handleReq(connectionId, subscriptionId, filters)

      case "CLOSE":
        return handleClose(connectionId, message[1])
    }
  }

  const handleRaw: MessageHandler["handleRaw"] = (connectionId, raw) =>
    Effect.gen(function* () {
      // Parse JSON
      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw),
        catch: () => new MessageParseError({ message: "Invalid JSON", raw }),
      })

      // Decode as ClientMessage
      const decoded = yield* Schema.decodeUnknown(ClientMessage)(parsed).pipe(
        Effect.mapError(
          () => new MessageParseError({ message: "Invalid message format", raw })
        )
      )

      // Handle the decoded message
      return yield* handleMessage(connectionId, decoded).pipe(
        Effect.mapError(
          (error) =>
            new MessageParseError({
              message: `Handler error: ${error._tag}`,
              raw,
            })
        )
      )
    })

  return {
    _tag: "MessageHandler" as const,
    handleRaw,
    handleMessage,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

export const MessageHandlerLive = Layer.effect(MessageHandler, make)
