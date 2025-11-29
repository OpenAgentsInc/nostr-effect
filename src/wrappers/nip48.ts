/**
 * NIP-48: Proxy Tags
 * Helpers to add and read proxy tags that link events bridged from other protocols.
 * Format: ["proxy", <id>, <protocol>]
 */
import type { Tag, NostrEvent } from "../core/Schema.js"

export interface ProxyTag {
  readonly id: string
  readonly protocol: string
}

/** Add a proxy tag; returns new tags (does not remove existing proxy tags) */
export function addProxyTag(tags: Tag[], id: string, protocol: string): Tag[] {
  const proxy: Tag = (["proxy", id, protocol] as unknown) as Tag
  return [...tags, proxy]
}

/** Get all proxy tags from an event */
export function getProxyTags(event: NostrEvent): readonly ProxyTag[] {
  return event.tags
    .filter((t) => t[0] === "proxy" && typeof t[1] === "string" && typeof t[2] === "string")
    .map((t) => ({ id: t[1]!, protocol: t[2]! }))
}

