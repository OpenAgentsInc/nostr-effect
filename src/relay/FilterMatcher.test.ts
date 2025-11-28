/**
 * Tests for FilterMatcher (NIP-01 filter matching)
 *
 * Test cases ported from nostr-tools filter.test.ts for cross-implementation parity
 */
import { describe, test, expect } from "bun:test"
import { matchesFilter, matchesFilters } from "./core/FilterMatcher.js"
import {
  type NostrEvent,
  type Filter,
  type EventKind,
  type EventId,
  type PublicKey,
  type Signature,
  type Tag,
  type UnixTimestamp,
} from "../core/Schema.js"
import { Schema } from "effect"

// Helper to decode branded types
const decodeTag = Schema.decodeSync(
  Schema.Tuple(Schema.String, Schema.String).pipe(Schema.brand("Tag"))
) as (input: [string, string]) => Tag

// Helper to build test events (similar to nostr-tools test-helpers.ts buildEvent)
const buildEvent = (partial: {
  id?: string
  pubkey?: string
  created_at?: number
  kind?: number
  tags?: string[][]
  content?: string
  sig?: string
}): NostrEvent => {
  return {
    id: (partial.id ?? "0000000000000000000000000000000000000000000000000000000000000000") as EventId,
    pubkey: (partial.pubkey ?? "0000000000000000000000000000000000000000000000000000000000000000") as PublicKey,
    created_at: (partial.created_at ?? Math.floor(Date.now() / 1000)) as UnixTimestamp,
    kind: (partial.kind ?? 1) as EventKind,
    tags: (partial.tags ?? []).map((t) => decodeTag([t[0]!, t[1] ?? ""])) as Tag[],
    content: partial.content ?? "",
    sig: (partial.sig ?? "0".repeat(128)) as Signature,
  }
}

// Helper to build filters with proper typing
const buildFilter = (partial: {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  "#e"?: string[]
  "#p"?: string[]
  "#a"?: string[]
  "#d"?: string[]
  "#t"?: string[]
}): Filter => {
  const result: Record<string, unknown> = {}

  if (partial.ids) result.ids = partial.ids as EventId[]
  if (partial.authors) result.authors = partial.authors as PublicKey[]
  if (partial.kinds) result.kinds = partial.kinds as EventKind[]
  if (partial.since !== undefined) result.since = partial.since as UnixTimestamp
  if (partial.until !== undefined) result.until = partial.until as UnixTimestamp
  if (partial.limit !== undefined) result.limit = partial.limit
  if (partial["#e"]) result["#e"] = partial["#e"]
  if (partial["#p"]) result["#p"] = partial["#p"]
  if (partial["#a"]) result["#a"] = partial["#a"]
  if (partial["#d"]) result["#d"] = partial["#d"]
  if (partial["#t"]) result["#t"] = partial["#t"]

  return result as unknown as Filter
}

describe("FilterMatcher", () => {
  describe("matchesFilter", () => {
    // From nostr-tools: should return true when all filter conditions are met
    // NOTE: Our FilterMatcher only supports specific tags: #e, #p, #a, #d, #t
    test("returns true when all filter conditions are met", () => {
      const filter = buildFilter({
        ids: ["123", "456"],
        kinds: [1, 2, 3],
        authors: ["abc"],
        since: 100,
        until: 200,
        "#e": ["event-ref"],
      })
      const event = buildEvent({
        id: "123",
        kind: 1,
        pubkey: "abc",
        created_at: 150,
        tags: [["e", "event-ref"]],
      })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // From nostr-tools: should return false when the event id is not in the filter
    test("returns false when the event id is not in the filter", () => {
      const filter = buildFilter({ ids: ["123", "456"] })
      const event = buildEvent({ id: "789" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when the event kind is not in the filter
    test("returns false when the event kind is not in the filter", () => {
      const filter = buildFilter({ kinds: [1, 2, 3] })
      const event = buildEvent({ kind: 4 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when the event author is not in the filter
    test("returns false when the event author is not in the filter", () => {
      const filter = buildFilter({ authors: ["abc", "def"] })
      const event = buildEvent({ pubkey: "ghi" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when a tag is not present in the event
    // NOTE: Our FilterMatcher only supports specific tags: #e, #p, #a, #d, #t
    test("returns false when a tag is not present in the event", () => {
      const filter = buildFilter({ "#e": ["value1", "value2"] })
      const event = buildEvent({ tags: [["p", "value1"]] }) // different tag type
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when a tag value is not present in the event
    test("returns false when a tag value is not present in the event", () => {
      const filter = buildFilter({ "#e": ["value1", "value2"] })
      const event = buildEvent({ tags: [["e", "value3"]] })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return true when filter has tags that is present in the event
    test("returns true when filter has tags present in the event", () => {
      const filter = buildFilter({ "#e": ["foo"] })
      const event = buildEvent({
        id: "123",
        kind: 1,
        pubkey: "abc",
        created_at: 150,
        tags: [
          ["e", "foo"],
          ["p", "bar"],
        ],
      })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // From nostr-tools: should return false when the event is before the filter since value
    test("returns false when the event is before the filter since value", () => {
      const filter = buildFilter({ since: 100 })
      const event = buildEvent({ created_at: 50 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return true when the timestamp of event is equal to the filter since value
    test("returns true when timestamp equals filter since value (inclusive)", () => {
      const filter = buildFilter({ since: 100 })
      const event = buildEvent({ created_at: 100 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // From nostr-tools: should return false when the event is after the filter until value
    test("returns false when the event is after the filter until value", () => {
      const filter = buildFilter({ until: 100 })
      const event = buildEvent({ created_at: 150 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return true when the timestamp of event is equal to the filter until value
    test("returns true when timestamp equals filter until value (inclusive)", () => {
      const filter = buildFilter({ until: 100 })
      const event = buildEvent({ created_at: 100 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // Additional tests for prefix matching
    test("supports prefix matching for ids", () => {
      const filter = buildFilter({ ids: ["abc"] })
      const event = buildEvent({ id: "abcdef1234567890" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    test("supports prefix matching for authors", () => {
      const filter = buildFilter({ authors: ["abc"] })
      const event = buildEvent({ pubkey: "abcdef1234567890" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // Empty filter tests
    test("returns true for empty filter (matches all)", () => {
      const filter = buildFilter({})
      const event = buildEvent({ id: "123", kind: 1, pubkey: "abc" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // Multiple tag filter tests
    test("handles multiple tag filters (AND logic)", () => {
      const filter = buildFilter({ "#e": ["event1"], "#p": ["pubkey1"] })
      const event = buildEvent({
        tags: [
          ["e", "event1"],
          ["p", "pubkey1"],
        ],
      })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    test("returns false when one tag filter doesn't match (AND logic)", () => {
      const filter = buildFilter({ "#e": ["event1"], "#p": ["pubkey1"] })
      const event = buildEvent({
        tags: [
          ["e", "event1"],
          ["p", "pubkey2"],
        ],
      })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })
  })

  describe("matchesFilters", () => {
    // From nostr-tools: should return true when at least one filter matches the event
    test("returns true when at least one filter matches the event", () => {
      const filters: Filter[] = [
        buildFilter({ ids: ["123"], kinds: [1], authors: ["abc"] }),
        buildFilter({ ids: ["456"], kinds: [2], authors: ["def"] }),
        buildFilter({ ids: ["789"], kinds: [3], authors: ["ghi"] }),
      ]
      const event = buildEvent({ id: "789", kind: 3, pubkey: "ghi" })
      const result = matchesFilters(event, filters)
      expect(result).toBe(true)
    })

    // From nostr-tools: should return true when event matches filters with limit set
    test("returns true when event matches filters with limit set", () => {
      const filters: Filter[] = [
        buildFilter({ ids: ["123"], limit: 1 }),
        buildFilter({ kinds: [1], limit: 2 }),
        buildFilter({ authors: ["abc"], limit: 3 }),
      ]

      const event = buildEvent({
        id: "123",
        kind: 1,
        pubkey: "abc",
        created_at: 150,
      })

      const result = matchesFilters(event, filters)
      expect(result).toBe(true)
    })

    // From nostr-tools: should return false when no filters match the event
    test("returns false when no filters match the event", () => {
      const filters: Filter[] = [
        buildFilter({ ids: ["123"], kinds: [1], authors: ["abc"] }),
        buildFilter({ ids: ["456"], kinds: [2], authors: ["def"] }),
        buildFilter({ ids: ["789"], kinds: [3], authors: ["ghi"] }),
      ]
      const event = buildEvent({ id: "100", kind: 4, pubkey: "jkl" })
      const result = matchesFilters(event, filters)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when event matches none of the filters
    test("returns false when event matches none of the filters with limit", () => {
      const filters: Filter[] = [
        buildFilter({ ids: ["123"], limit: 1 }),
        buildFilter({ kinds: [1], limit: 2 }),
        buildFilter({ authors: ["abc"], limit: 3 }),
      ]
      const event = buildEvent({
        id: "456",
        kind: 2,
        pubkey: "def",
        created_at: 200,
      })
      const result = matchesFilters(event, filters)
      expect(result).toBe(false)
    })

    // Empty filters array
    test("returns false for empty filters array", () => {
      const event = buildEvent({ id: "123", kind: 1 })
      const result = matchesFilters(event, [])
      expect(result).toBe(false)
    })

    // Single filter
    test("works with single filter in array", () => {
      const filters: Filter[] = [buildFilter({ kinds: [1] })]
      const event = buildEvent({ kind: 1 })
      const result = matchesFilters(event, filters)
      expect(result).toBe(true)
    })
  })

  // Tests specific to our implementation
  describe("supported tag filters", () => {
    test("supports #e tag filter", () => {
      const filter = buildFilter({ "#e": ["event123"] })
      const event = buildEvent({ tags: [["e", "event123"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("supports #p tag filter", () => {
      const filter = buildFilter({ "#p": ["pubkey123"] })
      const event = buildEvent({ tags: [["p", "pubkey123"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("supports #a tag filter", () => {
      const filter = buildFilter({ "#a": ["30023:pubkey:identifier"] })
      const event = buildEvent({ tags: [["a", "30023:pubkey:identifier"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("supports #d tag filter", () => {
      const filter = buildFilter({ "#d": ["my-identifier"] })
      const event = buildEvent({ tags: [["d", "my-identifier"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("supports #t tag filter", () => {
      const filter = buildFilter({ "#t": ["nostr"] })
      const event = buildEvent({ tags: [["t", "nostr"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })
  })

  // Realistic event tests
  describe("realistic event matching", () => {
    test("matches kind 0 profile event", () => {
      const filter = buildFilter({
        kinds: [0],
        authors: ["abc123"],
      })
      const event = buildEvent({
        kind: 0,
        pubkey: "abc123def456",
        content: JSON.stringify({ name: "Alice", about: "Testing" }),
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("matches kind 1 text note", () => {
      const filter = buildFilter({
        kinds: [1],
        since: 1700000000,
      })
      const event = buildEvent({
        kind: 1,
        created_at: 1700000001,
        content: "Hello Nostr!",
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("matches kind 3 follow list", () => {
      const filter = buildFilter({
        kinds: [3],
        authors: ["user"],
      })
      const event = buildEvent({
        kind: 3,
        pubkey: "user123",
        tags: [
          ["p", "friend1"],
          ["p", "friend2"],
        ],
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("matches kind 10002 relay list", () => {
      const filter = buildFilter({
        kinds: [10002],
      })
      const event = buildEvent({
        kind: 10002,
        tags: [
          ["r", "wss://relay1.example.com"],
          ["r", "wss://relay2.example.com"],
        ],
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("matches kind 30023 long-form content", () => {
      const filter = buildFilter({
        kinds: [30023],
        "#d": ["my-article"],
      })
      const event = buildEvent({
        kind: 30023,
        tags: [["d", "my-article"]],
        content: "# My Article\n\nThis is long-form content...",
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })
  })
})
