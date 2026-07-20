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
import { isParameterizedReplaceableKind, getDTagValue } from "../core/Schema.js"

// Re-export pure functions from service
export {
  getReactedEventPointer,
  REACTION_KIND,
  EXTERNAL_REACTION_KIND,
} from "../client/Nip25Service.js"

// Re-export types
export type { EventPointer } from "../core/Nip19.js"
export type { ExternalReactionParams, ReactionParams } from "../client/Nip25Service.js"

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
  privateKey: Uint8Array,
  options?: { readonly relayHint?: string }
): Event {
  const hint = options?.relayHint
  const eTag = hint
    ? ["e", reacted.id, hint, reacted.pubkey]
    : ["e", reacted.id]
  const pTag = hint ? ["p", reacted.pubkey, hint] : ["p", reacted.pubkey]
  const tags: string[][] = [...(t.tags ?? []), eTag, pTag, ["k", String(reacted.kind)]]

  if (isParameterizedReplaceableKind(reacted.kind)) {
    const d = getDTagValue(reacted as never) ?? ""
    const a = `${reacted.kind}:${reacted.pubkey}:${d}`
    tags.push(hint ? ["a", a, hint, reacted.pubkey] : ["a", a])
  }

  return finalizeEvent(
    {
      ...t,
      kind: Reaction,
      tags,
      content: t.content ?? "+",
    },
    privateKey
  ) as unknown as Event
}

/**
 * Create a kind-17 external content reaction (NIP-73 i/k tags)
 */
export function finishExternalReactionEvent(
  t: {
    content?: string
    created_at: number
    tags?: string[][]
  },
  targets: readonly { k: string; i: string; url?: string }[],
  privateKey: Uint8Array
): Event {
  const tags: string[][] = [...(t.tags ?? [])]
  for (const target of targets) {
    tags.push(["k", target.k])
    tags.push(target.url ? ["i", target.i, target.url] : ["i", target.i])
  }
  return finalizeEvent(
    {
      kind: 17,
      created_at: t.created_at,
      content: t.content ?? "+",
      tags,
    },
    privateKey
  ) as unknown as Event
}
