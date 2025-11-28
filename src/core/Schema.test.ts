import { test, expect, describe } from "bun:test"
import { Schema } from "@effect/schema"
import {
  EventId,
  PublicKey,
  EventKind,
  Tag,
  Filter,
  UnixTimestamp,
} from "./Schema"

describe("Schema", () => {
  describe("EventId", () => {
    test("accepts valid 64-char hex", () => {
      const validId = "a".repeat(64)
      const result = Schema.decodeUnknownSync(EventId)(validId)
      expect(typeof result).toBe("string")
      expect(result).toHaveLength(64)
    })

    test("rejects invalid hex", () => {
      expect(() => Schema.decodeUnknownSync(EventId)("invalid")).toThrow()
    })

    test("rejects wrong length", () => {
      expect(() => Schema.decodeUnknownSync(EventId)("a".repeat(63))).toThrow()
    })
  })

  describe("PublicKey", () => {
    test("accepts valid 64-char hex", () => {
      const validKey = "b".repeat(64)
      const result = Schema.decodeUnknownSync(PublicKey)(validKey)
      expect(typeof result).toBe("string")
      expect(result).toHaveLength(64)
    })
  })

  describe("EventKind", () => {
    test("accepts valid kinds", () => {
      const kind0 = Schema.decodeUnknownSync(EventKind)(0)
      const kind1 = Schema.decodeUnknownSync(EventKind)(1)
      const kindMax = Schema.decodeUnknownSync(EventKind)(65535)
      expect(kind0).toBe(0 as typeof kind0)
      expect(kind1).toBe(1 as typeof kind1)
      expect(kindMax).toBe(65535 as typeof kindMax)
    })

    test("rejects negative", () => {
      expect(() => Schema.decodeUnknownSync(EventKind)(-1)).toThrow()
    })

    test("rejects out of range", () => {
      expect(() => Schema.decodeUnknownSync(EventKind)(65536)).toThrow()
    })
  })

  describe("Tag", () => {
    test("accepts valid tag array", () => {
      const tag = ["e", "a".repeat(64)]
      const result = Schema.decodeUnknownSync(Tag)(tag)
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
    })

    test("rejects empty array", () => {
      expect(() => Schema.decodeUnknownSync(Tag)([])).toThrow()
    })
  })

  describe("Filter", () => {
    test("accepts empty filter", () => {
      const result = Schema.decodeUnknownSync(Filter)({})
      expect(typeof result).toBe("object")
    })

    test("accepts filter with kinds", () => {
      const filter = { kinds: [1, 7] }
      const result = Schema.decodeUnknownSync(Filter)(filter)
      expect(Array.isArray(result.kinds)).toBe(true)
      expect(result.kinds).toHaveLength(2)
    })

    test("accepts filter with tag queries", () => {
      const eventId = "a".repeat(64)
      const pubkey = "b".repeat(64)
      const filter = {
        "#e": [eventId],
        "#p": [pubkey],
        "#t": ["nostr", "bitcoin"],
      }
      const result = Schema.decodeUnknownSync(Filter)(filter)
      expect(result["#e"]).toHaveLength(1)
      expect(result["#p"]).toHaveLength(1)
      expect(result["#t"]).toHaveLength(2)
    })

    test("accepts complex filter", () => {
      const decodeTimestamp = Schema.decodeSync(UnixTimestamp)
      const filter = {
        kinds: [1],
        authors: ["c".repeat(64)],
        since: 1700000000,
        limit: 100,
        "#t": ["nostr"],
      }
      const result = Schema.decodeUnknownSync(Filter)(filter)
      expect(result.kinds).toHaveLength(1)
      expect(result.authors).toHaveLength(1)
      expect(result.since).toBe(decodeTimestamp(1700000000))
      expect(result.limit).toBe(100)
    })
  })
})
