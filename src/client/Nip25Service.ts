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
import type { NostrEvent, PrivateKey, Tag, EventKind } from "../core/Schema.js"
import type { EventPointer } from "../core/Nip19.js"

// =============================================================================
// Constants
// =============================================================================

/** Reaction event kind */
export const REACTION_KIND = 7 as EventKind

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
}

// =============================================================================
// Service Interface
// =============================================================================

export interface Nip25Service {
  readonly _tag: "Nip25Service"

  /**
   * Create a reaction event for the given event
   * Automatically includes proper e and p tags per NIP-25
   */
  createReaction(
    params: ReactionParams,
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

export const Nip25Service = Context.GenericTag<Nip25Service>("Nip25Service")

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
      const { reactedEvent, content = "+", tags: extraTags = [] } = params

      // Inherit e and p tags from the reacted event
      const inheritedTags = reactedEvent.tags.filter(
        (tag) => tag.length >= 2 && (tag[0] === "e" || tag[0] === "p")
      )

      // Build final tags: extra tags + inherited + new e and p for reacted event
      const tags: (typeof Tag.Type)[] = [
        ...extraTags.map((t) => t as unknown as typeof Tag.Type),
        ...inheritedTags.map((t) => [...t] as unknown as typeof Tag.Type),
        ["e", reactedEvent.id] as unknown as typeof Tag.Type,
        ["p", reactedEvent.pubkey] as unknown as typeof Tag.Type,
      ]

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

  return {
    _tag: "Nip25Service" as const,
    createReaction,
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
