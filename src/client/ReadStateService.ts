/**
 * ReadStateService
 *
 * NIP-RS: Cross-Device Read State Sync (buzz-parity draft).
 *
 * Synchronizes a user's own per-context read frontiers across client instances
 * via encrypted, addressable `kind:30078` (NIP-78) events. Each client instance
 * owns one blob identified by a random `d=read-state:<slot-id>` coordinate;
 * effective state is the grow-only max-register merge of all valid blobs.
 *
 * This is NOT a read-receipt protocol — state is encrypted to the author only
 * (NIP-44 encrypt-to-self) and never exposes what one user has read to another.
 *
 * This module implements the PROTOCOL only; it does not depend on buzz.
 *
 * @see NIP-RS spec (buzz `docs/nips/NIP-RS.md`)
 * @see https://github.com/nostr-protocol/nips/blob/master/78.md (NIP-78)
 * @see https://github.com/nostr-protocol/nips/blob/master/44.md (NIP-44)
 * @see https://github.com/nostr-protocol/nips/blob/master/33.md (NIP-33)
 */
import { Context, Data, Effect, Layer, Schema, Stream } from "effect";
import { randomBytes } from "@noble/hashes/utils";
import { bytesToHex } from "@noble/hashes/utils";
import { RelayService, type PublishResult } from "./RelayService.js";
import { EventService } from "../services/EventService.js";
import { Nip44Service, type EncryptedPayload } from "../services/Nip44Service.js";
import { CryptoService } from "../services/CryptoService.js";
import {
  type NostrEvent,
  type PrivateKey,
  EventKind,
  Filter,
  Tag,
} from "../core/Schema.js";

const decodeKind = Schema.decodeSync(EventKind);
const decodeFilter = Schema.decodeSync(Filter);
const decodeTag = Schema.decodeSync(Tag);

// =============================================================================
// Constants
// =============================================================================

/** Addressable event kind reused from NIP-78 application-specific data. */
export const READ_STATE_KIND = 30078;

/** Schema version carried inside encrypted content. */
export const READ_STATE_VERSION = 1;

/** Value of the required `t` filter tag. */
export const READ_STATE_T_VALUE = "read-state";

/** Prefix for the addressable `d` tag. */
export const READ_STATE_D_PREFIX = "read-state:";

/** Maximum number of context entries per blob (spec hard limit). */
export const MAX_CONTEXT_ENTRIES = 10_000;

/** Maximum UTF-8 byte length of a single context identifier. */
export const MAX_CONTEXT_ID_BYTES = 256;

/** Maximum unix timestamp value for a context entry (uint32). */
export const MAX_CONTEXT_TIMESTAMP = 4_294_967_295;

/** Maximum character length of `client_id` and `slot-id`. */
export const MAX_ID_LENGTH = 64;

/** Default fetch horizon in seconds (7 days). */
export const DEFAULT_HORIZON_SECONDS = 7 * 24 * 60 * 60;

const HEX64 = /^[0-9a-f]{64}$/;
const ASCII_SLOT = /^[\x20-\x7E]{1,64}$/;

// =============================================================================
// Errors
// =============================================================================

/** Failure while building, publishing, reading, or validating read state. */
export class ReadStateError extends Data.TaggedError("ReadStateError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// =============================================================================
// Types
// =============================================================================

/** Flat map of context id → read-frontier unix timestamp (seconds). */
export type ReadContexts = Readonly<Record<string, number>>;

/** Decrypted, validated plaintext body of a read-state blob. */
export interface ReadStateBlob {
  readonly v: typeof READ_STATE_VERSION;
  readonly client_id: string;
  readonly contexts: ReadContexts;
}

/** A validated outer event plus its decrypted content (when available). */
export interface DecodedReadState {
  readonly event: NostrEvent;
  /** Addressable `d` value, e.g. `read-state:<slot-id>`. */
  readonly d: string;
  /** Parsed slot-id (the portion after `read-state:`). */
  readonly slotId: string;
  /** Decrypted content, or `null` when decrypt/validation failed. */
  readonly content: ReadStateBlob | null;
}

export interface FetchReadStateOptions {
  readonly author: string;
  readonly authorPrivateKey: PrivateKey;
  /**
   * When provided, `own` is selected as the blob whose decrypted `client_id`
   * matches (highest `created_at` wins on duplicates).
   */
  readonly clientId?: string;
  /**
   * Lower bound for `created_at` (seconds). Defaults to now − 7 days.
   * Pass `0` to disable the horizon filter.
   */
  readonly since?: number;
  readonly limit?: number;
  readonly timeoutMs?: number;
}

export interface PublishReadStateOptions {
  /** Stable, unique slot-id for this installation (1–64 ASCII). */
  readonly slotId: string;
  /** Stable, unique client_id for this installation (1–64 UTF-8). */
  readonly clientId: string;
  /**
   * Context map to publish. Before writing the service fetches the own blob
   * (read-before-write) and merges with `max()` so concurrent advances are not
   * lost.
   */
  readonly contexts: ReadContexts;
  /** Override `created_at` (seconds). Still subject to monotonicity. */
  readonly createdAt?: number;
  readonly timeoutMs?: number;
}

export interface DecryptReadStateOptions {
  readonly event: NostrEvent;
  readonly authorPrivateKey: PrivateKey;
}

export interface FetchResult {
  /** Max-merged contexts across all valid blobs. */
  readonly merged: ReadContexts;
  /** All events that passed outer tag validation (content may be null). */
  readonly blobs: readonly DecodedReadState[];
  /**
   * Own blob selected by matching `client_id`. When multiple match, the one
   * with the highest `created_at` wins.
   */
  readonly own: DecodedReadState | null;
}

// =============================================================================
// Pure helpers (exported for reuse and testing)
// =============================================================================

/** Generate a fresh opaque slot-id (128 bits of entropy as hex). */
export const generateSlotId = (): string => bytesToHex(randomBytes(16));

/** Generate a fresh opaque client_id (128 bits of entropy as hex). */
export const generateClientId = (): string => bytesToHex(randomBytes(16));

/**
 * Build the addressable `d` tag value `read-state:<slot-id>`.
 * Returns `null` when `slotId` is not a non-empty ASCII string of 1–64 chars.
 */
export const buildDTag = (slotId: string): string | null => {
  if (!ASCII_SLOT.test(slotId)) return null;
  return `${READ_STATE_D_PREFIX}${slotId}`;
};

/**
 * Extract the slot-id from a `d` tag value. Returns `null` when the value
 * does not begin with `read-state:` or the remainder fails the slot-id rules.
 */
export const parseSlotId = (d: string): string | null => {
  if (!d.startsWith(READ_STATE_D_PREFIX)) return null;
  const slotId = d.slice(READ_STATE_D_PREFIX.length);
  if (!ASCII_SLOT.test(slotId)) return null;
  return slotId;
};

/**
 * Outer-event tag validation:
 * - exactly one `d` tag whose value begins with `read-state:` and has a valid slot-id
 * - exactly one `t` tag with value `read-state`
 *
 * Returns the slot-id on success, otherwise `null`.
 */
export const validateReadStateTags = (event: {
  readonly tags: readonly (readonly string[])[];
}): string | null => {
  const dTags = event.tags.filter((t) => t[0] === "d");
  if (dTags.length !== 1) return null;
  const d = dTags[0]?.[1];
  if (d === undefined) return null;
  const slotId = parseSlotId(d);
  if (slotId === null) return null;

  const tTags = event.tags.filter((t) => t[0] === "t" && t[1] === READ_STATE_T_VALUE);
  if (tTags.length !== 1) return null;

  return slotId;
};

/**
 * Grow-only max-register merge of context maps (state-based CvRDT join).
 * Associative, commutative, and idempotent.
 *
 * ```
 * effective[ctx] = max(timestamp) across all inputs
 * ```
 */
export const mergeContexts = (...maps: readonly ReadContexts[]): ReadContexts => {
  const out: Record<string, number> = {};
  for (const map of maps) {
    for (const [ctx, ts] of Object.entries(map)) {
      const prev = out[ctx];
      if (prev === undefined || ts > prev) {
        out[ctx] = ts;
      }
    }
  }
  return out;
};

const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Validate decrypted plaintext into a `ReadStateBlob`.
 *
 * Rules (per NIP-RS Content Validation):
 * - must be JSON object with integer `v` (unknown versions → ignore/null)
 * - `client_id` non-empty UTF-8 string of 1–64 chars
 * - `contexts` must be an object
 * - entries with non-integer ts outside 0–4294967295 are dropped
 * - entries whose context id exceeds 256 bytes are dropped
 * - more than 10,000 entries → reject entire blob
 * - unknown top-level keys are ignored
 *
 * Returns `null` when the blob must be discarded/ignored.
 */
export const validateBlob = (input: string | unknown): ReadStateBlob | null => {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const v = obj["v"];
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v !== READ_STATE_VERSION) return null; // unknown version → ignore

  const clientId = obj["client_id"];
  if (typeof clientId !== "string") return null;
  if (clientId.length < 1 || clientId.length > MAX_ID_LENGTH) return null;

  const contextsRaw = obj["contexts"];
  if (
    contextsRaw === null ||
    typeof contextsRaw !== "object" ||
    Array.isArray(contextsRaw)
  ) {
    return null;
  }

  const entries = Object.entries(contextsRaw as Record<string, unknown>);
  if (entries.length > MAX_CONTEXT_ENTRIES) return null;

  const contexts: Record<string, number> = {};
  for (const [ctxId, ts] of entries) {
    if (utf8ByteLength(ctxId) > MAX_CONTEXT_ID_BYTES) continue;
    if (typeof ts !== "number" || !Number.isInteger(ts)) continue;
    if (ts < 0 || ts > MAX_CONTEXT_TIMESTAMP) continue;
    // Duplicate keys: last value wins (RFC 8259 §4); Object.entries already
    // collapses JSON-parsed duplicates to the last occurrence.
    contexts[ctxId] = ts;
  }

  return {
    v: READ_STATE_VERSION,
    client_id: clientId,
    contexts,
  };
};

/**
 * Parse an optional well-known `thread:<root-event-id>` context key.
 * Returns the 64-char lowercase hex root id, or `null` when the key is not a
 * well-formed thread context (treated as an ordinary opaque context).
 */
export const parseThreadContext = (key: string): string | null => {
  if (!key.startsWith("thread:")) return null;
  const id = key.slice("thread:".length);
  return HEX64.test(id) ? id : null;
};

/**
 * Parse an optional well-known `msg:<event-id>` context key.
 * Returns the 64-char lowercase hex event id, or `null` when not well-formed.
 */
export const parseMsgContext = (key: string): string | null => {
  if (!key.startsWith("msg:")) return null;
  const id = key.slice("msg:".length);
  return HEX64.test(id) ? id : null;
};

/** Build a well-known thread context key from a 64-char lowercase hex root id. */
export const threadContextKey = (rootEventId: string): string =>
  `thread:${rootEventId}`;

/** Build a well-known per-message context key from a 64-char lowercase hex id. */
export const msgContextKey = (eventId: string): string => `msg:${eventId}`;

/**
 * Hierarchical frontier rule (optional Read Context Schemes):
 *
 * ```
 * effective(ctx) = max(merged[ctx], effective(parent(ctx)))
 * ```
 *
 * For threads/messages the parent is the channel. A channel has no parent.
 * When `parentId` is omitted/null, the effective frontier degrades to the
 * context's own merged value alone.
 *
 * Returns `undefined` when neither the context nor its parent has a value
 * (unknown → treat as unread).
 */
export const effective = (
  merged: ReadContexts,
  contextId: string,
  parentId?: string | null
): number | undefined => {
  const own = merged[contextId];
  if (parentId === undefined || parentId === null || parentId === "") {
    return own;
  }
  const parent = merged[parentId];
  if (own === undefined) return parent;
  if (parent === undefined) return own;
  return Math.max(own, parent);
};

/**
 * Clock-skew-safe `created_at`: if local now is ≤ max fetched for this
 * coordinate, use `maxFetched + 1`.
 */
export const monotonicCreatedAt = (
  localNow: number,
  maxFetchedCreatedAt: number | undefined
): number => {
  if (maxFetchedCreatedAt === undefined) return localNow;
  return localNow > maxFetchedCreatedAt ? localNow : maxFetchedCreatedAt + 1;
};

/**
 * Drop child context entries dominated by their parent frontier
 * (`value <= effective(parent)`). Best-effort pruning only.
 */
export const evictDominated = (
  contexts: ReadContexts,
  parentOf: (contextId: string) => string | null | undefined
): ReadContexts => {
  const out: Record<string, number> = {};
  for (const [ctx, ts] of Object.entries(contexts)) {
    const parent = parentOf(ctx);
    if (parent !== undefined && parent !== null && parent !== "") {
      const parentTs = contexts[parent];
      if (parentTs !== undefined && ts <= parentTs) continue;
    }
    out[ctx] = ts;
  }
  return out;
};

/**
 * Select the own blob from a fetch result by matching `client_id`. When
 * multiple blobs share the same client_id, the one with the highest
 * `created_at` wins (spec: treat as own and merge/delete the rest).
 */
export const selectOwnBlob = (
  blobs: readonly DecodedReadState[],
  clientId: string
): DecodedReadState | null => {
  let best: DecodedReadState | null = null;
  for (const b of blobs) {
    if (b.content === null) continue;
    if (b.content.client_id !== clientId) continue;
    if (
      !best ||
      b.event.created_at > best.event.created_at ||
      (b.event.created_at === best.event.created_at && b.event.id < best.event.id)
    ) {
      best = b;
    }
  }
  return best;
};

// =============================================================================
// Service Interface
// =============================================================================

export interface ReadStateService {
  readonly _tag: "ReadStateService";

  /**
   * Fetch all of the author's read-state blobs within the time horizon,
   * decrypt/validate each, and return the max-merged effective map plus the
   * caller's own blob (if any).
   */
  fetchReadState(
    options: FetchReadStateOptions
  ): Effect.Effect<FetchResult, ReadStateError>;

  /**
   * Publish this instance's blob under `d=read-state:<slotId>`.
   *
   * Implements read-before-write: fetches the current own-coordinate blob,
   * max-merges its contexts with the provided map, enforces monotonic
   * `created_at`, and refuses to publish when the coordinate is conflicted
   * (decrypted `client_id` does not match).
   */
  publishReadState(
    options: PublishReadStateOptions,
    privateKey: PrivateKey
  ): Effect.Effect<
    { readonly result: PublishResult; readonly d: string; readonly contexts: ReadContexts },
    ReadStateError
  >;

  /**
   * Verify the outer signature, decrypt with NIP-44 encrypt-to-self, and
   * validate the plaintext. Returns `null` for any failure (bad sig, decrypt
   * error, invalid content).
   */
  decryptReadState(
    options: DecryptReadStateOptions
  ): Effect.Effect<ReadStateBlob | null, ReadStateError>;
}

export const ReadStateService = Context.Service<ReadStateService>("ReadStateService");

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService;
  const eventService = yield* EventService;
  const nip44 = yield* Nip44Service;
  const crypto = yield* CryptoService;

  const fail = (message: string, cause?: unknown) =>
    new ReadStateError({ message, ...(cause !== undefined ? { cause } : {}) });

  const encryptToSelf = (privateKey: PrivateKey, blob: ReadStateBlob) =>
    Effect.gen(function* () {
      const authorPub = yield* crypto.getPublicKey(privateKey);
      const ck = yield* nip44.getConversationKey(privateKey, authorPub);
      // Stable key order is not required; JSON.stringify is fine.
      const plaintext = JSON.stringify({
        v: blob.v,
        client_id: blob.client_id,
        contexts: blob.contexts,
      });
      return yield* nip44.encrypt(plaintext, ck);
    });

  const decryptEvent = (event: NostrEvent, authorPrivateKey: PrivateKey) =>
    Effect.gen(function* () {
      if (!event.content || event.content.length === 0) return null;

      const valid = yield* eventService.verifyEvent(event);
      if (!valid) return null;

      const ck = yield* nip44.getConversationKey(authorPrivateKey, event.pubkey);
      const plaintext = yield* nip44.decrypt(event.content as EncryptedPayload, ck);
      return validateBlob(plaintext);
    });

  const decryptReadState: ReadStateService["decryptReadState"] = ({
    event,
    authorPrivateKey,
  }) =>
    decryptEvent(event, authorPrivateKey).pipe(
      Effect.catch(() => Effect.succeed(null)),
      Effect.mapError((e) => fail(String(e), e))
    );

  const collectEvents = (filter: ReturnType<typeof decodeFilter>, timeoutMs: number) =>
    Effect.gen(function* () {
      const sub = yield* relay.subscribe([filter]);
      const collected: NostrEvent[] = [];
      const collectEffect = sub.events.pipe(
        Stream.takeUntil(() => false),
        Stream.runForEach((event) =>
          Effect.sync(() => {
            collected.push(event);
          })
        )
      );
      yield* Effect.race(collectEffect, Effect.sleep(timeoutMs));
      yield* sub.unsubscribe();
      return collected;
    });

  const fetchReadState: ReadStateService["fetchReadState"] = ({
    author,
    authorPrivateKey,
    clientId,
    since,
    limit,
    timeoutMs,
  }) =>
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000);
      const sinceValue =
        since !== undefined ? since : Math.max(0, now - DEFAULT_HORIZON_SECONDS);

      const filter = decodeFilter({
        kinds: [decodeKind(READ_STATE_KIND)],
        authors: [author],
        "#t": [READ_STATE_T_VALUE],
        ...(sinceValue > 0 ? { since: sinceValue } : {}),
        ...(limit !== undefined ? { limit } : {}),
      } as never);

      const collected = yield* collectEvents(filter, timeoutMs ?? 800);

      // Keep the winning head per address (highest created_at, tie → lowest id).
      const heads = new Map<string, NostrEvent>();
      for (const ev of collected) {
        const slotId = validateReadStateTags(ev);
        if (slotId === null) continue;
        const d = buildDTag(slotId)!;
        const prev = heads.get(d);
        if (
          !prev ||
          ev.created_at > prev.created_at ||
          (ev.created_at === prev.created_at && ev.id < prev.id)
        ) {
          heads.set(d, ev);
        }
      }

      const blobs: DecodedReadState[] = [];
      const validContents: ReadStateBlob[] = [];

      for (const [d, ev] of heads) {
        const slotId = parseSlotId(d)!;
        const content = yield* decryptEvent(ev, authorPrivateKey).pipe(
          Effect.catch(() => Effect.succeed(null))
        );
        blobs.push({ event: ev, d, slotId, content });
        if (content !== null) validContents.push(content);
      }

      const own =
        clientId !== undefined ? selectOwnBlob(blobs, clientId) : null;

      return {
        merged: mergeContexts(...validContents.map((b) => b.contexts)),
        blobs,
        own,
      } satisfies FetchResult;
    }).pipe(Effect.mapError((e) => fail(String(e), e)));

  /**
   * Like fetch, but also selects `own` by matching `clientId` and returns the
   * max created_at across the own-coordinate heads (for monotonic writes).
   */
  const fetchForPublish = (
    author: string,
    authorPrivateKey: PrivateKey,
    slotId: string,
    clientId: string,
    timeoutMs: number
  ) =>
    Effect.gen(function* () {
      const d = buildDTag(slotId);
      if (d === null) {
        return yield* Effect.fail(fail(`invalid slot-id: ${slotId}`));
      }

      // Own coordinate (read-before-write).
      const ownFilter = decodeFilter({
        kinds: [decodeKind(READ_STATE_KIND)],
        authors: [author],
        "#d": [d],
        limit: 5,
      } as never);
      const ownEvents = yield* collectEvents(ownFilter, timeoutMs);

      let maxCreatedAt: number | undefined;
      let conflicted = false;
      let ownContexts: ReadContexts = {};

      for (const ev of ownEvents) {
        if (validateReadStateTags(ev) === null) continue;
        if (maxCreatedAt === undefined || ev.created_at > maxCreatedAt) {
          maxCreatedAt = ev.created_at;
        }
        const content = yield* decryptEvent(ev, authorPrivateKey).pipe(
          Effect.catch(() => Effect.succeed(null))
        );
        if (content === null) continue;
        if (content.client_id !== clientId) {
          // Coordinate claimed by another client_id — refuse to publish here.
          conflicted = true;
        } else {
          ownContexts = mergeContexts(ownContexts, content.contexts);
        }
      }

      // Also merge peer blobs so local publish carries the latest max state
      // only for *our* contexts? Spec says: merge fetched own blob with local
      // state using max() per context. Peer re-publish is a separate path.
      // We only merge own-coordinate content into what we write.
      return { d, maxCreatedAt, conflicted, ownContexts };
    });

  const publishReadState: ReadStateService["publishReadState"] = (
    options,
    privateKey
  ) =>
    Effect.gen(function* () {
      if (
        typeof options.clientId !== "string" ||
        options.clientId.length < 1 ||
        options.clientId.length > MAX_ID_LENGTH
      ) {
        return yield* Effect.fail(
          fail(`invalid client_id: must be 1–${MAX_ID_LENGTH} UTF-8 characters`)
        );
      }

      const d = buildDTag(options.slotId);
      if (d === null) {
        return yield* Effect.fail(
          fail(
            `invalid slot-id: must be a non-empty ASCII string of 1–${MAX_ID_LENGTH} characters`
          )
        );
      }

      // Drop invalid context entries early.
      const cleaned = validateBlob({
        v: READ_STATE_VERSION,
        client_id: options.clientId,
        contexts: options.contexts,
      });
      if (cleaned === null) {
        return yield* Effect.fail(fail("contexts failed validation (too many entries?)"));
      }

      const author = yield* crypto.getPublicKey(privateKey);
      const { maxCreatedAt, conflicted, ownContexts } = yield* fetchForPublish(
        author,
        privateKey,
        options.slotId,
        options.clientId,
        options.timeoutMs ?? 800
      );

      if (conflicted) {
        return yield* Effect.fail(
          fail(
            `slot-id conflict on ${d}: coordinate is owned by a different client_id; generate a new slot-id`
          )
        );
      }

      const mergedContexts = mergeContexts(ownContexts, cleaned.contexts);
      if (Object.keys(mergedContexts).length > MAX_CONTEXT_ENTRIES) {
        return yield* Effect.fail(
          fail(`merged contexts exceed ${MAX_CONTEXT_ENTRIES} entries`)
        );
      }

      const blob: ReadStateBlob = {
        v: READ_STATE_VERSION,
        client_id: options.clientId,
        contexts: mergedContexts,
      };

      const cipher = yield* encryptToSelf(privateKey, blob);

      const localNow =
        options.createdAt !== undefined
          ? options.createdAt
          : Math.floor(Date.now() / 1000);
      const createdAt = monotonicCreatedAt(localNow, maxCreatedAt);

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(READ_STATE_KIND),
          content: cipher,
          tags: [
            ["d", d],
            ["t", READ_STATE_T_VALUE],
          ].map((t) => decodeTag(t)),
          created_at: createdAt as never,
        },
        privateKey
      );
      const result = yield* relay.publish(event);
      return { result, d, contexts: mergedContexts };
    }).pipe(
      Effect.mapError((e) => (e instanceof ReadStateError ? e : fail(String(e), e)))
    );

  return {
    _tag: "ReadStateService" as const,
    fetchReadState,
    publishReadState,
    decryptReadState,
  };
});

export const ReadStateServiceLive = Layer.effect(ReadStateService, make);
