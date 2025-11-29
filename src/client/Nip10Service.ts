/**
 * NIP-10 Service
 *
 * Thread/reply parsing for Nostr events.
 * Extracts root, reply, mentions, and profiles from event tags.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/10.md
 */
import type { NostrEvent } from "../core/Schema.js"
import type { EventPointer, ProfilePointer } from "../core/Nip19.js"

// =============================================================================
// Types
// =============================================================================

/** Result of parsing event tags for thread structure */
export interface ThreadReferences {
  /** Pointer to the root of the thread */
  readonly root: EventPointer | undefined
  /** Pointer to the event being replied to */
  readonly reply: EventPointer | undefined
  /** Pointers to mentioned events (may or may not be in reply chain) */
  readonly mentions: EventPointer[]
  /** Pointers to quoted events (q tags) */
  readonly quotes: EventPointer[]
  /** List of pubkeys involved in the thread */
  readonly profiles: ProfilePointer[]
}

// =============================================================================
// Functions
// =============================================================================

/** Internal mutable event pointer for building */
interface MutableEventPointer {
  id: string
  relays: string[]
  author?: string
  kind?: number
}

/** Internal mutable profile pointer for building */
interface MutableProfilePointer {
  pubkey: string
  relays: string[]
}

/** Create an EventPointer, only including author if defined */
function makeEventPointer(id: string, relays: string[], author?: string): MutableEventPointer {
  const pointer: MutableEventPointer = { id, relays }
  if (author !== undefined) {
    pointer.author = author
  }
  return pointer
}

/**
 * Parse event tags to extract thread structure.
 * Handles both NIP-10 marked tags and legacy positional tags.
 *
 * @param event - Event or object with tags array
 * @returns Thread references including root, reply, mentions, quotes, and profiles
 */
export function parse(event: Pick<NostrEvent, "tags"> | { tags: string[][] }): ThreadReferences {
  // Mutable versions for building
  const mentions: MutableEventPointer[] = []
  const quotes: MutableEventPointer[] = []
  const profiles: MutableProfilePointer[] = []

  let root: MutableEventPointer | undefined
  let reply: MutableEventPointer | undefined
  let maybeParent: MutableEventPointer | undefined
  let maybeRoot: MutableEventPointer | undefined

  // Iterate in reverse to handle legacy positional tags correctly
  for (let i = event.tags.length - 1; i >= 0; i--) {
    const tag = event.tags[i] as string[]

    if (tag[0] === "e" && tag[1]) {
      const [, eTagEventId, eTagRelayUrl, eTagMarker, eTagAuthor] = tag

      const eventPointer = makeEventPointer(
        eTagEventId!,
        eTagRelayUrl ? [eTagRelayUrl] : [],
        eTagAuthor
      )

      if (eTagMarker === "root") {
        root = eventPointer
        continue
      }

      if (eTagMarker === "reply") {
        reply = eventPointer
        continue
      }

      if (eTagMarker === "mention") {
        mentions.push(eventPointer)
        continue
      }

      // Legacy positional handling
      if (!maybeParent) {
        maybeParent = eventPointer
      } else {
        maybeRoot = eventPointer
      }

      mentions.push(eventPointer)
      continue
    }

    // Quote tags (q)
    if (tag[0] === "q" && tag[1]) {
      const [, qTagEventId, qTagRelayUrl] = tag
      quotes.push({
        id: qTagEventId!,
        relays: qTagRelayUrl ? [qTagRelayUrl] : [],
      })
      continue
    }

    // Profile tags (p)
    if (tag[0] === "p" && tag[1]) {
      profiles.push({
        pubkey: tag[1],
        relays: tag[2] ? [tag[2]] : [],
      })
      continue
    }
  }

  // Get legacy (positional) markers, set reply to root and vice-versa if one is missing
  if (!root) {
    root = maybeRoot || maybeParent || reply
  }
  if (!reply) {
    reply = maybeParent || root
  }

  // Remove root and reply from mentions
  const filteredMentions = mentions.filter(
    (m) => m !== root && m !== reply && m.id !== root?.id && m.id !== reply?.id
  )

  // Inherit relay hints from author profiles
  const addRelaysFromAuthor = (ref: MutableEventPointer | undefined) => {
    if (!ref || !ref.author) return

    const authorProfile = profiles.find((p) => p.pubkey === ref.author)
    if (authorProfile && authorProfile.relays) {
      authorProfile.relays.forEach((url) => {
        if (!ref.relays.includes(url)) {
          ref.relays.push(url)
        }
      })
    }
  }

  addRelaysFromAuthor(reply)
  addRelaysFromAuthor(root)
  filteredMentions.forEach(addRelaysFromAuthor)

  return {
    root: root as EventPointer | undefined,
    reply: reply as EventPointer | undefined,
    mentions: filteredMentions as EventPointer[],
    quotes: quotes as EventPointer[],
    profiles: profiles as ProfilePointer[],
  }
}

/**
 * Check if an event is a reply (has reply or root reference)
 */
export function isReply(event: Pick<NostrEvent, "tags"> | { tags: string[][] }): boolean {
  const refs = parse(event)
  return refs.reply !== undefined || refs.root !== undefined
}

/**
 * Check if an event is a root event (has no reply references)
 */
export function isRoot(event: Pick<NostrEvent, "tags"> | { tags: string[][] }): boolean {
  return !isReply(event)
}

/**
 * Get the event ID being replied to (prefers reply, falls back to root)
 */
export function getReplyToId(event: Pick<NostrEvent, "tags"> | { tags: string[][] }): string | undefined {
  const refs = parse(event)
  return refs.reply?.id ?? refs.root?.id
}

/**
 * Get the root event ID of the thread
 */
export function getRootId(event: Pick<NostrEvent, "tags"> | { tags: string[][] }): string | undefined {
  const refs = parse(event)
  return refs.root?.id
}
