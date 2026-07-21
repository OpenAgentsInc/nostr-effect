/**
 * DmVisibilityService
 *
 * NIP-DV: DM Visibility
 *
 * Client verifying reader for the relay-signed `kind:30622` DM visibility
 * snapshot. The snapshot is a per-viewer, parameterized-replaceable projection
 * of the currently-hidden DM set, signed by the relay identity advertised in
 * NIP-11 `self`.
 *
 * This module does **not** derive hide state from DM commands (`kind:41012` /
 * `kind:41010`); that is a relay-side post-commit side effect. Clients:
 *
 * 1. Query their own latest snapshot: `kinds: [30622]`, `#p: [<my-pubkey>]`, `limit: 1`
 * 2. Verify the event is signed by the relay identity before trusting it
 * 3. Collect `h` tag values as the hidden-DM channel id set
 * 4. Filter the conversation list (usually rebuilt from NIP-29 `kind:39002`) against that set
 *
 * A missing or invalid snapshot means the hidden set is empty.
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-DV.md
 */
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { RelayService } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import {
  EventKind,
  Filter,
  Tag,
  type NostrEvent,
  type PrivateKey,
  type PublicKey,
} from "../core/Schema.js"
import { DmVisibilitySnapshot } from "../wrappers/kinds.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

// =============================================================================
// Constants
// =============================================================================

/** Relay-signed DM visibility snapshot kind (NIP-DV). Parameterized-replaceable. */
export const DM_VISIBILITY_SNAPSHOT_KIND = DmVisibilitySnapshot // 30622

/** Alias matching the NIP kind table name. */
export const KIND_DM_VISIBILITY_SNAPSHOT = DM_VISIBILITY_SNAPSHOT_KIND

/** 64-char lowercase hex (pubkey or channel id). */
const HEX64 = /^[0-9a-f]{64}$/

// =============================================================================
// Errors
// =============================================================================

/**
 * Failure while parsing or verifying a NIP-DV visibility snapshot.
 *
 * - `wrong_kind`: event is not kind 30622
 * - `malformed`: missing/invalid `d`/`p` tags or non-hex values
 * - `relay_mismatch`: event.pubkey is not the expected relay identity
 * - `bad_signature`: NIP-01 id/sig verification failed
 */
export class DmVisibilityError extends Schema.TaggedErrorClass<DmVisibilityError>()(
  "DmVisibilityError",
  {
    reason: Schema.Literals([
      "wrong_kind",
      "malformed",
      "relay_mismatch",
      "bad_signature",
    ]),
    message: Schema.String,
  }
) {}

const wrongKind = (message: string): DmVisibilityError =>
  new DmVisibilityError({ reason: "wrong_kind", message })

const malformed = (message: string): DmVisibilityError =>
  new DmVisibilityError({ reason: "malformed", message })

const relayMismatch = (message: string): DmVisibilityError =>
  new DmVisibilityError({ reason: "relay_mismatch", message })

const badSignature = (message: string): DmVisibilityError =>
  new DmVisibilityError({ reason: "bad_signature", message })

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed projection of a valid `kind:30622` snapshot.
 *
 * `hiddenChannelIds` is a set: order of `h` tags is not significant.
 */
export interface VisibilitySnapshot {
  /** The original event. */
  readonly event: NostrEvent
  /** Viewer pubkey (`d` / `p` tag value). */
  readonly viewerPubkey: string
  /** Relay identity that signed the snapshot (`event.pubkey`). */
  readonly relayPubkey: string
  /** DM channel ids currently hidden by the viewer. */
  readonly hiddenChannelIds: ReadonlySet<string>
}

/** Inputs for building (or signing) a snapshot event. */
export interface BuildVisibilitySnapshotParams {
  /** Viewer whose hide state this snapshot describes (64-char hex pubkey). */
  readonly viewerPubkey: string
  /** Zero or more DM channel ids the viewer currently has hidden. */
  readonly hiddenChannelIds?: readonly string[]
  /** Override `created_at` (unix seconds). Defaults to now when signing. */
  readonly createdAt?: number
}

// =============================================================================
// Pure helpers
// =============================================================================

/** True when `value` is a 64-character lowercase hex string. */
export const isHex64 = (value: string): boolean => HEX64.test(value)

/**
 * Build the tag set for a `kind:30622` snapshot.
 *
 * Emits exactly one `d` and one `p` (both = viewer), then one `h` per hidden
 * channel. Duplicate channel ids are de-duplicated. Content is always empty.
 */
export const buildVisibilitySnapshotTags = (
  viewerPubkey: string,
  hiddenChannelIds: readonly string[] = []
): string[][] => {
  const tags: string[][] = [
    ["d", viewerPubkey],
    ["p", viewerPubkey],
  ]
  const seen = new Set<string>()
  for (const id of hiddenChannelIds) {
    if (seen.has(id)) continue
    seen.add(id)
    tags.push(["h", id])
  }
  return tags
}

/**
 * Build unsigned event fields for a relay-signed snapshot (pure helper).
 * The relay identity must sign; clients MUST NOT publish this kind.
 */
export const buildVisibilitySnapshotParams = (
  params: BuildVisibilitySnapshotParams
): { kind: number; content: string; tags: string[][] } => ({
  kind: DM_VISIBILITY_SNAPSHOT_KIND,
  content: "",
  tags: buildVisibilitySnapshotTags(
    params.viewerPubkey,
    params.hiddenChannelIds ?? []
  ),
})

/**
 * Client query filter for the viewer's latest snapshot.
 * Keyed by `#p` (not `#d`) so read-authorization gates that check `#p` succeed.
 */
export const buildVisibilitySnapshotFilter = (
  viewerPubkey: string,
  limit = 1
): Filter =>
  decodeFilter({
    kinds: [decodeKind(DM_VISIBILITY_SNAPSHOT_KIND)],
    "#p": [viewerPubkey],
    limit,
  } as never)

/**
 * Extract a single required tag value of the given name.
 * Returns null when the tag is missing or has no value.
 */
const firstTagValue = (event: NostrEvent, name: string): string | null => {
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === "string" && tag[1].length > 0) {
      return tag[1]
    }
  }
  return null
}

/**
 * Collect all `h` tag values as a set (order insignificant; duplicates collapse).
 */
export const collectHiddenChannelIds = (
  event: NostrEvent
): ReadonlySet<string> => {
  const out = new Set<string>()
  for (const tag of event.tags) {
    if (tag[0] === "h" && typeof tag[1] === "string" && tag[1].length > 0) {
      out.add(tag[1])
    }
  }
  return out
}

/**
 * Parse a `kind:30622` event into a visibility projection without signature
 * verification. Use {@link verifyRelaySignedSnapshot} or the service
 * `readSnapshot` method when the event must be trusted.
 */
export const parseVisibilitySnapshot = (
  event: NostrEvent
): Effect.Effect<VisibilitySnapshot, DmVisibilityError> =>
  Effect.gen(function* () {
    if ((event.kind as number) !== DM_VISIBILITY_SNAPSHOT_KIND) {
      return yield* Effect.fail(
        wrongKind(
          `expected kind ${DM_VISIBILITY_SNAPSHOT_KIND}, got ${event.kind as number}`
        )
      )
    }

    const d = firstTagValue(event, "d")
    if (d === null || !isHex64(d)) {
      return yield* Effect.fail(
        malformed("kind 30622 requires exactly one d tag with a 64-char hex viewer pubkey")
      )
    }

    const p = firstTagValue(event, "p")
    if (p === null || !isHex64(p)) {
      return yield* Effect.fail(
        malformed("kind 30622 requires exactly one p tag with a 64-char hex viewer pubkey")
      )
    }

    if (d !== p) {
      return yield* Effect.fail(
        malformed(`kind 30622 d (${d}) and p (${p}) tags must be equal`)
      )
    }

    if (!isHex64(event.pubkey)) {
      return yield* Effect.fail(malformed("event.pubkey must be a 64-char hex relay identity"))
    }

    // Content carries no meaning; do not parse it.

    return {
      event,
      viewerPubkey: d,
      relayPubkey: event.pubkey,
      hiddenChannelIds: collectHiddenChannelIds(event),
    } satisfies VisibilitySnapshot
  })

/**
 * True when `channelId` is listed as hidden in the snapshot.
 */
export const isDmHidden = (
  channelId: string,
  snapshot: Pick<VisibilitySnapshot, "hiddenChannelIds"> | null | undefined
): boolean => {
  if (!snapshot) return false
  return snapshot.hiddenChannelIds.has(channelId)
}

/**
 * Drop channel ids that appear in the snapshot's hidden set.
 * Non-DM channels are the caller's responsibility; this only filters by id set.
 */
export const filterVisibleDmChannels = <T extends string>(
  channelIds: readonly T[],
  snapshot: Pick<VisibilitySnapshot, "hiddenChannelIds"> | null | undefined
): T[] => {
  if (!snapshot || snapshot.hiddenChannelIds.size === 0) {
    return channelIds.slice() as T[]
  }
  return channelIds.filter((id) => !snapshot.hiddenChannelIds.has(id))
}

// =============================================================================
// Service interface
// =============================================================================

export interface DmVisibilityService {
  readonly _tag: "DmVisibilityService"

  /**
   * Parse a 30622 event into a projection (no signature check).
   */
  parseSnapshot(
    event: NostrEvent
  ): Effect.Effect<VisibilitySnapshot, DmVisibilityError>

  /**
   * Verify NIP-01 id+sig and that `event.pubkey` equals `relayIdentity`
   * (NIP-11 `self`). Returns false for failed crypto without failing the effect;
   * fails with `DmVisibilityError` only when the pubkey mismatches after a
   * successful structural check is requested via `readSnapshot`.
   */
  verifyRelaySignature(
    event: NostrEvent,
    relayIdentity: string
  ): Effect.Effect<boolean, never>

  /**
   * Parse + require against `relayIdentity`. Returns the projection when valid;
   * fails with a typed `DmVisibilityError` when kind/tags/signature/identity
   * are wrong.
   */
  readSnapshot(
    event: NostrEvent,
    relayIdentity: string
  ): Effect.Effect<VisibilitySnapshot, DmVisibilityError>

  /**
   * Query the viewer's latest snapshot from the connected relay.
   * When `relayIdentity` is provided, the result is verified; invalid snapshots
   * are ignored (treated as missing). Missing snapshot → `null` (empty hide set).
   */
  getSnapshot(params: {
    readonly viewerPubkey: string
    readonly relayIdentity?: string
    readonly timeoutMs?: number
  }): Effect.Effect<VisibilitySnapshot | null, RelayError | DmVisibilityError>

  /**
   * Convenience: return the hidden channel id set for a viewer, or an empty
   * set when no valid snapshot exists.
   */
  getHiddenChannelIds(params: {
    readonly viewerPubkey: string
    readonly relayIdentity?: string
    readonly timeoutMs?: number
  }): Effect.Effect<ReadonlySet<string>, RelayError | DmVisibilityError>

  /**
   * Sign a snapshot as the relay identity. Intended for tests and pure
   * relay-side helpers; clients MUST NOT publish kind 30622 to production relays.
   */
  signSnapshot(
    params: BuildVisibilitySnapshotParams,
    relayPrivateKey: PrivateKey
  ): Effect.Effect<NostrEvent, RelayError>
}

export const DmVisibilityService = Context.Service<DmVisibilityService>(
  "DmVisibilityService"
)

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const parseSnapshot: DmVisibilityService["parseSnapshot"] = (event) =>
    parseVisibilitySnapshot(event)

  const verifyRelaySignature: DmVisibilityService["verifyRelaySignature"] = (
    event,
    relayIdentity
  ) =>
    Effect.gen(function* () {
      if (event.pubkey !== relayIdentity) return false
      return yield* events.verifyEvent(event).pipe(Effect.catch(() => Effect.succeed(false)))
    })

  const readSnapshot: DmVisibilityService["readSnapshot"] = (event, relayIdentity) =>
    Effect.gen(function* () {
      const projection = yield* parseVisibilitySnapshot(event)

      if (projection.relayPubkey !== relayIdentity) {
        return yield* Effect.fail(
          relayMismatch(
            `snapshot pubkey ${projection.relayPubkey} does not match relay identity ${relayIdentity}`
          )
        )
      }

      const valid = yield* events
        .verifyEvent(event)
        .pipe(Effect.catch(() => Effect.succeed(false)))
      if (!valid) {
        return yield* Effect.fail(
          badSignature("kind 30622 snapshot failed NIP-01 signature verification")
        )
      }

      return projection
    })

  const getSnapshot: DmVisibilityService["getSnapshot"] = ({
    viewerPubkey,
    relayIdentity,
    timeoutMs,
  }) =>
    Effect.gen(function* () {
      if (!isHex64(viewerPubkey)) {
        return yield* Effect.fail(
          malformed("viewerPubkey must be a 64-char lowercase hex pubkey")
        )
      }

      const filter = buildVisibilitySnapshotFilter(viewerPubkey, 1)
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catch(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()

      if (Option.isNone(maybe)) return null

      const event = maybe.value
      if (relayIdentity !== undefined) {
        const verified = yield* readSnapshot(event, relayIdentity).pipe(
          Effect.map((s) => s as VisibilitySnapshot | null),
          Effect.catch(() => Effect.succeed(null as VisibilitySnapshot | null))
        )
        return verified
      }

      // Without a relay identity, still parse structure; do not trust for filtering
      // in hardened clients — callers that omit relayIdentity accept structural parse only.
      return yield* parseVisibilitySnapshot(event).pipe(
        Effect.map((s) => s as VisibilitySnapshot | null),
        Effect.catch(() => Effect.succeed(null as VisibilitySnapshot | null))
      )
    }).pipe(
      Effect.mapError((e) => {
        if (e instanceof DmVisibilityError) return e
        return new RelayError({ message: String(e), relay: relay.url })
      })
    )

  const getHiddenChannelIds: DmVisibilityService["getHiddenChannelIds"] = (params) =>
    Effect.gen(function* () {
      const snap = yield* getSnapshot(params)
      if (snap === null) return new Set<string>() as ReadonlySet<string>
      return snap.hiddenChannelIds
    })

  const signSnapshot: DmVisibilityService["signSnapshot"] = (params, relayPrivateKey) =>
    Effect.gen(function* () {
      if (!isHex64(params.viewerPubkey)) {
        return yield* Effect.fail(
          new RelayError({
            message: "viewerPubkey must be a 64-char lowercase hex pubkey",
            relay: relay.url,
          })
        )
      }
      for (const id of params.hiddenChannelIds ?? []) {
        if (id.length === 0) {
          return yield* Effect.fail(
            new RelayError({
              message: "hidden channel id must be non-empty",
              relay: relay.url,
            })
          )
        }
      }

      const built = buildVisibilitySnapshotParams(params)
      return yield* events.createEvent(
        {
          kind: decodeKind(built.kind),
          content: built.content,
          tags: built.tags.map((t) => decodeTag(t)),
          ...(params.createdAt !== undefined
            ? { created_at: params.createdAt as never }
            : {}),
        },
        relayPrivateKey
      )
    }).pipe(
      Effect.mapError((e) =>
        e instanceof RelayError
          ? e
          : new RelayError({ message: String(e), relay: relay.url })
      )
    )

  return {
    _tag: "DmVisibilityService" as const,
    parseSnapshot,
    verifyRelaySignature,
    readSnapshot,
    getSnapshot,
    getHiddenChannelIds,
    signSnapshot,
  } satisfies DmVisibilityService
})

export const DmVisibilityServiceLive = Layer.effect(DmVisibilityService, make)

// Re-export PublicKey brand for callers that type snapshot pubkeys tightly.
export type { PublicKey }
