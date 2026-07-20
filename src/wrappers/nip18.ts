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
/**
 * NIP-18 / NIP-21 quote tag: `["q", <event-id|address>, <relay-url>, <pubkey?>]`
 */
export function createQuoteTag(
  idOrAddress: string,
  relayUrl?: string,
  pubkey?: string
): string[] {
  const tag = ["q", idOrAddress]
  if (relayUrl) tag.push(relayUrl)
  if (pubkey) tag.push(pubkey)
  return tag
}

/**
 * Finish a repost that also quotes another event via `q` tag (quote-repost pattern).
 */
export function finishQuoteRepostEvent(
  t: RepostEventTemplate,
  reposted: Event,
  relayUrl: string,
  privateKey: Uint8Array,
  quote: { idOrAddress: string; relay?: string; pubkey?: string }
): Event {
  const q = createQuoteTag(quote.idOrAddress, quote.relay, quote.pubkey)
  return finishRepostEvent(
    { ...t, tags: [...(t.tags ?? []), q] },
    reposted,
    relayUrl,
    privateKey
  )
}

export function finishRepostEvent(
  t: RepostEventTemplate,
  reposted: Event,
  relayUrl: string,
  privateKey: Uint8Array
): Event {
  let kind: typeof Repost | typeof GenericRepost
  const tags = [...(t.tags ?? []), ["e", reposted.id, relayUrl], ["p", reposted.pubkey]]

  // Generic repost of addressable: include a tag (kind:pubkey:d)
  if (reposted.kind >= 30000 && reposted.kind < 40000) {
    const d = reposted.tags.find((x) => x[0] === "d")?.[1] ?? ""
    tags.push(["a", `${reposted.kind}:${reposted.pubkey}:${d}`, relayUrl])
  }

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
