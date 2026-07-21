/**
 * NIP-AM: Agent Turn Metrics
 *
 * Durable, encrypted event kind for recording per-turn token usage and
 * estimated cost of AI agent sessions. An agent publishes one kind 44200
 * event per completed turn, NIP-44 encrypted to its owner.
 *
 * Kind 44200 is a regular (append-only, never replaced) event. Tags mirror
 * NIP-AO telemetry frames (`p` = owner, `agent` = agent pubkey) so existing
 * owner-scoped tooling applies unchanged. There is no channel (`h`) tag —
 * channel correlation lives inside the encrypted payload.
 *
 * This module is the pure protocol layer (kind, tags, and decrypted-payload
 * schemas plus codecs). See {@link AgentMetricsService} for the Effect
 * service that signs, encrypts, and reads these events.
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-AM.md (canonical spec)
 */
import { Schema } from "effect"
import { EventKind, type PublicKey, type Tag } from "./Schema.js"

// =============================================================================
// Kind Constant
// =============================================================================

/** Kind 44200: Agent Turn Metric (regular, append-only, agent -> owner) */
export const TURN_METRIC_KIND = 44200 as EventKind

/**
 * Maximum size of a decrypted metrics payload, in bytes.
 * The spec forbids decrypted payloads larger than this.
 */
export const MAX_DECRYPTED_PAYLOAD_BYTES = 65535

// =============================================================================
// Known stopReason values
// =============================================================================

/**
 * Known `stopReason` values. Consumers MUST treat unrecognized values as
 * `"unknown"`; the token counts remain valid either way.
 */
export const KNOWN_STOP_REASONS = [
  "end_turn",
  "max_tokens",
  "cancelled",
  "error",
  "unknown",
] as const

export type KnownStopReason = (typeof KNOWN_STOP_REASONS)[number]

/** Map an arbitrary stopReason string to a known value (unrecognized -> "unknown"). */
export const normalizeStopReason = (value: string | undefined): KnownStopReason | undefined => {
  if (value === undefined) return undefined
  return (KNOWN_STOP_REASONS as readonly string[]).includes(value)
    ? (value as KnownStopReason)
    : "unknown"
}

// =============================================================================
// Token usage object (turn / cumulative)
// =============================================================================

/**
 * Non-negative integer token count. A null MUST NOT be recorded or summed as
 * zero — it means "unknown / not reported".
 */
const NonNegInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Finite non-negative number for estimated cost in USD. Advisory, not a
 * billing record.
 */
const NonNegCost = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Usage counters for either the current turn (`turn`) or the session so far
 * (`cumulative`). All fields are nullable/optional; null means unknown.
 *
 * `cacheReadTokens` / `cacheWriteTokens` are optional informational subsets
 * of `inputTokens`, not additions to it.
 *
 * Unknown fields are ignored on decode (forward compatibility).
 */
export const TokenUsage = Schema.Struct({
  inputTokens: Schema.optional(Schema.NullOr(NonNegInt)),
  outputTokens: Schema.optional(Schema.NullOr(NonNegInt)),
  totalTokens: Schema.optional(Schema.NullOr(NonNegInt)),
  costUsd: Schema.optional(Schema.NullOr(NonNegCost)),
  cacheReadTokens: Schema.optional(Schema.NullOr(NonNegInt)),
  cacheWriteTokens: Schema.optional(Schema.NullOr(NonNegInt)),
})
export type TokenUsage = typeof TokenUsage.Type

// =============================================================================
// Turn metric payload
// =============================================================================

/**
 * Decrypted kind 44200 payload.
 *
 * `harness` and `timestamp` are REQUIRED. All other fields are OPTIONAL or
 * nullable. When `cumulative` is present, `sessionId` and `turnSeq` are
 * REQUIRED (enforced by {@link turnMetricFromJson} / {@link validateTurnMetric}).
 * `stopReason` is left open (plain string) so unrecognized future values
 * decode cleanly; use {@link normalizeStopReason} at the consumer edge.
 *
 * Unknown fields are ignored on decode (forward compatibility).
 */
export const TurnMetric = Schema.Struct({
  /** Harness identifier (e.g. `"goose"`). */
  harness: Schema.String,
  /** Model id, or null if unknown. */
  model: Schema.optional(Schema.NullOr(Schema.String)),
  /** Channel correlation UUID. */
  channelId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Session correlation id. REQUIRED when `cumulative` is present. */
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Turn correlation id. */
  turnId: Schema.optional(Schema.NullOr(Schema.String)),
  /**
   * Per-session monotonically increasing integer. REQUIRED when `cumulative`
   * is present. Ordering within a session uses `(sessionId, turnSeq)`.
   */
  turnSeq: Schema.optional(Schema.NullOr(Schema.Int)),
  /** RFC 3339 datetime string (end of turn). */
  timestamp: Schema.String,
  /** Usage for THIS turn (computed delta). */
  turn: Schema.optional(TokenUsage),
  /** Session-cumulative usage as reported at the end of this turn. */
  cumulative: Schema.optional(TokenUsage),
  /**
   * `false` when the publisher could not observe the previous turn's
   * cumulative baseline, making the `turn` object unreliable for this event.
   */
  deltaReliable: Schema.optional(Schema.Boolean),
  /**
   * Why the turn ended. Known values: {@link KNOWN_STOP_REASONS}. Open for
   * forward compatibility — treat unrecognized as `"unknown"`.
   */
  stopReason: Schema.optional(Schema.String),
})
export type TurnMetric = typeof TurnMetric.Type

// =============================================================================
// Codecs (JSON <-> typed payload)
// =============================================================================

const decodeTurnMetricUnknown = Schema.decodeUnknownSync(TurnMetric)
const encodeTurnMetric = Schema.encodeSync(TurnMetric)

/**
 * Validate the NIP-AM structural constraints beyond the schema shape.
 * When `cumulative` is present, `sessionId` and `turnSeq` must both be set
 * (non-null). Throws a descriptive `Error` on violation.
 */
export const validateTurnMetric = (metric: TurnMetric): void => {
  if (metric.cumulative !== undefined) {
    if (metric.sessionId === undefined || metric.sessionId === null) {
      throw new Error("sessionId is required when cumulative is present")
    }
    if (metric.turnSeq === undefined || metric.turnSeq === null) {
      throw new Error("turnSeq is required when cumulative is present")
    }
  }
}

/** Serialize a {@link TurnMetric} to the plaintext JSON string. */
export const turnMetricToJson = (metric: TurnMetric): string => {
  validateTurnMetric(metric)
  return JSON.stringify(encodeTurnMetric(metric))
}

/** Parse a decrypted plaintext JSON string into a {@link TurnMetric}. */
export const turnMetricFromJson = (json: string): TurnMetric => {
  const metric = decodeTurnMetricUnknown(JSON.parse(json))
  validateTurnMetric(metric)
  return metric
}

// =============================================================================
// Tags
// =============================================================================

/** Parsed routing tags of a kind 44200 event. */
export interface TurnMetricTags {
  /** Owner pubkey (`p` tag). */
  readonly owner: PublicKey
  /** Agent pubkey (`agent` tag; MUST equal event.pubkey). */
  readonly agent: PublicKey
}

/**
 * Build the tag list for a kind 44200 event.
 * Produces exactly one `p` (owner) and one `agent` tag. Mirrors the NIP-AO
 * telemetry tag layout minus the `frame` tag (metrics are always agent->owner).
 */
export const buildTurnMetricTags = (params: TurnMetricTags): Tag[] => {
  const tags: string[][] = [
    ["p", params.owner],
    ["agent", params.agent],
  ]
  return tags as unknown as Tag[]
}

/**
 * Parse and validate the routing tags of a kind 44200 event.
 * Returns `null` when the event does not have exactly one `p` and one `agent`
 * tag.
 */
export const parseTurnMetricTags = (
  tags: readonly (readonly string[])[]
): TurnMetricTags | null => {
  const pTags = tags.filter((t) => t[0] === "p")
  const agentTags = tags.filter((t) => t[0] === "agent")

  if (pTags.length !== 1 || agentTags.length !== 1) {
    return null
  }

  const owner = pTags[0]![1]
  const agent = agentTags[0]![1]

  if (owner === undefined || agent === undefined) return null
  if (owner.length === 0 || agent.length === 0) return null

  return {
    owner: owner as PublicKey,
    agent: agent as PublicKey,
  }
}

// =============================================================================
// Subscription Filter
// =============================================================================

/** Recommended subscription filter shape for recovering usage history. */
export interface TurnMetricFilter {
  readonly kinds: readonly number[]
  readonly "#p": readonly string[]
  readonly since?: number
}

/**
 * Build the recommended owner-scoped recovery filter.
 * Clients query with `{kinds:[44200], "#p":[own], since?: <window_start>}`.
 */
export const buildTurnMetricFilter = (
  ownPublicKey: PublicKey,
  since?: number
): TurnMetricFilter => ({
  kinds: [TURN_METRIC_KIND as unknown as number],
  "#p": [ownPublicKey],
  ...(since !== undefined ? { since } : {}),
})
