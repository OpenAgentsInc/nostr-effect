/**
 * FilterMatcher
 *
 * Shared filter matching logic for NIP-01.
 * Used by both EventStore and SubscriptionManager.
 */
import type { NostrEvent, Filter } from "../../core/Schema.js"

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

  // Tag filters (#e, #p, #a, #d, #t)
  const tagFilters: Array<[string, readonly string[] | undefined]> = [
    ["e", filter["#e"] as readonly string[] | undefined],
    ["p", filter["#p"] as readonly string[] | undefined],
    ["a", filter["#a"] as readonly string[] | undefined],
    ["d", filter["#d"] as readonly string[] | undefined],
    ["t", filter["#t"] as readonly string[] | undefined],
  ]

  for (const [tagName, tagValues] of tagFilters) {
    if (tagValues && tagValues.length > 0) {
      const eventTagValues = event.tags.filter((tag) => tag[0] === tagName).map((tag) => tag[1])
      if (!tagValues.some((v) => eventTagValues.includes(v))) return false
    }
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
