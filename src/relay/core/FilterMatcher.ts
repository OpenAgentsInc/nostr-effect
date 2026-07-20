/**
 * FilterMatcher
 *
 * Shared filter matching logic for NIP-01.
 * Used by both EventStore and SubscriptionManager.
 */
import type { NostrEvent, Filter } from "../../core/Schema.js"

/** True if key is a NIP-01 single-letter tag filter (`#` + a-zA-Z). */
const isTagFilterKey = (key: string): boolean =>
  key.length === 2 && key.startsWith("#") && /^[a-zA-Z]$/.test(key[1]!)

/**
 * Check if an event matches a single filter (AND logic within filter)
 */
export const matchesFilter = (event: NostrEvent, filter: Filter): boolean => {
  // ids - prefix match
  if (filter.ids && filter.ids.length > 0) {
    if (!filter.ids.some((id) => event.id.startsWith(id))) return false
  }

  // authors - prefix match
  if (filter.authors && filter.authors.length > 0) {
    if (!filter.authors.some((author) => event.pubkey.startsWith(author))) return false
  }

  // kinds - exact match
  if (filter.kinds && filter.kinds.length > 0) {
    if (!filter.kinds.includes(event.kind)) return false
  }

  // since - created_at >= since
  if (filter.since !== undefined) {
    if (event.created_at < filter.since) return false
  }

  // until - created_at <= until
  if (filter.until !== undefined) {
    if (event.created_at > filter.until) return false
  }

  // Tag filters: any single-letter `#X` key (NIP-01 / NIP-12)
  // Only the first value of each tag is indexed.
  for (const [key, rawValues] of Object.entries(filter as unknown as Record<string, unknown>)) {
    if (!isTagFilterKey(key)) continue
    if (!Array.isArray(rawValues) || rawValues.length === 0) continue

    const tagName = key[1]!
    const tagValues = rawValues as readonly string[]
    const eventTagValues = event.tags
      .filter((tag) => tag[0] === tagName)
      .map((tag) => tag[1])
      .filter((v): v is string => typeof v === "string")

    if (!tagValues.some((v) => eventTagValues.includes(v))) return false
  }

  // NIP-50: basic search on content (case-insensitive substring)
  if (filter.search && filter.search.trim().length > 0) {
    const needle = filter.search.toLowerCase()
    if (!event.content.toLowerCase().includes(needle)) return false
  }

  return true
}

/**
 * Check if an event matches any filter (OR logic between filters)
 */
export const matchesFilters = (event: NostrEvent, filters: readonly Filter[]): boolean => {
  if (filters.length === 0) return false
  return filters.some((filter) => matchesFilter(event, filter))
}
