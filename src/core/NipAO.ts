/**
 * NIP-AO: Agent Observability
 *
 * Ephemeral, encrypted event kind for streaming internal agent-session
 * telemetry and control frames between an AI agent process and its owner's
 * client, over Nostr relays.
 *
 * Kind 24200 is in the ephemeral range (20000-29999) defined by NIP-01, so
 * relays MUST NOT persist it. All `content` fields are encrypted with NIP-44
 * v2, bidirectionally between the agent and the owner. Frames MAY additionally
 * be wrapped in a NIP-59 gift wrap for metadata privacy.
 *
 * This module is the pure protocol layer (kind, tags, and decrypted-payload
 * schemas plus codecs). Higher layers (for example NIP-AM) build on these
 * types. See {@link AgentObservabilityService} for the Effect service that
 * signs, encrypts, reads, and optionally gift-wraps these frames.
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-AO.md (canonical spec)
 */
import { Schema } from "effect"
import { EventKind, type PublicKey, type Tag } from "./Schema.js"

// =============================================================================
// Kind Constant
// =============================================================================

/** Kind 24200: Agent Observer Frame (ephemeral, agent<->owner, both directions) */
export const OBSERVER_FRAME_KIND = 24200 as EventKind

/**
 * Maximum size of a decrypted observability payload, in bytes.
 * The spec forbids decrypted payloads larger than this.
 */
export const MAX_DECRYPTED_PAYLOAD_BYTES = 65535

// =============================================================================
// Frame Direction (the `frame` tag)
// =============================================================================

/**
 * The `frame` tag value.
 *
 * - `telemetry`: agent -> owner. `pubkey`=agent, `p`=owner, `agent`=agent.
 * - `control`: owner -> agent. `pubkey`=owner, `p`=agent, `agent`=agent (target).
 */
export const ObserverFrameDirection = Schema.Literals(["telemetry", "control"])
export type ObserverFrameDirection = typeof ObserverFrameDirection.Type

// =============================================================================
// Telemetry Payload (frame=telemetry)
// =============================================================================

/** Known telemetry frame `kind` values. Unknown values MUST be ignored. */
export const KNOWN_OBSERVER_EVENT_KINDS = [
  "acp_read",
  "acp_write",
  "turn_started",
  "session_resolved",
] as const

export type KnownObserverEventKind = (typeof KNOWN_OBSERVER_EVENT_KINDS)[number]

/** Returns true when `kind` is a frame kind this library knows about. */
export const isKnownObserverEventKind = (kind: string): kind is KnownObserverEventKind =>
  (KNOWN_OBSERVER_EVENT_KINDS as readonly string[]).includes(kind)

/**
 * Decrypted telemetry payload (`frame=telemetry`).
 *
 * `seq`, `timestamp`, `kind`, and `payload` are REQUIRED. `agentIndex`,
 * `channelId`, `sessionId`, and `turnId` are OPTIONAL and MAY be `null` when
 * the value is not yet known. `kind` is left open (a plain string) so unknown
 * future frame kinds decode cleanly and can be ignored by the reader.
 */
export const ObserverEvent = Schema.Struct({
  /** Monotonically increasing per session; used for drop detection. */
  seq: Schema.Int,
  /** RFC 3339 datetime string with sub-second precision. */
  timestamp: Schema.String,
  /** Frame kind (see {@link KNOWN_OBSERVER_EVENT_KINDS}); open for forward compat. */
  kind: Schema.String,
  /** Agent index in multi-agent scenarios. */
  agentIndex: Schema.optional(Schema.NullOr(Schema.Int)),
  /** Channel correlation UUID. */
  channelId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Session correlation id. */
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Turn correlation id. */
  turnId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Kind-specific payload; MAY be `{}`. */
  payload: Schema.Record(Schema.String, Schema.Unknown),
})
export type ObserverEvent = typeof ObserverEvent.Type

// =============================================================================
// Control Payload (frame=control)
// =============================================================================

/** The only defined control type. Unknown types MUST be ignored. */
export const CONTROL_TYPE_CANCEL_TURN = "cancel_turn"

/**
 * Decrypted control payload (`frame=control`).
 *
 * `type` is left open (a plain string) so unrecognized future control types
 * decode cleanly and can be ignored by the reader. `channelId` is present for
 * the defined `cancel_turn` type.
 */
export const ControlMessage = Schema.Struct({
  /** Control type; the only defined value is {@link CONTROL_TYPE_CANCEL_TURN}. */
  type: Schema.String,
  /** Target channel UUID. */
  channelId: Schema.optional(Schema.String),
})
export type ControlMessage = typeof ControlMessage.Type

// =============================================================================
// Parsed Frame (discriminated on direction)
// =============================================================================

/** A decrypted and parsed observability frame, discriminated on `direction`. */
export type ObserverFramePayload =
  | { readonly direction: "telemetry"; readonly event: ObserverEvent }
  | { readonly direction: "control"; readonly message: ControlMessage }

// =============================================================================
// Codecs (JSON <-> typed payload)
// =============================================================================

const decodeObserverEventUnknown = Schema.decodeUnknownSync(ObserverEvent)
const encodeObserverEvent = Schema.encodeSync(ObserverEvent)
const decodeControlMessageUnknown = Schema.decodeUnknownSync(ControlMessage)
const encodeControlMessage = Schema.encodeSync(ControlMessage)

/** Serialize a telemetry {@link ObserverEvent} to the plaintext JSON string. */
export const observerEventToJson = (event: ObserverEvent): string =>
  JSON.stringify(encodeObserverEvent(event))

/** Parse a decrypted telemetry plaintext JSON string into an {@link ObserverEvent}. */
export const observerEventFromJson = (json: string): ObserverEvent =>
  decodeObserverEventUnknown(JSON.parse(json))

/** Serialize a {@link ControlMessage} to the plaintext JSON string. */
export const controlMessageToJson = (message: ControlMessage): string =>
  JSON.stringify(encodeControlMessage(message))

/** Parse a decrypted control plaintext JSON string into a {@link ControlMessage}. */
export const controlMessageFromJson = (json: string): ControlMessage =>
  decodeControlMessageUnknown(JSON.parse(json))

// =============================================================================
// Tags
// =============================================================================

/** Parsed routing tags of a kind 24200 event. */
export interface ObserverFrameTags {
  /** Recipient pubkey (`p` tag): owner for telemetry, agent for control. */
  readonly recipient: PublicKey
  /** Agent pubkey (`agent` tag). */
  readonly agent: PublicKey
  /** Frame direction (`frame` tag). */
  readonly direction: ObserverFrameDirection
  /** Optional NIP-29 group id (`h` tag). */
  readonly groupId?: string
}

/**
 * Build the tag list for a kind 24200 event.
 * Produces exactly one `p`, one `agent`, and one `frame` tag, plus an optional
 * `h` tag when the session runs inside a NIP-29 group context.
 */
export const buildObserverFrameTags = (params: ObserverFrameTags): Tag[] => {
  const tags: string[][] = [
    ["p", params.recipient],
    ["agent", params.agent],
    ["frame", params.direction],
  ]
  if (params.groupId !== undefined) {
    tags.push(["h", params.groupId])
  }
  return tags as unknown as Tag[]
}

/**
 * Parse and validate the routing tags of a kind 24200 event.
 * Returns `null` when the event does not have exactly one `p`, one `agent`,
 * and one recognized `frame` tag.
 */
export const parseObserverFrameTags = (
  tags: readonly (readonly string[])[]
): ObserverFrameTags | null => {
  const pTags = tags.filter((t) => t[0] === "p")
  const agentTags = tags.filter((t) => t[0] === "agent")
  const frameTags = tags.filter((t) => t[0] === "frame")

  if (pTags.length !== 1 || agentTags.length !== 1 || frameTags.length !== 1) {
    return null
  }

  const recipient = pTags[0]![1]
  const agent = agentTags[0]![1]
  const direction = frameTags[0]![1]

  if (recipient === undefined || agent === undefined) return null
  if (direction !== "telemetry" && direction !== "control") return null

  const hTag = tags.find((t) => t[0] === "h")
  const groupId = hTag?.[1]

  return {
    recipient: recipient as PublicKey,
    agent: agent as PublicKey,
    direction,
    ...(groupId !== undefined ? { groupId } : {}),
  }
}

// =============================================================================
// Subscription Filter
// =============================================================================

/** Recommended subscription filter shape for receiving observer frames. */
export interface ObserverFrameFilter {
  readonly kinds: readonly number[]
  readonly "#p": readonly string[]
  readonly since: number
}

/**
 * Build the recommended live subscription filter.
 * Clients subscribe with `{kinds:[24200], "#p":[own], since:<now>}` and MUST
 * NOT request historical frames (no past `since`, no `until`, no `ids`).
 */
export const buildObserverFrameFilter = (
  ownPublicKey: PublicKey,
  since: number = Math.floor(Date.now() / 1000)
): ObserverFrameFilter => ({
  kinds: [OBSERVER_FRAME_KIND as unknown as number],
  "#p": [ownPublicKey],
  since,
})
