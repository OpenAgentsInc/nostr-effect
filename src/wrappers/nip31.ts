/**
 * NIP-31: Dealing with unknown event kinds (alt tag)
 *
 * Provides helpers to add and read the `alt` tag that gives a
 * human-readable summary for non-kind-1 custom events.
 */
import type { Tag, NostrEvent } from "../core/Schema.js"

/** Add or replace the `alt` tag in a tag list */
export function withAltTag(tags: Tag[], alt: string): Tag[] {
  const filtered = tags.filter((t) => t[0] !== "alt")
  return [...filtered, ["alt", alt] as unknown as Tag]
}

/** Get the `alt` tag value from an event, if present */
export function getAltTag(event: NostrEvent): string | null {
  const t = event.tags.find((x) => x[0] === "alt")
  return t?.[1] ?? null
}
