/**
 * Nostr Utilities
 *
 * Common helper functions for working with Nostr events.
 *
 * @example
 * ```typescript
 * import { matchFilter, matchFilters, sortEvents, normalizeURL } from 'nostr-effect/utils'
 *
 * // Check if an event matches a filter
 * const matches = matchFilter({ kinds: [1], authors: [pubkey] }, event)
 *
 * // Sort events newest first
 * const sorted = sortEvents(events)
 * ```
 */

import type { NostrEvent } from "./pure.js"
import type { Filter } from "./pool.js"

export type { Filter, NostrEvent }

// =============================================================================
// Filter Matching
// =============================================================================

/**
 * Check if an event matches a single filter.
 *
 * @param filter - Filter to match against
 * @param event - Event to check
 * @returns true if event matches all filter criteria
 */
export function matchFilter(filter: Filter, event: NostrEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false
  if (filter.since && event.created_at < filter.since) return false
  if (filter.until && event.created_at > filter.until) return false

  // Check tag filters
  for (const key of Object.keys(filter)) {
    if (key.startsWith("#")) {
      const tagName = key.slice(1)
      const filterValues = filter[key as `#${string}`]
      if (filterValues) {
        const eventTagValues = event.tags.filter((t) => t[0] === tagName).map((t) => t[1])
        if (!filterValues.some((v) => eventTagValues.includes(v))) return false
      }
    }
  }

  return true
}

/**
 * Check if an event matches any of the filters.
 *
 * @param filters - Array of filters to match against
 * @param event - Event to check
 * @returns true if event matches at least one filter
 */
export function matchFilters(filters: Filter[], event: NostrEvent): boolean {
  for (const filter of filters) {
    if (matchFilter(filter, event)) return true
  }
  return false
}

// =============================================================================
// Event Sorting
// =============================================================================

/**
 * Sort events in reverse chronological order (newest first).
 * Secondary sort by event ID for deterministic ordering.
 *
 * @param events - Events to sort
 * @returns New sorted array (does not mutate input)
 */
export function sortEvents(events: NostrEvent[]): NostrEvent[] {
  return [...events].sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return b.created_at - a.created_at
    }
    return a.id.localeCompare(b.id)
  })
}

/**
 * Sort events in chronological order (oldest first).
 *
 * @param events - Events to sort
 * @returns New sorted array (does not mutate input)
 */
export function sortEventsAsc(events: NostrEvent[]): NostrEvent[] {
  return [...events].sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at - b.created_at
    }
    return a.id.localeCompare(b.id)
  })
}

// =============================================================================
// URL Normalization
// =============================================================================

/**
 * Normalize a relay URL to a consistent format.
 * - Adds wss:// protocol if missing
 * - Removes trailing slash
 * - Lowercases the hostname
 *
 * @param url - Relay URL to normalize
 * @returns Normalized URL
 */
export function normalizeURL(url: string): string {
  let normalized = url.trim()

  // Add protocol if missing
  if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
    normalized = `wss://${normalized}`
  }

  // Remove trailing slash
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

// =============================================================================
// Tag Helpers
// =============================================================================

/**
 * Get the first value of a tag by name.
 *
 * @param event - Event to search
 * @param tagName - Tag name (e.g., "e", "p", "d")
 * @returns First tag value or undefined
 */
export function getTagValue(event: NostrEvent, tagName: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === tagName)
  return tag?.[1]
}

/**
 * Get all values of a tag by name.
 *
 * @param event - Event to search
 * @param tagName - Tag name (e.g., "e", "p", "d")
 * @returns Array of tag values
 */
export function getTagValues(event: NostrEvent, tagName: string): string[] {
  return event.tags.filter((t) => t[0] === tagName).map((t) => t[1]!).filter(Boolean)
}

/**
 * Get all tags of a specific type.
 *
 * @param event - Event to search
 * @param tagName - Tag name (e.g., "e", "p", "d")
 * @returns Array of full tag arrays
 */
export function getTags(event: NostrEvent, tagName: string): string[][] {
  return event.tags.filter((t) => t[0] === tagName)
}

// =============================================================================
// Event ID Helpers
// =============================================================================

/**
 * Extract referenced event IDs from an event's tags.
 *
 * @param event - Event to search
 * @returns Array of event IDs referenced via "e" tags
 */
export function getReferencedEventIds(event: NostrEvent): string[] {
  return getTagValues(event, "e")
}

/**
 * Extract referenced pubkeys from an event's tags.
 *
 * @param event - Event to search
 * @returns Array of pubkeys referenced via "p" tags
 */
export function getReferencedPubkeys(event: NostrEvent): string[] {
  return getTagValues(event, "p")
}

/**
 * Extract the "d" tag value (identifier for parameterized replaceable events).
 *
 * @param event - Event to search
 * @returns The "d" tag value or empty string
 */
export function getDTag(event: NostrEvent): string {
  return getTagValue(event, "d") ?? ""
}

// =============================================================================
// Timestamp Helpers
// =============================================================================

/**
 * Get current Unix timestamp in seconds.
 *
 * @returns Current timestamp
 */
export function now(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Convert Unix timestamp to Date object.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns Date object
 */
export function timestampToDate(timestamp: number): Date {
  return new Date(timestamp * 1000)
}

/**
 * Convert Date to Unix timestamp.
 *
 * @param date - Date object
 * @returns Unix timestamp in seconds
 */
export function dateToTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

// =============================================================================
// Deduplication
// =============================================================================

/**
 * Remove duplicate events by ID.
 *
 * @param events - Events to deduplicate
 * @returns Array with duplicates removed (keeps first occurrence)
 */
export function deduplicateEvents(events: NostrEvent[]): NostrEvent[] {
  const seen = new Set<string>()
  return events.filter((event) => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  })
}

/**
 * Get the latest version of each replaceable event.
 * Groups by pubkey (and d-tag for parameterized replaceable events)
 * and keeps only the newest version.
 *
 * @param events - Events to filter
 * @returns Array with only latest versions
 */
export function getLatestReplaceable(events: NostrEvent[]): NostrEvent[] {
  const latest = new Map<string, NostrEvent>()

  for (const event of events) {
    // Create key based on pubkey + kind (+ d-tag for parameterized replaceable)
    const dTag = getDTag(event)
    const key = `${event.pubkey}:${event.kind}:${dTag}`

    const existing = latest.get(key)
    if (!existing || event.created_at > existing.created_at) {
      latest.set(key, event)
    }
  }

  return Array.from(latest.values())
}
