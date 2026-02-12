/**
 * NIP-51: Pure helpers for lists (public tags only; private needs NIP-44 decrypt)
 */
import type { Event } from "./pure.js"

export type ListItem = readonly string[]

export interface ParsedList {
  readonly d?: string
  readonly publicItems: readonly ListItem[]
}

export function parsePublicItems(event: Event): ParsedList["publicItems"] {
  return event.tags.filter(t => t[0] !== "d" && t.length >= 2)
}

export function getLatestList(
  events: readonly Event[], 
  author: string, 
  kind: number, 
  d?: string
): Event | null {
  let candidates = events.filter(e => e.pubkey === author && e.kind === kind)
  if (d) {
    candidates = candidates.filter(e => e.tags.some(t => t[0] === "d" && t[1] === d))
  }
  if (candidates.length === 0) return null
  return candidates.reduce((acc, e) => e.created_at > (acc?.created_at ?? 0) ? e : acc!, null!)
}
