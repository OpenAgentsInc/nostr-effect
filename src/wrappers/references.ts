/**
 * Reference Parsing
 *
 * Parse nostr: mentions from event content (NIP-27 style and legacy NIP-10 style).
 *
 * @example
 * ```typescript
 * import { parseReferences } from 'nostr-effect/references'
 *
 * const refs = parseReferences(event)
 * for (const ref of refs) {
 *   if (ref.profile) console.log('Mentioned profile:', ref.profile.pubkey)
 *   if (ref.event) console.log('Mentioned event:', ref.event.id)
 * }
 * ```
 */

import { decode } from "./nip19.js"
import type { AddressPointer, ProfilePointer, EventPointer } from "./nip19.js"

/** Event type */
export interface Event {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Reference extracted from event content */
export interface Reference {
  text: string
  profile?: ProfilePointer
  event?: EventPointer
  address?: AddressPointer
}

const mentionRegex = /\bnostr:((note|npub|naddr|nevent|nprofile)1\w+)\b|#\[(\d+)\]/g

/**
 * Parse nostr: references from event content
 * Supports both NIP-27 (nostr:) and legacy NIP-10 (#[index]) formats
 */
export function parseReferences(evt: Event): Reference[] {
  const references: Reference[] = []

  for (const ref of evt.content.matchAll(mentionRegex)) {
    if (ref[2]) {
      // It's a NIP-27 mention (nostr:...)
      try {
        const { type, data } = decode(ref[1]!)
        switch (type) {
          case "npub": {
            references.push({
              text: ref[0],
              profile: { pubkey: data as string, relays: [] },
            })
            break
          }
          case "nprofile": {
            references.push({
              text: ref[0],
              profile: data as ProfilePointer,
            })
            break
          }
          case "note": {
            references.push({
              text: ref[0],
              event: { id: data as string, relays: [] },
            })
            break
          }
          case "nevent": {
            references.push({
              text: ref[0],
              event: data as EventPointer,
            })
            break
          }
          case "naddr": {
            references.push({
              text: ref[0],
              address: data as AddressPointer,
            })
            break
          }
        }
      } catch (_err) {
        // Ignore invalid references
      }
    } else if (ref[3]) {
      // It's a legacy NIP-10 mention (#[index])
      const idx = parseInt(ref[3], 10)
      const tag = evt.tags[idx]
      if (!tag) continue

      switch (tag[0]) {
        case "p": {
          references.push({
            text: ref[0],
            profile: { pubkey: tag[1]!, relays: tag[2] ? [tag[2]] : [] },
          })
          break
        }
        case "e": {
          references.push({
            text: ref[0],
            event: { id: tag[1]!, relays: tag[2] ? [tag[2]] : [] },
          })
          break
        }
        case "a": {
          try {
            const [kind, pubkey, identifier] = tag[1]!.split(":")
            references.push({
              text: ref[0],
              address: {
                identifier: identifier || "",
                pubkey: pubkey || "",
                kind: parseInt(kind || "0", 10),
                relays: tag[2] ? [tag[2]] : [],
              },
            })
          } catch (_err) {
            // Ignore parse errors
          }
          break
        }
      }
    }
  }

  return references
}
