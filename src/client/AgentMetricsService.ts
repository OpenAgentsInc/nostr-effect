/**
 * NIP-AM: Agent Turn Metrics — Effect service
 *
 * Builds, signs, encrypts, and reads kind 44200 turn-metric events. Each
 * completed agent turn produces exactly one regular (append-only) event,
 * NIP-44 encrypted to the owner with `(agent_privkey, owner_pubkey)`. Tag
 * layout mirrors NIP-AO telemetry frames: exactly one `p` (owner) and one
 * `agent` (equal to event.pubkey).
 *
 * The protocol types and codecs live in {@link file://../core/NipAM.ts}. This
 * service composes {@link CryptoService}, {@link EventService}, and
 * {@link Nip44Service} into the agent->owner metrics channel.
 *
 * Kind 44200 is regular/durable (unlike NIP-AO's ephemeral kind 24200): relays
 * store it append-only and never replace it. This service is protocol-only —
 * it does not publish to a relay; callers compose with {@link RelayService}.
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-AM.md (canonical spec)
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
import { AgentMetricsError } from "../core/Errors.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { Nip44Service, Nip44ServiceLive, type EncryptedPayload } from "../services/Nip44Service.js"
import {
  TURN_METRIC_KIND,
  MAX_DECRYPTED_PAYLOAD_BYTES,
  buildTurnMetricTags,
  buildTurnMetricFilter,
  parseTurnMetricTags,
  turnMetricToJson,
  turnMetricFromJson,
  type TurnMetric,
  type TurnMetricFilter,
} from "../core/NipAM.js"

// =============================================================================
// Envelope accepted by readTurnMetric
// =============================================================================

/**
 * The minimal shape {@link AgentMetricsService.readTurnMetric} needs.
 * A signed {@link NostrEvent} satisfies it. When `sig` is present the
 * signature is verified; otherwise verification is skipped.
 */
export interface MetricEnvelope {
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

export interface AgentMetricsService {
  readonly _tag: "AgentMetricsService"

  /**
   * Build and sign a turn-metric event (agent -> owner, kind 44200).
   * `pubkey`=agent, `p`=owner, `agent`=agent. Content is the turn-metric JSON
   * encrypted with `(agentPrivateKey, ownerPublicKey)`.
   *
   * When `created_at` is omitted, the payload `timestamp` is truncated to
   * seconds when parseable (per the spec recommendation); otherwise the
   * current time is used by {@link EventService}.
   */
  buildTurnMetric(params: {
    readonly metric: TurnMetric
    readonly agentPrivateKey: PrivateKey
    readonly ownerPublicKey: PublicKey
    readonly created_at?: UnixTimestamp
  }): Effect.Effect<NostrEvent, AgentMetricsError>

  /**
   * Verify (when signed), decrypt, and parse a received turn-metric event.
   * Decryption uses `(ownerPrivateKey, envelope.pubkey)`. Validates that
   * routing tags are well-formed and that the `agent` tag equals
   * `envelope.pubkey`.
   */
  readTurnMetric(
    envelope: MetricEnvelope,
    ownerPrivateKey: PrivateKey
  ): Effect.Effect<TurnMetric, AgentMetricsError>

  /**
   * Build the recommended owner-scoped recovery filter
   * (`{kinds:[44200], "#p":[own], since?}`).
   */
  subscriptionFilter(ownPublicKey: PublicKey, since?: number): TurnMetricFilter
}

// =============================================================================
// Service Tag
// =============================================================================

export const AgentMetricsService = Context.Service<AgentMetricsService>("AgentMetricsService")

// =============================================================================
// Helpers
// =============================================================================

const byteLength = (value: string): number => new TextEncoder().encode(value).length

/**
 * Truncate an RFC 3339 timestamp to Unix seconds. Returns `undefined` when
 * the value is not a parseable date so the caller can fall back to "now".
 */
const truncateTimestampToSeconds = (timestamp: string): UnixTimestamp | undefined => {
  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms)) return undefined
  return Math.floor(ms / 1000) as UnixTimestamp
}

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
    recipientPublicKey: PublicKey
  ) =>
    Effect.gen(function* () {
      if (byteLength(plaintext) > MAX_DECRYPTED_PAYLOAD_BYTES) {
        return yield* Effect.fail(
          new AgentMetricsError({
            message: `Decrypted payload exceeds ${MAX_DECRYPTED_PAYLOAD_BYTES} bytes`,
            operation: "buildTurnMetric",
          })
        )
      }
      const conversationKey = yield* nip44.getConversationKey(senderPrivateKey, recipientPublicKey)
      return yield* nip44.encrypt(plaintext, conversationKey)
    }).pipe(
      Effect.catchTags({
        CryptoError: (error) =>
          Effect.fail(
            new AgentMetricsError({ message: error.message, operation: "buildTurnMetric" })
          ),
      })
    )

  const buildTurnMetric: AgentMetricsService["buildTurnMetric"] = (params) =>
    Effect.gen(function* () {
      const plaintext = yield* Effect.try({
        try: () => turnMetricToJson(params.metric),
        catch: (error) =>
          new AgentMetricsError({
            message: `Failed to encode turn metric: ${error instanceof Error ? error.message : String(error)}`,
            operation: "buildTurnMetric",
          }),
      })

      const agentPublicKey = yield* crypto.getPublicKey(params.agentPrivateKey).pipe(
        Effect.catch((error) =>
          Effect.fail(
            new AgentMetricsError({ message: error.message, operation: "buildTurnMetric" })
          )
        )
      )

      const content = yield* encryptPayload(
        plaintext,
        params.agentPrivateKey,
        params.ownerPublicKey
      )

      const tags = buildTurnMetricTags({
        owner: params.ownerPublicKey,
        agent: agentPublicKey,
      })

      const created_at =
        params.created_at ?? truncateTimestampToSeconds(params.metric.timestamp)

      return yield* events
        .createEvent(
          {
            kind: TURN_METRIC_KIND,
            content,
            tags,
            ...(created_at !== undefined ? { created_at } : {}),
          },
          params.agentPrivateKey
        )
        .pipe(
          Effect.catch((error) =>
            Effect.fail(
              new AgentMetricsError({ message: error.message, operation: "buildTurnMetric" })
            )
          )
        )
    })

  const readTurnMetric: AgentMetricsService["readTurnMetric"] = (envelope, ownerPrivateKey) =>
    Effect.gen(function* () {
      const routing = parseTurnMetricTags(envelope.tags)
      if (routing === null) {
        return yield* Effect.fail(
          new AgentMetricsError({
            message: "Invalid turn metric: expected exactly one p and one agent tag",
            operation: "readTurnMetric",
          })
        )
      }

      // Spec: agent tag MUST equal event.pubkey.
      if (routing.agent !== envelope.pubkey) {
        return yield* Effect.fail(
          new AgentMetricsError({
            message: "Invalid turn metric: agent tag must equal event pubkey",
            operation: "readTurnMetric",
          })
        )
      }

      // Verify the signature when the envelope is a fully signed event.
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
        const valid = yield* events.verifyEvent(signed).pipe(
          Effect.catch((error) =>
            Effect.fail(
              new AgentMetricsError({ message: error.message, operation: "readTurnMetric" })
            )
          )
        )
        if (!valid) {
          return yield* Effect.fail(
            new AgentMetricsError({
              message: "Invalid turn metric signature",
              operation: "readTurnMetric",
            })
          )
        }
      }

      const conversationKey = yield* nip44
        .getConversationKey(ownerPrivateKey, envelope.pubkey)
        .pipe(
          Effect.catch((error) =>
            Effect.fail(
              new AgentMetricsError({ message: error.message, operation: "readTurnMetric" })
            )
          )
        )

      const plaintext = yield* nip44
        .decrypt(envelope.content as EncryptedPayload, conversationKey)
        .pipe(
          Effect.catch((error) =>
            Effect.fail(
              new AgentMetricsError({ message: error.message, operation: "readTurnMetric" })
            )
          )
        )

      if (byteLength(plaintext) > MAX_DECRYPTED_PAYLOAD_BYTES) {
        return yield* Effect.fail(
          new AgentMetricsError({
            message: `Decrypted payload exceeds ${MAX_DECRYPTED_PAYLOAD_BYTES} bytes`,
            operation: "readTurnMetric",
          })
        )
      }

      return yield* Effect.try({
        try: () => turnMetricFromJson(plaintext),
        catch: (error) =>
          new AgentMetricsError({
            message: `Failed to parse decrypted turn metric: ${error instanceof Error ? error.message : String(error)}`,
            operation: "readTurnMetric",
          }),
      })
    })

  const subscriptionFilter: AgentMetricsService["subscriptionFilter"] = (ownPublicKey, since) =>
    buildTurnMetricFilter(ownPublicKey, since)

  return {
    _tag: "AgentMetricsService" as const,
    buildTurnMetric,
    readTurnMetric,
    subscriptionFilter,
  }
})

// =============================================================================
// Layer
// =============================================================================

/**
 * Fully-wired dependencies for the metrics service:
 * CryptoService, EventService (on Crypto), and Nip44Service.
 */
const DependenciesLive = Layer.mergeAll(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive)),
  Nip44ServiceLive
)

/**
 * Self-contained live layer. Provides {@link AgentMetricsService} with no
 * remaining requirements.
 */
export const AgentMetricsServiceLive = Layer.effect(AgentMetricsService, make).pipe(
  Layer.provide(DependenciesLive)
)
