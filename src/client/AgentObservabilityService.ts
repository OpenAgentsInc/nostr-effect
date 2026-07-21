/**
 * NIP-AO: Agent Observability — Effect service
 *
 * Builds, signs, encrypts, reads, and optionally gift-wraps kind 24200
 * observer frames. Telemetry flows agent -> owner and control flows
 * owner -> agent, both encrypted bidirectionally with NIP-44 v2. Frames MAY be
 * wrapped in a NIP-59 gift wrap for metadata privacy.
 *
 * The protocol types and codecs live in {@link file://../core/NipAO.ts}. This
 * service composes {@link CryptoService}, {@link EventService}, and
 * {@link Nip44Service}, plus the NIP-59 gift-wrap primitives, into the
 * agent<->owner observability channel. It is the base that NIP-AM builds on.
 *
 * Kind 24200 is ephemeral: relays broadcast it and MUST NOT store it. This
 * service does not persist anything; the ephemeral guarantee is enforced by
 * the relay's NIP-16 handling (kinds 20000-29999).
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-AO.md (canonical spec)
 */
import { Context, Effect, Layer } from "effect"
import type {
  EventId,
  EventKind,
  NostrEvent,
  PrivateKey,
  PublicKey,
  Signature,
  UnixTimestamp,
} from "../core/Schema.js"
import { ObservabilityError } from "../core/Errors.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Nip44Service, Nip44ServiceLive, type EncryptedPayload } from "../services/Nip44Service.js"
import {
  wrapEvent,
  unwrapEvent,
  type GiftWrappedEvent,
  type Rumor,
} from "../core/Nip59.js"
import {
  OBSERVER_FRAME_KIND,
  MAX_DECRYPTED_PAYLOAD_BYTES,
  buildObserverFrameTags,
  buildObserverFrameFilter,
  parseObserverFrameTags,
  observerEventToJson,
  observerEventFromJson,
  controlMessageToJson,
  controlMessageFromJson,
  type ControlMessage,
  type ObserverEvent,
  type ObserverFrameFilter,
  type ObserverFramePayload,
} from "../core/NipAO.js"

// =============================================================================
// Envelope accepted by readFrame
// =============================================================================

/**
 * The minimal shape {@link AgentObservabilityService.readFrame} needs.
 * Both a signed {@link NostrEvent} and a NIP-59 {@link Rumor} satisfy it.
 * When `sig` is present the signature is verified; otherwise verification is
 * skipped (a gift-wrapped rumor is authenticated by its seal instead).
 */
export interface FrameEnvelope {
  readonly pubkey: PublicKey
  readonly content: string
  readonly tags: readonly (readonly string[])[]
  readonly id?: EventId
  readonly sig?: Signature
  readonly created_at?: UnixTimestamp
  readonly kind?: EventKind
}

// =============================================================================
// Service Interface
// =============================================================================

export interface AgentObservabilityService {
  readonly _tag: "AgentObservabilityService"

  /**
   * Build and sign a telemetry frame (agent -> owner, kind 24200).
   * `pubkey`=agent, `p`=owner, `agent`=agent. Content is the observer event
   * JSON encrypted with `(agentPrivateKey, ownerPublicKey)`.
   */
  buildTelemetryFrame(params: {
    readonly event: ObserverEvent
    readonly agentPrivateKey: PrivateKey
    readonly ownerPublicKey: PublicKey
    readonly groupId?: string
    readonly created_at?: UnixTimestamp
  }): Effect.Effect<NostrEvent, ObservabilityError>

  /**
   * Build and sign a control frame (owner -> agent, kind 24200).
   * `pubkey`=owner, `p`=agent, `agent`=agent (target). Content is the control
   * message JSON encrypted with `(ownerPrivateKey, agentPublicKey)`.
   */
  buildControlFrame(params: {
    readonly message: ControlMessage
    readonly ownerPrivateKey: PrivateKey
    readonly agentPublicKey: PublicKey
    readonly groupId?: string
    readonly created_at?: UnixTimestamp
  }): Effect.Effect<NostrEvent, ObservabilityError>

  /**
   * Verify (when signed), decrypt, and parse a received frame.
   * Decryption uses `(recipientPrivateKey, envelope.pubkey)`. Returns a payload
   * discriminated on `direction`.
   */
  readFrame(
    envelope: FrameEnvelope,
    recipientPrivateKey: PrivateKey
  ): Effect.Effect<ObserverFramePayload, ObservabilityError>

  /**
   * NIP-59 gift-wrap a signed frame for the recipient (optional metadata
   * privacy). The routing tags are hidden from relays; only an ephemeral
   * random-key kind 1059 event with a single `p` tag is visible on the wire.
   */
  wrapFrame(
    frame: NostrEvent,
    senderPrivateKey: PrivateKey,
    recipientPublicKey: PublicKey
  ): Effect.Effect<GiftWrappedEvent, ObservabilityError>

  /** Unwrap a gift-wrapped frame back to the inner rumor. */
  unwrapFrame(
    giftWrap: GiftWrappedEvent,
    recipientPrivateKey: PrivateKey
  ): Effect.Effect<Rumor, ObservabilityError>

  /**
   * Build the recommended live subscription filter
   * (`{kinds:[24200], "#p":[own], since}`).
   */
  subscriptionFilter(ownPublicKey: PublicKey, since?: number): ObserverFrameFilter
}

// =============================================================================
// Service Tag
// =============================================================================

export const AgentObservabilityService =
  Context.Service<AgentObservabilityService>("AgentObservabilityService")

// =============================================================================
// Helpers
// =============================================================================

const byteLength = (value: string): number => new TextEncoder().encode(value).length

const toKeyBytes = (privateKey: PrivateKey): Uint8Array =>
  Uint8Array.from(Buffer.from(privateKey, "hex"))

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const crypto = yield* CryptoService
  const events = yield* EventService
  const nip44 = yield* Nip44Service

  const encryptPayload = (
    plaintext: string,
    senderPrivateKey: PrivateKey,
    recipientPublicKey: PublicKey,
    operation: "buildTelemetryFrame" | "buildControlFrame"
  ) =>
    Effect.gen(function* () {
      if (byteLength(plaintext) > MAX_DECRYPTED_PAYLOAD_BYTES) {
        return yield* Effect.fail(
          new ObservabilityError({
            message: `Decrypted payload exceeds ${MAX_DECRYPTED_PAYLOAD_BYTES} bytes`,
            operation,
          })
        )
      }
      const conversationKey = yield* nip44.getConversationKey(senderPrivateKey, recipientPublicKey)
      return yield* nip44.encrypt(plaintext, conversationKey)
    }).pipe(
      Effect.catchTags({
        CryptoError: (error) =>
          Effect.fail(new ObservabilityError({ message: error.message, operation })),
      })
    )

  const buildTelemetryFrame: AgentObservabilityService["buildTelemetryFrame"] = (params) =>
    Effect.gen(function* () {
      const plaintext = yield* Effect.try({
        try: () => observerEventToJson(params.event),
        catch: (error) =>
          new ObservabilityError({
            message: `Failed to encode observer event: ${error}`,
            operation: "buildTelemetryFrame",
          }),
      })

      const agentPublicKey = yield* crypto
        .getPublicKey(params.agentPrivateKey)
        .pipe(
          Effect.catch((error) =>
            Effect.fail(
              new ObservabilityError({ message: error.message, operation: "buildTelemetryFrame" })
            )
          )
        )

      const content = yield* encryptPayload(
        plaintext,
        params.agentPrivateKey,
        params.ownerPublicKey,
        "buildTelemetryFrame"
      )

      const tags = buildObserverFrameTags({
        recipient: params.ownerPublicKey,
        agent: agentPublicKey,
        direction: "telemetry",
        ...(params.groupId !== undefined ? { groupId: params.groupId } : {}),
      })

      return yield* events
        .createEvent(
          {
            kind: OBSERVER_FRAME_KIND,
            content,
            tags,
            ...(params.created_at !== undefined ? { created_at: params.created_at } : {}),
          },
          params.agentPrivateKey
        )
        .pipe(
          Effect.catch((error) =>
            Effect.fail(
              new ObservabilityError({ message: error.message, operation: "buildTelemetryFrame" })
            )
          )
        )
    })

  const buildControlFrame: AgentObservabilityService["buildControlFrame"] = (params) =>
    Effect.gen(function* () {
      const plaintext = yield* Effect.try({
        try: () => controlMessageToJson(params.message),
        catch: (error) =>
          new ObservabilityError({
            message: `Failed to encode control message: ${error}`,
            operation: "buildControlFrame",
          }),
      })

      const content = yield* encryptPayload(
        plaintext,
        params.ownerPrivateKey,
        params.agentPublicKey,
        "buildControlFrame"
      )

      const tags = buildObserverFrameTags({
        recipient: params.agentPublicKey,
        agent: params.agentPublicKey,
        direction: "control",
        ...(params.groupId !== undefined ? { groupId: params.groupId } : {}),
      })

      return yield* events
        .createEvent(
          {
            kind: OBSERVER_FRAME_KIND,
            content,
            tags,
            ...(params.created_at !== undefined ? { created_at: params.created_at } : {}),
          },
          params.ownerPrivateKey
        )
        .pipe(
          Effect.catch((error) =>
            Effect.fail(
              new ObservabilityError({ message: error.message, operation: "buildControlFrame" })
            )
          )
        )
    })

  const readFrame: AgentObservabilityService["readFrame"] = (envelope, recipientPrivateKey) =>
    Effect.gen(function* () {
      const routing = parseObserverFrameTags(envelope.tags)
      if (routing === null) {
        return yield* Effect.fail(
          new ObservabilityError({
            message: "Invalid observer frame: expected exactly one p, agent, and frame tag",
            operation: "readFrame",
          })
        )
      }

      // Verify the signature when the envelope is a signed event. A NIP-59
      // rumor has no sig; it is authenticated by its seal, so skip.
      if (
        envelope.sig !== undefined &&
        envelope.id !== undefined &&
        envelope.created_at !== undefined &&
        envelope.kind !== undefined
      ) {
        const signed: NostrEvent = {
          id: envelope.id,
          pubkey: envelope.pubkey,
          created_at: envelope.created_at,
          kind: envelope.kind,
          tags: envelope.tags as NostrEvent["tags"],
          content: envelope.content,
          sig: envelope.sig,
        }
        const valid = yield* events
          .verifyEvent(signed)
          .pipe(
            Effect.catch((error) =>
              Effect.fail(new ObservabilityError({ message: error.message, operation: "readFrame" }))
            )
          )
        if (!valid) {
          return yield* Effect.fail(
            new ObservabilityError({
              message: "Invalid observer frame signature",
              operation: "readFrame",
            })
          )
        }
      }

      const conversationKey = yield* nip44
        .getConversationKey(recipientPrivateKey, envelope.pubkey)
        .pipe(
          Effect.catch((error) =>
            Effect.fail(new ObservabilityError({ message: error.message, operation: "readFrame" }))
          )
        )

      const plaintext = yield* nip44
        .decrypt(envelope.content as EncryptedPayload, conversationKey)
        .pipe(
          Effect.catch((error) =>
            Effect.fail(new ObservabilityError({ message: error.message, operation: "readFrame" }))
          )
        )

      if (byteLength(plaintext) > MAX_DECRYPTED_PAYLOAD_BYTES) {
        return yield* Effect.fail(
          new ObservabilityError({
            message: `Decrypted payload exceeds ${MAX_DECRYPTED_PAYLOAD_BYTES} bytes`,
            operation: "readFrame",
          })
        )
      }

      return yield* Effect.try({
        try: (): ObserverFramePayload =>
          routing.direction === "telemetry"
            ? { direction: "telemetry", event: observerEventFromJson(plaintext) }
            : { direction: "control", message: controlMessageFromJson(plaintext) },
        catch: (error) =>
          new ObservabilityError({
            message: `Failed to parse decrypted ${routing.direction} payload: ${error}`,
            operation: "readFrame",
          }),
      })
    })

  const wrapFrame: AgentObservabilityService["wrapFrame"] = (
    frame,
    senderPrivateKey,
    recipientPublicKey
  ) =>
    Effect.try({
      try: () =>
        wrapEvent(
          {
            kind: frame.kind,
            content: frame.content,
            tags: frame.tags,
            created_at: frame.created_at,
          },
          toKeyBytes(senderPrivateKey),
          recipientPublicKey
        ),
      catch: (error) =>
        new ObservabilityError({
          message: `Failed to gift-wrap frame: ${error instanceof Error ? error.message : String(error)}`,
          operation: "wrapFrame",
        }),
    })

  const unwrapFrame: AgentObservabilityService["unwrapFrame"] = (giftWrap, recipientPrivateKey) =>
    Effect.try({
      try: () => unwrapEvent(giftWrap, toKeyBytes(recipientPrivateKey)),
      catch: (error) =>
        new ObservabilityError({
          message: `Failed to unwrap frame: ${error instanceof Error ? error.message : String(error)}`,
          operation: "unwrapFrame",
        }),
    })

  const subscriptionFilter: AgentObservabilityService["subscriptionFilter"] = (
    ownPublicKey,
    since
  ) => buildObserverFrameFilter(ownPublicKey, since)

  return {
    _tag: "AgentObservabilityService" as const,
    buildTelemetryFrame,
    buildControlFrame,
    readFrame,
    wrapFrame,
    unwrapFrame,
    subscriptionFilter,
  }
})

// =============================================================================
// Layer
// =============================================================================

/**
 * Fully-wired dependencies for the observability service:
 * CryptoService, EventService (on Crypto), and Nip44Service.
 */
const DependenciesLive = Layer.mergeAll(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive)),
  Nip44ServiceLive
)

/**
 * Self-contained live layer. Provides {@link AgentObservabilityService} with no
 * remaining requirements. NIP-AM and other consumers can layer on top of this.
 */
export const AgentObservabilityServiceLive = Layer.effect(
  AgentObservabilityService,
  make
).pipe(Layer.provide(DependenciesLive))
