/**
 * NIP-25: Reactions
 *
 * Create and parse reaction events (likes, emoji reactions, etc.)
 *
 * @example
 * ```typescript
 * import { finishReactionEvent, getReactedEventPointer } from 'nostr-effect/nip25'
 *
 * // Create a reaction to an event
 * const reaction = finishReactionEvent(
 *   { created_at: Math.floor(Date.now() / 1000) },
 *   eventToReactTo,
 *   privateKey
 * )
 *
 * // Get the event being reacted to
 * const pointer = getReactedEventPointer(reaction)
 * ```
 */

import { finalizeEvent } from "./pure.js"
import { Reaction } from "./kinds.js"
import type { EventPointer } from "../core/Nip19.js"

/** Event type for reactions */
export interface Event {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Template for creating a reaction event */
export interface ReactionEventTemplate {
  /**
   * Pass only non-NIP25 tags if needed. NIP25 tags ('e' and 'p' tags from reacted event) will be added automatically.
   */
  tags?: string[][]

  /**
   * @default '+'
   */
  content?: string

  created_at: number
}

/**
 * Create a reaction event for the given event
 */
export function finishReactionEvent(
  t: ReactionEventTemplate,
  reacted: Event,
  privateKey: Uint8Array
): Event {
  const inheritedTags = reacted.tags.filter(
    (tag) => tag.length >= 2 && (tag[0] === "e" || tag[0] === "p")
  )

  return finalizeEvent(
    {
      ...t,
      kind: Reaction,
      tags: [...(t.tags ?? []), ...inheritedTags, ["e", reacted.id], ["p", reacted.pubkey]],
      content: t.content ?? "+",
    },
    privateKey
  ) as unknown as Event
}

/**
 * Get the pointer to the event being reacted to
 */
export function getReactedEventPointer(event: Event): EventPointer | undefined {
  if (event.kind !== Reaction) {
    return undefined
  }

  let lastETag: string[] | undefined
  let lastPTag: string[] | undefined

  for (let i = event.tags.length - 1; i >= 0 && (lastETag === undefined || lastPTag === undefined); i--) {
    const tag = event.tags[i]
    if (tag && tag.length >= 2) {
      if (tag[0] === "e" && lastETag === undefined) {
        lastETag = tag
      } else if (tag[0] === "p" && lastPTag === undefined) {
        lastPTag = tag
      }
    }
  }

  if (lastETag === undefined || lastPTag === undefined) {
    return undefined
  }

  const result: EventPointer = {
    id: lastETag[1]!,
    relays: [lastETag[2], lastPTag[2]].filter((x): x is string => x !== undefined),
  }

  if (lastPTag[1]) {
    (result as { author?: string }).author = lastPTag[1]
  }

  return result
}
