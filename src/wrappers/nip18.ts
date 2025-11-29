/**
 * NIP-18: Reposts
 *
 * Create and parse repost events (kind 6 for text notes, kind 16 for generic reposts).
 *
 * @example
 * ```typescript
 * import { finishRepostEvent, getRepostedEventPointer, getRepostedEvent } from 'nostr-effect/nip18'
 *
 * // Create a repost
 * const repost = finishRepostEvent(
 *   { created_at: Math.floor(Date.now() / 1000) },
 *   eventToRepost,
 *   'wss://relay.example.com',
 *   privateKey
 * )
 *
 * // Get the event being reposted
 * const pointer = getRepostedEventPointer(repost)
 * ```
 */

import { finalizeEvent } from "./pure.js"
import { Repost, GenericRepost, ShortTextNote } from "./kinds.js"

// Re-export pure functions from service
export {
  getRepostedEventPointer,
  getRepostedEvent,
  REPOST_KIND,
  GENERIC_REPOST_KIND,
} from "../client/Nip18Service.js"

/** Event type for reposts */
export interface Event {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Template for creating a repost event */
export interface RepostEventTemplate {
  /**
   * Pass only non-NIP18 tags if needed.
   * NIP18 tags ('e' and 'p' tags pointing to the reposted event) will be added automatically.
   */
  tags?: string[][]

  /**
   * Pass an empty string to NOT include the stringified JSON of the reposted event.
   * Any other content will be ignored and replaced with the stringified JSON of the reposted event.
   * @default Stringified JSON of the reposted event
   */
  content?: ""

  created_at: number
}

/** Options for getRepostedEvent */
export interface GetRepostedEventOptions {
  skipVerification?: boolean
}

/**
 * Create a repost event for the given event
 */
export function finishRepostEvent(
  t: RepostEventTemplate,
  reposted: Event,
  relayUrl: string,
  privateKey: Uint8Array
): Event {
  let kind: typeof Repost | typeof GenericRepost
  const tags = [...(t.tags ?? []), ["e", reposted.id, relayUrl], ["p", reposted.pubkey]]

  if (reposted.kind === ShortTextNote) {
    kind = Repost
  } else {
    kind = GenericRepost
    tags.push(["k", String(reposted.kind)])
  }

  const isProtected = reposted.tags?.find((tag) => tag[0] === "-")

  return finalizeEvent(
    {
      kind,
      tags,
      content: t.content === "" || isProtected ? "" : JSON.stringify(reposted),
      created_at: t.created_at,
    },
    privateKey
  ) as unknown as Event
}
