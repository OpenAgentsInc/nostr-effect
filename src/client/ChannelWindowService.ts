/**
 * ChannelWindowService
 *
 * NIP-CW: Channel Window (buzz-parity draft).
 *
 * Client reader for relay-computed channel windows. A window request is a
 * standard NIP-01 filter plus extension fields (`top_level`, `before_id`,
 * `include_summaries`, `include_aux`). The response is a flat array of signed
 * events that the client partitions into:
 *
 * - **rows** — top-level channel events (count against `limit`)
 * - **aux** — reactions / deletions / edits targeting those rows (`include_aux`)
 * - **summaries** — relay-signed `kind:39005` thread summaries (`include_summaries`)
 * - **bounds** — exactly one relay-signed `kind:39006` with `has_more` / cursor
 *
 * This module implements the CLIENT protocol only: filter construction, payload
 * schemas, response partitioning, structural integrity checks, and optional
 * identity-verified overlay signature checks against the relay identity
 * (NIP-11 `self` / configured relay pubkey). It does not implement the relay
 * query engine.
 *
 * Kind collision note: upstream NIP-29 reuses `39005` for group pinned-events
 * lists. NIP-CW overlays are distinguished by tag cardinality and JSON content
 * shape (and by being signed by the relay identity).
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-CW.md
 */
import { Context, Effect, Layer, Schema } from "effect"
import { EventService } from "../services/EventService.js"
import type { NostrEvent } from "../core/Schema.js"
import {
  ChannelThreadSummary,
  ChannelWindowBounds,
} from "../wrappers/kinds.js"

// =============================================================================
// Constants
// =============================================================================

/**
 * Thread summary overlay (NIP-CW). One per returned row that has replies.
 * Parameterized-replaceable range; `d` = row event id.
 *
 * Note: NIP-29 also uses 39005 for group pinned-events lists.
 */
export const THREAD_SUMMARY_KIND = ChannelThreadSummary // 39005

/**
 * Window bounds overlay (NIP-CW). Exactly one per served window response.
 * Parameterized-replaceable; `d` binds the request cursor (`head` or `ts:id`).
 */
export const WINDOW_BOUNDS_KIND = ChannelWindowBounds // 39006

/** 64-character lowercase hex (event id / pubkey). */
const HEX64 = /^[0-9a-f]{64}$/

// =============================================================================
// Errors
// =============================================================================

/**
 * Failure channel for NIP-CW client operations.
 *
 * - `invalid_filter` — request params violate the window grammar
 * - `missing_bounds` — no `kind:39006` (access-scoped, unsupported, or degraded)
 * - `multiple_bounds` — more than one bounds overlay
 * - `bounds_binding_mismatch` — bounds `d` does not echo the request cursor
 * - `malformed_content` — overlay content is not parseable / wrong types
 * - `invariant_violation` — `has_more ⇔ next_cursor ≠ null` broken
 * - `malformed_tags` — overlay tag cardinality / values wrong
 * - `bad_signature` — id or Schnorr signature does not verify
 * - `wrong_signer` — overlay pubkey ≠ trusted relay identity
 */
export class ChannelWindowError extends Schema.TaggedErrorClass<ChannelWindowError>()(
  "ChannelWindowError",
  {
    reason: Schema.Literals([
      "invalid_filter",
      "missing_bounds",
      "multiple_bounds",
      "bounds_binding_mismatch",
      "malformed_content",
      "invariant_violation",
      "malformed_tags",
      "bad_signature",
      "wrong_signer",
    ]),
    message: Schema.String,
  }
) {}

const err = (
  reason: ChannelWindowError["reason"],
  message: string
): ChannelWindowError => new ChannelWindowError({ reason, message })

// =============================================================================
// Schemas / Types
// =============================================================================

/** Composite pagination cursor: `(created_at DESC, id ASC)` position. */
export const CompositeCursor = Schema.Struct({
  /** Unix seconds (non-negative integer). */
  created_at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** 64-character lowercase hex event id. */
  id: Schema.String.check(Schema.isPattern(HEX64)),
})
export type CompositeCursor = typeof CompositeCursor.Type

/**
 * `kind:39005` content body.
 * Unknown fields are tolerated (forward compatibility, e.g. future fields).
 */
export const ThreadSummaryContent = Schema.Struct({
  reply_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  descendant_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  last_reply_at: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  participants: Schema.Array(Schema.String),
})
export type ThreadSummaryContent = typeof ThreadSummaryContent.Type

/**
 * `kind:39006` content body.
 * `oldest_retained` is reserved by the spec; clients MUST ignore unknown fields.
 */
export const WindowBoundsContent = Schema.Struct({
  has_more: Schema.Boolean,
  next_cursor: Schema.NullOr(CompositeCursor),
})
export type WindowBoundsContent = typeof WindowBoundsContent.Type

const decodeThreadSummaryContent = Schema.decodeUnknownEffect(ThreadSummaryContent)
const decodeWindowBoundsContent = Schema.decodeUnknownEffect(WindowBoundsContent)
const decodeCompositeCursor = Schema.decodeUnknownEffect(CompositeCursor)

/** Extended window filter submitted wherever the relay accepts filters. */
export interface ChannelWindowFilter {
  readonly kinds?: readonly number[]
  /** Exactly one channel id (NIP-29 `h` tag). */
  readonly "#h": readonly [string]
  readonly limit?: number
  /** Selects the window path. MUST be boolean `true`. */
  readonly top_level: true
  readonly include_summaries?: true
  readonly include_aux?: true
  /** Composite request cursor — both present or both absent. */
  readonly until?: number
  readonly before_id?: string
}

/** Parameters for building a window filter. */
export interface BuildWindowFilterParams {
  readonly channelId: string
  /** Optional row-kind restriction (does not affect overlays / aux). */
  readonly kinds?: readonly number[]
  /** Row budget (rows only). */
  readonly limit?: number
  readonly includeSummaries?: boolean
  readonly includeAux?: boolean
  /**
   * Previous page's `next_cursor`, echoed as `until` + `before_id`.
   * Omit / null for a head-of-channel request.
   */
  readonly cursor?: CompositeCursor | null
}

/** Partition of a flat window response by role. */
export interface WindowPartition {
  readonly rows: readonly NostrEvent[]
  readonly aux: readonly NostrEvent[]
  readonly summaries: readonly NostrEvent[]
  readonly bounds: readonly NostrEvent[]
}

/** Parsed `kind:39005` thread summary. */
export interface ParsedThreadSummary {
  readonly event: NostrEvent
  /** Row event id (`e` and `d` tags). */
  readonly rowId: string
  readonly channelId: string
  readonly content: ThreadSummaryContent
}

/** Parsed `kind:39006` window bounds. */
export interface ParsedWindowBounds {
  readonly event: NostrEvent
  readonly channelId: string
  /** Request binding suffix: `head` or `<created_at>:<id>`. */
  readonly requestBinding: string
  readonly content: WindowBoundsContent
}

/** Fully validated window page ready for rendering / pagination. */
export interface ChannelWindowPage {
  readonly rows: readonly NostrEvent[]
  readonly aux: readonly NostrEvent[]
  readonly summaries: readonly ParsedThreadSummary[]
  readonly bounds: ParsedWindowBounds
  readonly hasMore: boolean
  readonly nextCursor: CompositeCursor | null
}

// =============================================================================
// Pure helpers — top-level classification (wire tags)
// =============================================================================

/**
 * True when the event carries a NIP-10 *marked* `e` tag with the `reply`
 * marker and a 64-hex parent id. Per NIP-CW this is the reply predicate.
 */
export const hasMarkedReplyTag = (event: {
  readonly tags: readonly (readonly string[])[]
}): boolean =>
  event.tags.some(
    (t) =>
      t[0] === "e" &&
      typeof t[1] === "string" &&
      HEX64.test(t[1]) &&
      t[3] === "reply"
  )

/** True when the event carries the exact tag `["broadcast", "1"]`. */
export const isBroadcast = (event: {
  readonly tags: readonly (readonly string[])[]
}): boolean =>
  event.tags.some((t) => t[0] === "broadcast" && t[1] === "1")

/**
 * Wire-level top-level eligibility without full ancestry depth.
 *
 * - no marked `reply` e-tag → depth 0 → top-level
 * - marked `reply` + `broadcast:1` → eligible as depth-1 broadcast (relay
 *   confirms actual depth; the client can only see the wire opt-in)
 * - marked `reply` without broadcast → not top-level
 */
export const isTopLevelByWire = (event: {
  readonly tags: readonly (readonly string[])[]
}): boolean => !hasMarkedReplyTag(event) || isBroadcast(event)

// =============================================================================
// Pure helpers — filter construction
// =============================================================================

/**
 * Canonical `d`-tag suffix for a window bounds overlay binding.
 * Head requests use the literal `head`; cursor pages use `<created_at>:<id>`.
 */
export const requestCursorBinding = (
  cursor: CompositeCursor | null | undefined
): string => {
  if (cursor == null) return "head"
  return `${cursor.created_at}:${cursor.id}`
}

/** Full `d` tag value for a `kind:39006` bounds overlay. */
export const boundsDTag = (
  channelId: string,
  cursor: CompositeCursor | null | undefined
): string => `${channelId}:${requestCursorBinding(cursor)}`

/**
 * Build a NIP-CW window filter. Validates the grammar (exactly one channel,
 * composite cursor both-or-neither, non-empty channel id).
 */
export const buildWindowFilter = (
  params: BuildWindowFilterParams
): Effect.Effect<ChannelWindowFilter, ChannelWindowError> =>
  Effect.gen(function* () {
    const channelId = params.channelId
    if (typeof channelId !== "string" || channelId.length === 0) {
      return yield* Effect.fail(
        err("invalid_filter", "channelId must be a non-empty string")
      )
    }

    if (params.limit !== undefined) {
      if (!Number.isInteger(params.limit) || params.limit < 1) {
        return yield* Effect.fail(
          err("invalid_filter", "limit must be an integer >= 1")
        )
      }
    }

    if (params.cursor != null) {
      const cursor = yield* decodeCompositeCursor(params.cursor).pipe(
        Effect.mapError((e) =>
          err("invalid_filter", `cursor is malformed: ${String(e)}`)
        )
      )
      const filter: ChannelWindowFilter = {
        "#h": [channelId],
        top_level: true,
        until: cursor.created_at,
        before_id: cursor.id,
        ...(params.kinds !== undefined && params.kinds.length > 0
          ? { kinds: [...params.kinds] }
          : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.includeSummaries === true ? { include_summaries: true as const } : {}),
        ...(params.includeAux === true ? { include_aux: true as const } : {}),
      }
      return filter
    }

    const filter: ChannelWindowFilter = {
      "#h": [channelId],
      top_level: true,
      ...(params.kinds !== undefined && params.kinds.length > 0
        ? { kinds: [...params.kinds] }
        : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
      ...(params.includeSummaries === true ? { include_summaries: true as const } : {}),
      ...(params.includeAux === true ? { include_aux: true as const } : {}),
    }
    return filter
  })

/**
 * Echo `next_cursor` from a previous page's bounds into a continuation filter.
 * Fails when `has_more` is false or `next_cursor` is null.
 */
export const continueWindowFilter = (
  previous: ChannelWindowFilter,
  bounds: WindowBoundsContent
): Effect.Effect<ChannelWindowFilter, ChannelWindowError> =>
  Effect.gen(function* () {
    if (!bounds.has_more || bounds.next_cursor == null) {
      return yield* Effect.fail(
        err(
          "invalid_filter",
          "cannot continue: bounds report has_more=false / next_cursor=null"
        )
      )
    }
    const channelId = previous["#h"][0]
    return yield* buildWindowFilter({
      channelId,
      ...(previous.kinds !== undefined ? { kinds: previous.kinds } : {}),
      ...(previous.limit !== undefined ? { limit: previous.limit } : {}),
      includeSummaries: previous.include_summaries === true,
      includeAux: previous.include_aux === true,
      cursor: bounds.next_cursor,
    })
  })

/**
 * Strip NIP-CW extension keys, leaving a standard NIP-01 filter for the
 * §Degradation fallback path.
 */
export const stripWindowExtensions = (
  filter: ChannelWindowFilter
): {
  readonly kinds?: readonly number[]
  readonly "#h": readonly [string]
  readonly limit?: number
  readonly until?: number
} => {
  const out: {
    kinds?: readonly number[]
    "#h": readonly [string]
    limit?: number
    until?: number
  } = { "#h": filter["#h"] }
  if (filter.kinds !== undefined) out.kinds = filter.kinds
  if (filter.limit !== undefined) out.limit = filter.limit
  if (filter.until !== undefined) out.until = filter.until
  return out
}

// =============================================================================
// Pure helpers — partition / parse
// =============================================================================

/**
 * Partition a flat window response by kind.
 *
 * Overlays are `39005` / `39006`. Everything else is either a row or aux;
 * without the request's `include_aux` flag the client cannot perfectly
 * separate aux from rows by kind alone, so non-overlay events are returned
 * as `rows` in arrival order and `aux` is empty. When `auxKinds` is provided,
 * matching kinds are moved into `aux`.
 *
 * Spec note: clients MUST partition by kind and MUST NOT rely on array
 * position beyond the ordering of rows.
 */
export const partitionWindowResponse = (
  events: readonly NostrEvent[],
  options?: {
    /** Kinds treated as aux (default: 7 reactions, 5/9005 deletions, 40003 edits). */
    readonly auxKinds?: readonly number[]
  }
): WindowPartition => {
  const auxKindSet = new Set(options?.auxKinds ?? [7, 5, 9005, 40003])
  const rows: NostrEvent[] = []
  const aux: NostrEvent[] = []
  const summaries: NostrEvent[] = []
  const bounds: NostrEvent[] = []

  for (const event of events) {
    if (event.kind === THREAD_SUMMARY_KIND) {
      summaries.push(event)
      continue
    }
    if (event.kind === WINDOW_BOUNDS_KIND) {
      bounds.push(event)
      continue
    }
    if (auxKindSet.has(event.kind)) {
      aux.push(event)
      continue
    }
    rows.push(event)
  }

  return { rows, aux, summaries, bounds }
}

const singleTagValue = (
  tags: readonly (readonly string[])[],
  name: string
): string | null => {
  const found = tags.filter((t) => t[0] === name)
  if (found.length !== 1) return null
  const value = found[0]?.[1]
  return typeof value === "string" && value.length > 0 ? value : null
}

const tagCount = (
  tags: readonly (readonly string[])[],
  name: string
): number => tags.filter((t) => t[0] === name).length

/**
 * Parse and structurally validate a `kind:39005` thread summary.
 * Does not verify the signature (see {@link verifyRelayOverlay}).
 */
export const parseThreadSummary = (
  event: NostrEvent
): Effect.Effect<ParsedThreadSummary, ChannelWindowError> =>
  Effect.gen(function* () {
    if (event.kind !== THREAD_SUMMARY_KIND) {
      return yield* Effect.fail(
        err(
          "malformed_tags",
          `expected kind ${THREAD_SUMMARY_KIND}, got ${event.kind}`
        )
      )
    }

    // Exact tag cardinality: one `e`, one `d`, one `h`, nothing else.
    if (event.tags.length !== 3) {
      return yield* Effect.fail(
        err(
          "malformed_tags",
          `thread summary must have exactly 3 tags (e, d, h), got ${event.tags.length}`
        )
      )
    }
    if (
      tagCount(event.tags, "e") !== 1 ||
      tagCount(event.tags, "d") !== 1 ||
      tagCount(event.tags, "h") !== 1
    ) {
      return yield* Effect.fail(
        err(
          "malformed_tags",
          "thread summary tags must be exactly one e, one d, and one h"
        )
      )
    }

    const e = singleTagValue(event.tags, "e")
    const d = singleTagValue(event.tags, "d")
    const h = singleTagValue(event.tags, "h")
    if (e == null || d == null || h == null) {
      return yield* Effect.fail(
        err("malformed_tags", "thread summary e/d/h tags must be non-empty")
      )
    }
    if (!HEX64.test(e) || !HEX64.test(d)) {
      return yield* Effect.fail(
        err("malformed_tags", "thread summary e and d must be 64-char lowercase hex")
      )
    }
    if (e !== d) {
      return yield* Effect.fail(
        err("malformed_tags", "thread summary e and d tags must both equal the row event id")
      )
    }

    const raw = yield* Effect.try({
      try: () => JSON.parse(event.content) as unknown,
      catch: (cause) =>
        err("malformed_content", `thread summary content is not JSON: ${String(cause)}`),
    })
    const content = yield* decodeThreadSummaryContent(raw).pipe(
      Effect.mapError((e) =>
        err("malformed_content", `thread summary content schema: ${String(e)}`)
      )
    )
    // Spec: participants up to 10. Harden by rejecting oversize lists.
    if (content.participants.length > 10) {
      return yield* Effect.fail(
        err(
          "malformed_content",
          `participants length ${content.participants.length} exceeds 10`
        )
      )
    }
    for (const pk of content.participants) {
      if (!HEX64.test(pk)) {
        return yield* Effect.fail(
          err(
            "malformed_content",
            "participants entries must be 64-char lowercase hex pubkeys"
          )
        )
      }
    }

    return {
      event,
      rowId: e,
      channelId: h,
      content,
    }
  })

/**
 * Parse and structurally validate a `kind:39006` window bounds overlay.
 * Checks tag cardinality, request binding, content schema, and the
 * `has_more ⇔ next_cursor ≠ null` invariant.
 */
export const parseWindowBounds = (
  event: NostrEvent,
  options: {
    readonly channelId: string
    /** Request cursor that produced this page; null/undefined = head. */
    readonly requestCursor?: CompositeCursor | null
  }
): Effect.Effect<ParsedWindowBounds, ChannelWindowError> =>
  Effect.gen(function* () {
    if (event.kind !== WINDOW_BOUNDS_KIND) {
      return yield* Effect.fail(
        err(
          "malformed_tags",
          `expected kind ${WINDOW_BOUNDS_KIND}, got ${event.kind}`
        )
      )
    }

    // Exact tag cardinality: one `d`, one `h`, nothing else.
    if (event.tags.length !== 2) {
      return yield* Effect.fail(
        err(
          "malformed_tags",
          `window bounds must have exactly 2 tags (d, h), got ${event.tags.length}`
        )
      )
    }
    if (tagCount(event.tags, "d") !== 1 || tagCount(event.tags, "h") !== 1) {
      return yield* Effect.fail(
        err("malformed_tags", "window bounds tags must be exactly one d and one h")
      )
    }

    const d = singleTagValue(event.tags, "d")
    const h = singleTagValue(event.tags, "h")
    if (d == null || h == null) {
      return yield* Effect.fail(
        err("malformed_tags", "window bounds d/h tags must be non-empty")
      )
    }
    if (h !== options.channelId) {
      return yield* Effect.fail(
        err(
          "bounds_binding_mismatch",
          `bounds h tag ${JSON.stringify(h)} does not match channel ${JSON.stringify(options.channelId)}`
        )
      )
    }

    const expectedD = boundsDTag(options.channelId, options.requestCursor)
    if (d !== expectedD) {
      return yield* Effect.fail(
        err(
          "bounds_binding_mismatch",
          `bounds d tag ${JSON.stringify(d)} does not match request binding ${JSON.stringify(expectedD)}`
        )
      )
    }

    const raw = yield* Effect.try({
      try: () => JSON.parse(event.content) as unknown,
      catch: (cause) =>
        err("malformed_content", `window bounds content is not JSON: ${String(cause)}`),
    })
    const content = yield* decodeWindowBoundsContent(raw).pipe(
      Effect.mapError((e) =>
        err("malformed_content", `window bounds content schema: ${String(e)}`)
      )
    )

    // Invariant: next_cursor = null ⇔ has_more = false
    const cursorIsNull = content.next_cursor == null
    if (content.has_more === cursorIsNull) {
      return yield* Effect.fail(
        err(
          "invariant_violation",
          `has_more=${content.has_more} is inconsistent with next_cursor=${content.next_cursor == null ? "null" : "present"}`
        )
      )
    }

    return {
      event,
      channelId: h,
      requestBinding: requestCursorBinding(options.requestCursor),
      content,
    }
  })

/**
 * Structural page read (authenticated-transport profile): partition, require
 * exactly one bounds overlay, parse summaries, enforce request binding.
 * Does not verify cryptographic signatures.
 */
export const readWindowPageStructural = (
  events: readonly NostrEvent[],
  options: {
    readonly channelId: string
    readonly requestCursor?: CompositeCursor | null
    readonly auxKinds?: readonly number[]
  }
): Effect.Effect<ChannelWindowPage, ChannelWindowError> =>
  Effect.gen(function* () {
    const partition = partitionWindowResponse(
      events,
      options.auxKinds !== undefined ? { auxKinds: options.auxKinds } : undefined
    )

    if (partition.bounds.length === 0) {
      return yield* Effect.fail(
        err(
          "missing_bounds",
          "window response has no kind:39006 bounds overlay (degrade or access-scoped)"
        )
      )
    }
    if (partition.bounds.length > 1) {
      return yield* Effect.fail(
        err(
          "multiple_bounds",
          `window response has ${partition.bounds.length} kind:39006 overlays; expected exactly one`
        )
      )
    }

    const bounds = yield* parseWindowBounds(partition.bounds[0]!, {
      channelId: options.channelId,
      ...(options.requestCursor !== undefined
        ? { requestCursor: options.requestCursor }
        : {}),
    })

    const summaries: ParsedThreadSummary[] = []
    for (const summaryEvent of partition.summaries) {
      const parsed = yield* parseThreadSummary(summaryEvent)
      if (parsed.channelId !== options.channelId) {
        return yield* Effect.fail(
          err(
            "malformed_tags",
            `thread summary channel ${JSON.stringify(parsed.channelId)} does not match request`
          )
        )
      }
      summaries.push(parsed)
    }

    return {
      rows: partition.rows,
      aux: partition.aux,
      summaries,
      bounds,
      hasMore: bounds.content.has_more,
      nextCursor: bounds.content.next_cursor,
    }
  })

// =============================================================================
// Service Interface
// =============================================================================

export interface ChannelWindowService {
  readonly _tag: "ChannelWindowService"

  /** Build an extended NIP-CW window filter. */
  buildFilter(
    params: BuildWindowFilterParams
  ): Effect.Effect<ChannelWindowFilter, ChannelWindowError>

  /**
   * Continue paging from a previous filter using bounds content.
   * Requires `has_more` and a non-null `next_cursor`.
   */
  continueFilter(
    previous: ChannelWindowFilter,
    bounds: WindowBoundsContent
  ): Effect.Effect<ChannelWindowFilter, ChannelWindowError>

  /** Partition a flat response into rows / aux / summaries / bounds. */
  partition(
    events: readonly NostrEvent[],
    options?: { readonly auxKinds?: readonly number[] }
  ): WindowPartition

  /** Parse a `kind:39005` overlay (structure only). */
  parseThreadSummary(
    event: NostrEvent
  ): Effect.Effect<ParsedThreadSummary, ChannelWindowError>

  /** Parse a `kind:39006` overlay bound to a request cursor (structure only). */
  parseWindowBounds(
    event: NostrEvent,
    options: {
      readonly channelId: string
      readonly requestCursor?: CompositeCursor | null
    }
  ): Effect.Effect<ParsedWindowBounds, ChannelWindowError>

  /**
   * Identity-verified profile: recompute event id, verify Schnorr signature,
   * and require `event.pubkey === relayIdentityPubkey` (NIP-11 `self` or an
   * out-of-band trusted relay key). Failures are a page discard.
   */
  verifyRelayOverlay(
    event: NostrEvent,
    relayIdentityPubkey: string
  ): Effect.Effect<true, ChannelWindowError>

  /**
   * Read a full window page from a flat event array.
   *
   * Always applies structural integrity checks. When `relayIdentityPubkey` is
   * provided, also verifies every overlay under the identity-verified trust
   * profile.
   */
  readPage(params: {
    readonly events: readonly NostrEvent[]
    readonly channelId: string
    readonly requestCursor?: CompositeCursor | null
    readonly relayIdentityPubkey?: string
    readonly auxKinds?: readonly number[]
  }): Effect.Effect<ChannelWindowPage, ChannelWindowError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const ChannelWindowService =
  Context.Service<ChannelWindowService>("ChannelWindowService")

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const events = yield* EventService

  const verifyRelayOverlay: ChannelWindowService["verifyRelayOverlay"] = (
    event,
    relayIdentityPubkey
  ) =>
    Effect.gen(function* () {
      if (!HEX64.test(relayIdentityPubkey)) {
        return yield* Effect.fail(
          err(
            "wrong_signer",
            "relay identity pubkey must be 64-character lowercase hex"
          )
        )
      }
      if (event.pubkey !== relayIdentityPubkey) {
        return yield* Effect.fail(
          err(
            "wrong_signer",
            `overlay pubkey ${event.pubkey} does not match relay identity ${relayIdentityPubkey}`
          )
        )
      }
      if (
        event.kind !== THREAD_SUMMARY_KIND &&
        event.kind !== WINDOW_BOUNDS_KIND
      ) {
        return yield* Effect.fail(
          err(
            "malformed_tags",
            `verifyRelayOverlay expects kind ${THREAD_SUMMARY_KIND} or ${WINDOW_BOUNDS_KIND}, got ${event.kind}`
          )
        )
      }

      const ok = yield* events.verifyEvent(event).pipe(
        Effect.mapError((e) =>
          err("bad_signature", `overlay verification errored: ${String(e)}`)
        )
      )
      if (!ok) {
        return yield* Effect.fail(
          err("bad_signature", "overlay event id or signature does not verify")
        )
      }
      return true as const
    })

  const readPage: ChannelWindowService["readPage"] = (params) =>
    Effect.gen(function* () {
      const page = yield* readWindowPageStructural(params.events, {
        channelId: params.channelId,
        ...(params.requestCursor !== undefined
          ? { requestCursor: params.requestCursor }
          : {}),
        ...(params.auxKinds !== undefined ? { auxKinds: params.auxKinds } : {}),
      })

      if (params.relayIdentityPubkey !== undefined) {
        yield* verifyRelayOverlay(
          page.bounds.event,
          params.relayIdentityPubkey
        )
        for (const summary of page.summaries) {
          yield* verifyRelayOverlay(summary.event, params.relayIdentityPubkey)
        }
      }

      return page
    })

  return {
    _tag: "ChannelWindowService" as const,
    buildFilter: buildWindowFilter,
    continueFilter: continueWindowFilter,
    partition: partitionWindowResponse,
    parseThreadSummary,
    parseWindowBounds,
    verifyRelayOverlay,
    readPage,
  } satisfies ChannelWindowService
})

// =============================================================================
// Service Layer
// =============================================================================

export const ChannelWindowServiceLive = Layer.effect(ChannelWindowService, make)
