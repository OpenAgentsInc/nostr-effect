/**
 * NIP-25 Service
 *
 * Reactions (likes, emojis, etc.) for Nostr events.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/25.md
 */
import { Context, Effect, Layer } from "effect"
import { EventService } from "../services/EventService.js"
import { CryptoError, InvalidPrivateKey } from "../core/Errors.js"
import {
  type NostrEvent,
  type PrivateKey,
  type Tag,
  type EventKind,
  isParameterizedReplaceableKind,
  getDTagValue,
} from "../core/Schema.js"
import type { EventPointer } from "../core/Nip19.js"

// =============================================================================
// Constants
// =============================================================================

/** Reaction event kind */
export const REACTION_KIND = 7 as EventKind

/** External content reaction kind (NIP-25 + NIP-73) */
export const EXTERNAL_REACTION_KIND = 17 as EventKind

// =============================================================================
// Types
// =============================================================================

/** Parameters for creating a reaction event */
export interface ReactionParams {
  /** The event being reacted to */
  readonly reactedEvent: NostrEvent
  /** Reaction content (default: "+") */
  readonly content?: string
  /** Additional tags (non-NIP-25 tags) */
  readonly tags?: readonly string[][]
  /** Optional relay hint for e/p tags */
  readonly relayHint?: string
}

/** Parameters for kind-17 external content reaction */
export interface ExternalReactionParams {
  /** Reaction content (default: "+") */
  readonly content?: string
  /** NIP-73 k/i tag pairs: { k, i, url? } */
  readonly targets: readonly {
    readonly k: string
    readonly i: string
    readonly url?: string
  }[]
  /** Extra tags */
  readonly tags?: readonly string[][]
}

// =============================================================================
// Service Interface
// =============================================================================

export interface Nip25Service {
  readonly _tag: "Nip25Service"

  /**
   * Create a reaction event for the given event
   * Automatically includes e, p, k, and a (for addressable) tags per NIP-25
   */
  createReaction(
    params: ReactionParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, CryptoError | InvalidPrivateKey>

  /**
   * Create a kind-17 external content reaction (NIP-73 i/k tags)
   */
  createExternalReaction(
    params: ExternalReactionParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, CryptoError | InvalidPrivateKey>

  /**
   * Get the pointer to the event being reacted to
   * Returns undefined if not a valid reaction event
   */
  getReactedEventPointer(event: NostrEvent): EventPointer | undefined
}

// =============================================================================
// Service Tag
// =============================================================================

export const Nip25Service = Context.Service<Nip25Service>("Nip25Service")

// =============================================================================
// Pure Functions (exported for wrappers)
// =============================================================================

/**
 * Get the pointer to the event being reacted to (pure function)
 * Exported for use by wrappers
 */
export function getReactedEventPointer(event: NostrEvent): EventPointer | undefined {
  if ((event.kind as number) !== REACTION_KIND) {
    return undefined
  }

  let lastETag: readonly string[] | undefined
  let lastPTag: readonly string[] | undefined

  // Find the last e and p tags
  for (let i = event.tags.length - 1; i >= 0; i--) {
    const tag = event.tags[i]
    if (tag && tag.length >= 2) {
      if (tag[0] === "e" && lastETag === undefined) {
        lastETag = tag
      } else if (tag[0] === "p" && lastPTag === undefined) {
        lastPTag = tag
      }
    }
    if (lastETag !== undefined && lastPTag !== undefined) {
      break
    }
  }

  if (lastETag === undefined || lastPTag === undefined) {
    return undefined
  }

  const result: EventPointer = {
    id: lastETag[1]!,
    relays: [lastETag[2], lastPTag[2]].filter((x): x is string => typeof x === "string"),
  }

  // Only add author if defined
  if (lastPTag[1]) {
    ;(result as { author: string }).author = lastPTag[1]
  }

  return result
}

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const eventService = yield* EventService

  const createReaction: Nip25Service["createReaction"] = (params, privateKey) =>
    Effect.gen(function* () {
      const { reactedEvent, content = "+", tags: extraTags = [], relayHint } = params
      const hint = relayHint ?? ""

      // e tag SHOULD include relay + pubkey hints; p SHOULD include relay hint
      const eTag = hint
        ? (["e", reactedEvent.id, hint, reactedEvent.pubkey] as unknown as typeof Tag.Type)
        : (["e", reactedEvent.id] as unknown as typeof Tag.Type)
      const pTag = hint
        ? (["p", reactedEvent.pubkey, hint] as unknown as typeof Tag.Type)
        : (["p", reactedEvent.pubkey] as unknown as typeof Tag.Type)

      const tags: (typeof Tag.Type)[] = [
        ...extraTags.map((t) => t as unknown as typeof Tag.Type),
        eTag,
        pTag,
        // k: stringified kind of reacted event
        ["k", String(reactedEvent.kind)] as unknown as typeof Tag.Type,
      ]

      // a tag for addressable events
      if (isParameterizedReplaceableKind(reactedEvent.kind)) {
        const d = getDTagValue(reactedEvent) ?? ""
        const a = `${reactedEvent.kind}:${reactedEvent.pubkey}:${d}`
        tags.push(
          (hint
            ? ["a", a, hint, reactedEvent.pubkey]
            : ["a", a]) as unknown as typeof Tag.Type
        )
      }

      const event = yield* eventService.createEvent(
        {
          kind: REACTION_KIND,
          content,
          tags,
        },
        privateKey
      )

      return event
    })

  const createExternalReaction: Nip25Service["createExternalReaction"] = (params, privateKey) =>
    Effect.gen(function* () {
      const { content = "+", targets, tags: extraTags = [] } = params
      const tags: (typeof Tag.Type)[] = [...extraTags.map((t) => t as unknown as typeof Tag.Type)]
      for (const t of targets) {
        tags.push(["k", t.k] as unknown as typeof Tag.Type)
        tags.push(
          (t.url ? ["i", t.i, t.url] : ["i", t.i]) as unknown as typeof Tag.Type
        )
      }
      return yield* eventService.createEvent(
        { kind: EXTERNAL_REACTION_KIND, content, tags },
        privateKey
      )
    })

  return {
    _tag: "Nip25Service" as const,
    createReaction,
    createExternalReaction,
    getReactedEventPointer,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for Nip25Service
 * Requires EventService
 */
export const Nip25ServiceLive = Layer.effect(Nip25Service, make)
