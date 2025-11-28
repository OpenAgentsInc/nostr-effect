import { test, expect, describe } from "bun:test"
import { Schema } from "@effect/schema"
import {
  EventId,
  PublicKey,
  PrivateKey,
  Signature,
  EventKind,
  Tag,
  NostrEvent,
  Filter,
} from "./Schema"

describe("Schema", () => {
  describe("EventId", () => {
    test("accepts valid 64-char hex", () => {
      const validId = "a".repeat(64)
      const result = Schema.decodeUnknownSync(EventId)(validId)
      expect(result).toBe(validId)
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
      expect(result).toBe(validKey)
    })
  })

  describe("EventKind", () => {
    test("accepts valid kinds", () => {
      expect(Schema.decodeUnknownSync(EventKind)(0)).toBe(0)
      expect(Schema.decodeUnknownSync(EventKind)(1)).toBe(1)
      expect(Schema.decodeUnknownSync(EventKind)(65535)).toBe(65535)
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
      expect(result).toEqual(tag)
    })

    test("rejects empty array", () => {
      expect(() => Schema.decodeUnknownSync(Tag)([])).toThrow()
    })
  })

  describe("Filter", () => {
    test("accepts empty filter", () => {
      const result = Schema.decodeUnknownSync(Filter)({})
      expect(result).toEqual({})
    })

    test("accepts filter with kinds", () => {
      const filter = { kinds: [1, 7] }
      const result = Schema.decodeUnknownSync(Filter)(filter)
      expect(result.kinds).toEqual([1, 7])
    })
  })
})
