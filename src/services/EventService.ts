/**
 * EventService
 *
 * Creates and signs Nostr events per NIP-01.
 * Handles event ID computation and serialization.
 */
import { Context, Effect, Layer } from "effect"
import { CryptoService } from "./CryptoService.js"
import { CryptoError, InvalidPrivateKey, InvalidPublicKey } from "../core/Errors.js"
import type {
  NostrEvent,
  EventKind,
  Tag,
  PrivateKey,
  PublicKey,
  EventId,
  UnixTimestamp,
} from "../core/Schema.js"

// =============================================================================
// Event Parameters
// =============================================================================

export interface CreateEventParams {
  readonly kind: EventKind
  readonly content: string
  readonly tags?: readonly Tag[]
  readonly created_at?: UnixTimestamp
}

// =============================================================================
// Service Interface
// =============================================================================

export interface EventService {
  readonly _tag: "EventService"

  /**
   * Create and sign a Nostr event
   */
  createEvent(
    params: CreateEventParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, CryptoError | InvalidPrivateKey>

  /**
   * Compute the event ID from event fields
   * ID = sha256(serialized([0, pubkey, created_at, kind, tags, content]))
   */
  computeEventId(
    pubkey: PublicKey,
    created_at: UnixTimestamp,
    kind: EventKind,
    tags: readonly Tag[],
    content: string
  ): Effect.Effect<EventId, CryptoError>

  /**
   * Verify an event's signature and ID
   */
  verifyEvent(
    event: NostrEvent
  ): Effect.Effect<boolean, CryptoError | InvalidPublicKey>
}

// =============================================================================
// Service Tag
// =============================================================================

export const EventService = Context.GenericTag<EventService>("EventService")

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const crypto = yield* CryptoService

  const computeEventId: EventService["computeEventId"] = (
    pubkey,
    created_at,
    kind,
    tags,
    content
  ) =>
    Effect.gen(function* () {
      // NIP-01: serialize as [0, pubkey, created_at, kind, tags, content]
      const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content])
      return yield* crypto.hash(serialized)
    })

  const createEvent: EventService["createEvent"] = (params, privateKey) =>
    Effect.gen(function* () {
      // Get public key from private key
      const pubkey = yield* crypto.getPublicKey(privateKey)

      // Use provided timestamp or current time
      const created_at = (params.created_at ?? Math.floor(Date.now() / 1000)) as UnixTimestamp
      const tags = (params.tags ?? []) as Tag[]

      // Compute event ID
      const id = yield* computeEventId(pubkey, created_at, params.kind, tags, params.content)

      // Sign the event ID
      const sig = yield* crypto.sign(id, privateKey)

      return {
        id,
        pubkey,
        created_at,
        kind: params.kind,
        tags,
        content: params.content,
        sig,
      } as NostrEvent
    })

  const verifyEvent: EventService["verifyEvent"] = (event) =>
    Effect.gen(function* () {
      // Recompute event ID
      const computedId = yield* computeEventId(
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content
      )

      // Check ID matches
      if (computedId !== event.id) {
        return false
      }

      // Verify signature
      return yield* crypto.verify(event.sig, event.id, event.pubkey)
    })

  return {
    _tag: "EventService" as const,
    createEvent,
    computeEventId,
    verifyEvent,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

export const EventServiceLive = Layer.effect(EventService, make)
