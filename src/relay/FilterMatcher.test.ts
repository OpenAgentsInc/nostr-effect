/**
 * Tests for FilterMatcher (NIP-01 filter matching)
 *
 * Test cases ported from nostr-tools filter.test.ts for cross-implementation parity
 */
import { describe, test, expect } from "bun:test"
import { matchesFilter, matchesFilters } from "./FilterMatcher.js"
import type { NostrEvent, Filter, EventKind, EventId, PublicKey, Signature, Tag } from "../core/Schema.js"
import { Schema } from "effect"

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
  const decodeTag = Schema.decodeSync(Schema.Tuple(Schema.String, Schema.String).pipe(
    Schema.brand("Tag")
  )) as (input: [string, string]) => Tag

  return {
    id: (partial.id ?? "0000000000000000000000000000000000000000000000000000000000000000") as EventId,
    pubkey: (partial.pubkey ?? "0000000000000000000000000000000000000000000000000000000000000000") as PublicKey,
    created_at: partial.created_at ?? Math.floor(Date.now() / 1000),
    kind: (partial.kind ?? 1) as EventKind,
    tags: (partial.tags ?? []).map(t => decodeTag([t[0]!, t[1] ?? ""])) as Tag[],
    content: partial.content ?? "",
    sig: (partial.sig ?? "0".repeat(128)) as Signature,
  }
}

describe("FilterMatcher", () => {
  describe("matchesFilter", () => {
    // From nostr-tools: should return true when all filter conditions are met
    // NOTE: Our FilterMatcher only supports specific tags: #e, #p, #a, #d, #t
    test("returns true when all filter conditions are met", () => {
      const filter: Filter = {
        ids: ["123", "456"] as EventId[],
        kinds: [1, 2, 3] as EventKind[],
        authors: ["abc"] as PublicKey[],
        since: 100,
        until: 200,
        "#e": ["event-ref"],
      }
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
      const filter: Filter = { ids: ["123", "456"] as EventId[] }
      const event = buildEvent({ id: "789" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when the event kind is not in the filter
    test("returns false when the event kind is not in the filter", () => {
      const filter: Filter = { kinds: [1, 2, 3] as EventKind[] }
      const event = buildEvent({ kind: 4 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when the event author is not in the filter
    test("returns false when the event author is not in the filter", () => {
      const filter: Filter = { authors: ["abc", "def"] as PublicKey[] }
      const event = buildEvent({ pubkey: "ghi" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when a tag is not present in the event
    // NOTE: Our FilterMatcher only supports specific tags: #e, #p, #a, #d, #t
    test("returns false when a tag is not present in the event", () => {
      const filter: Filter = { "#e": ["value1", "value2"] }
      const event = buildEvent({ tags: [["p", "value1"]] }) // different tag type
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when a tag value is not present in the event
    test("returns false when a tag value is not present in the event", () => {
      const filter: Filter = { "#e": ["value1", "value2"] }
      const event = buildEvent({ tags: [["e", "value3"]] })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return true when filter has tags that is present in the event
    test("returns true when filter has tags present in the event", () => {
      const filter: Filter = { "#e": ["foo"] }
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
      const filter: Filter = { since: 100 }
      const event = buildEvent({ created_at: 50 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return true when the timestamp of event is equal to the filter since value
    test("returns true when timestamp equals filter since value (inclusive)", () => {
      const filter: Filter = { since: 100 }
      const event = buildEvent({ created_at: 100 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // From nostr-tools: should return false when the event is after the filter until value
    test("returns false when the event is after the filter until value", () => {
      const filter: Filter = { until: 100 }
      const event = buildEvent({ created_at: 150 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return true when the timestamp of event is equal to the filter until value
    test("returns true when timestamp equals filter until value (inclusive)", () => {
      const filter: Filter = { until: 100 }
      const event = buildEvent({ created_at: 100 })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // Additional tests for prefix matching
    test("supports prefix matching for ids", () => {
      const filter: Filter = { ids: ["abc"] as EventId[] }
      const event = buildEvent({ id: "abcdef1234567890" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    test("supports prefix matching for authors", () => {
      const filter: Filter = { authors: ["abc"] as PublicKey[] }
      const event = buildEvent({ pubkey: "abcdef1234567890" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // Empty filter tests
    test("returns true for empty filter (matches all)", () => {
      const filter: Filter = {}
      const event = buildEvent({ id: "123", kind: 1, pubkey: "abc" })
      const result = matchesFilter(event, filter)
      expect(result).toBe(true)
    })

    // Multiple tag filter tests
    test("handles multiple tag filters (AND logic)", () => {
      const filter: Filter = { "#e": ["event1"], "#p": ["pubkey1"] }
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
      const filter: Filter = { "#e": ["event1"], "#p": ["pubkey1"] }
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
        { ids: ["123"] as EventId[], kinds: [1] as EventKind[], authors: ["abc"] as PublicKey[] },
        { ids: ["456"] as EventId[], kinds: [2] as EventKind[], authors: ["def"] as PublicKey[] },
        { ids: ["789"] as EventId[], kinds: [3] as EventKind[], authors: ["ghi"] as PublicKey[] },
      ]
      const event = buildEvent({ id: "789", kind: 3, pubkey: "ghi" })
      const result = matchesFilters(event, filters)
      expect(result).toBe(true)
    })

    // From nostr-tools: should return true when event matches one or more filters
    test("returns true when event matches filters with limit set", () => {
      const filters: Filter[] = [
        { ids: ["123"] as EventId[], limit: 1 },
        { kinds: [1] as EventKind[], limit: 2 },
        { authors: ["abc"] as PublicKey[], limit: 3 },
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
        { ids: ["123"] as EventId[], kinds: [1] as EventKind[], authors: ["abc"] as PublicKey[] },
        { ids: ["456"] as EventId[], kinds: [2] as EventKind[], authors: ["def"] as PublicKey[] },
        { ids: ["789"] as EventId[], kinds: [3] as EventKind[], authors: ["ghi"] as PublicKey[] },
      ]
      const event = buildEvent({ id: "100", kind: 4, pubkey: "jkl" })
      const result = matchesFilters(event, filters)
      expect(result).toBe(false)
    })

    // From nostr-tools: should return false when event matches none of the filters
    test("returns false when event matches none of the filters with limit", () => {
      const filters: Filter[] = [
        { ids: ["123"] as EventId[], limit: 1 },
        { kinds: [1] as EventKind[], limit: 2 },
        { authors: ["abc"] as PublicKey[], limit: 3 },
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
      const filters: Filter[] = [{ kinds: [1] as EventKind[] }]
      const event = buildEvent({ kind: 1 })
      const result = matchesFilters(event, filters)
      expect(result).toBe(true)
    })
  })

  // Tests specific to our implementation
  describe("supported tag filters", () => {
    test("supports #e tag filter", () => {
      const filter: Filter = { "#e": ["event123"] }
      const event = buildEvent({ tags: [["e", "event123"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("supports #p tag filter", () => {
      const filter: Filter = { "#p": ["pubkey123"] }
      const event = buildEvent({ tags: [["p", "pubkey123"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("supports #a tag filter", () => {
      const filter: Filter = { "#a": ["30023:pubkey:identifier"] }
      const event = buildEvent({ tags: [["a", "30023:pubkey:identifier"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("supports #d tag filter", () => {
      const filter: Filter = { "#d": ["my-identifier"] }
      const event = buildEvent({ tags: [["d", "my-identifier"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("supports #t tag filter", () => {
      const filter: Filter = { "#t": ["nostr"] }
      const event = buildEvent({ tags: [["t", "nostr"]] })
      expect(matchesFilter(event, filter)).toBe(true)
    })
  })

  // Realistic event tests
  describe("realistic event matching", () => {
    test("matches kind 0 profile event", () => {
      const filter: Filter = {
        kinds: [0] as EventKind[],
        authors: ["abc123"] as PublicKey[],
      }
      const event = buildEvent({
        kind: 0,
        pubkey: "abc123def456",
        content: JSON.stringify({ name: "Alice", about: "Testing" }),
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("matches kind 1 text note", () => {
      const filter: Filter = {
        kinds: [1] as EventKind[],
        since: 1700000000,
      }
      const event = buildEvent({
        kind: 1,
        created_at: 1700000001,
        content: "Hello Nostr!",
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("matches kind 3 follow list", () => {
      const filter: Filter = {
        kinds: [3] as EventKind[],
        authors: ["user"] as PublicKey[],
      }
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
      const filter: Filter = {
        kinds: [10002] as EventKind[],
      }
      const event = buildEvent({
        kind: 10002,
        tags: [
          ["r", "wss://relay1.example.com"],
          ["r", "wss://relay2.example.com", "write"],
        ],
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })

    test("matches kind 30023 long-form content", () => {
      const filter: Filter = {
        kinds: [30023] as EventKind[],
        "#d": ["my-article"],
      }
      const event = buildEvent({
        kind: 30023,
        tags: [["d", "my-article"]],
        content: "# My Article\n\nThis is long-form content...",
      })
      expect(matchesFilter(event, filter)).toBe(true)
    })
  })
})
