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

import { finalizeEvent, verifyEvent } from "./pure.js"
import { Repost, GenericRepost, ShortTextNote } from "./kinds.js"
import type { EventPointer } from "../core/Nip19.js"

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

/**
 * Get the pointer to the reposted event
 */
export function getRepostedEventPointer(event: Event): EventPointer | undefined {
  if (event.kind !== Repost && event.kind !== GenericRepost) {
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

  if (lastETag === undefined) {
    return undefined
  }

  const result: EventPointer = {
    id: lastETag[1]!,
    relays: [lastETag[2], lastPTag?.[2]].filter((x): x is string => typeof x === "string"),
  }

  if (lastPTag?.[1]) {
    (result as { author?: string }).author = lastPTag[1]
  }

  return result
}

/**
 * Get the reposted event from a repost event's content
 */
export function getRepostedEvent(
  event: Event,
  { skipVerification }: GetRepostedEventOptions = {}
): Event | undefined {
  const pointer = getRepostedEventPointer(event)

  if (pointer === undefined || event.content === "") {
    return undefined
  }

  let repostedEvent: Event | undefined

  try {
    repostedEvent = JSON.parse(event.content) as Event
  } catch (_error) {
    return undefined
  }

  if (repostedEvent.id !== pointer.id) {
    return undefined
  }

  if (!skipVerification && !verifyEvent(repostedEvent as Parameters<typeof verifyEvent>[0])) {
    return undefined
  }

  return repostedEvent
}
