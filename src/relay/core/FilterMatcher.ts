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

  // NIP-50: search with optional extensions (include:spam, domain:, language:)
  if (filter.search && filter.search.trim().length > 0) {
    if (!matchesSearch(event, filter.search)) return false
  }

  return true
}

/**
 * Parse a NIP-50 search string into free-text terms and known extensions.
 * Unknown extension tokens are treated as free-text terms.
 */
export interface ParsedSearchQuery {
  readonly terms: readonly string[]
  readonly includeSpam: boolean
  readonly domain?: string
  readonly language?: string
}

export const parseSearchQuery = (search: string): ParsedSearchQuery => {
  const tokens = search.trim().split(/\s+/).filter(Boolean)
  const terms: string[] = []
  let includeSpam = false
  let domain: string | undefined
  let language: string | undefined

  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower === "include:spam") {
      includeSpam = true
      continue
    }
    if (lower.startsWith("domain:")) {
      domain = token.slice("domain:".length).toLowerCase()
      continue
    }
    if (lower.startsWith("language:")) {
      language = token.slice("language:".length).toLowerCase()
      continue
    }
    terms.push(token)
  }

  return {
    terms,
    includeSpam,
    ...(domain !== undefined ? { domain } : {}),
    ...(language !== undefined ? { language } : {}),
  }
}

/**
 * Match event against NIP-50 search string.
 * - Free-text terms: all must appear in content (case-insensitive)
 * - include:spam: no-op here (we do not spam-filter by default)
 * - domain: matches against any tag value containing the domain (e.g. nip05-like)
 * - language: matches optional `l` language tags (ISO 639-1)
 */
export const matchesSearch = (event: NostrEvent, search: string): boolean => {
  const parsed = parseSearchQuery(search)
  const content = event.content.toLowerCase()

  for (const term of parsed.terms) {
    if (!content.includes(term.toLowerCase())) return false
  }

  if (parsed.domain) {
    const domain = parsed.domain
    const tagHit = event.tags.some(
      (t) => t[1] !== undefined && t[1].toLowerCase().includes(domain)
    )
    const contentHit = content.includes(domain)
    if (!tagHit && !contentHit) return false
  }

  if (parsed.language) {
    const langs = event.tags
      .filter((t) => t[0] === "l" || t[0] === "L")
      .map((t) => t[1]?.toLowerCase())
      .filter((v): v is string => typeof v === "string")
    // If the event declares language tags, require a match; otherwise allow (unknown)
    if (langs.length > 0 && !langs.some((l) => l === parsed.language || l.startsWith(parsed.language!))) {
      return false
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
