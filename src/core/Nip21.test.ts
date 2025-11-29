/**
 * NIP-21: nostr: URI Scheme Tests
 */
import { describe, test, expect } from "bun:test"
import {
  test as testUri,
  parse,
  safeParse,
  extractBech32,
  encode,
  safeEncode,
  NOSTR_URI_REGEX,
  BECH32_REGEX
} from "./Nip21.js"
import type { NostrURI } from "./Nip21.js"

const TEST_NPUB = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m"
const TEST_NPROFILE = "nprofile1qqsgyywvqmws4xgh6chkpvdcumwlwju8fqtgcw87wlcp6t425sjj39gpzamhxue69uhhyetvv9ujuetcv9khqmr99e3k7mgw4sfqv"
const TEST_NOTE = "note1fntxtkcy9pjwucqwa9mddn7v03wwwsu9j330jj350nvhpky2tuaspk6nqc"

describe("NIP-21: nostr: URI Scheme", () => {
  describe("BECH32_REGEX", () => {
    test("should match valid bech32 strings", () => {
      expect(BECH32_REGEX.test(TEST_NPUB)).toBe(true)
      expect(BECH32_REGEX.test(TEST_NOTE)).toBe(true)
    })

    test("should not match invalid strings", () => {
      expect(BECH32_REGEX.test("invalid")).toBe(false)
      expect(BECH32_REGEX.test("no1separator")).toBe(true) // has 1 separator
      expect(BECH32_REGEX.test("UPPERCASE1abc")).toBe(false) // uppercase not allowed
    })
  })

  describe("NOSTR_URI_REGEX", () => {
    test("should match nostr: URIs", () => {
      expect(NOSTR_URI_REGEX.test(`nostr:${TEST_NPUB}`)).toBe(true)
      expect(NOSTR_URI_REGEX.test(`nostr:${TEST_NOTE}`)).toBe(true)
    })

    test("should not match non-nostr URIs", () => {
      expect(NOSTR_URI_REGEX.test(`http://${TEST_NPUB}`)).toBe(false)
      expect(NOSTR_URI_REGEX.test(TEST_NPUB)).toBe(false)
    })
  })

  describe("test()", () => {
    test("should return true for valid nostr: URIs", () => {
      expect(testUri(`nostr:${TEST_NPUB}`)).toBe(true)
      expect(testUri(`nostr:${TEST_NOTE}`)).toBe(true)
      expect(testUri(`nostr:${TEST_NPROFILE}`)).toBe(true)
    })

    test("should return false for invalid URIs", () => {
      expect(testUri("invalid")).toBe(false)
      expect(testUri("nostr:invalid")).toBe(false)
      expect(testUri(TEST_NPUB)).toBe(false)
      expect(testUri(null)).toBe(false)
      expect(testUri(undefined)).toBe(false)
      expect(testUri(123)).toBe(false)
    })

    test("should work as type guard", () => {
      const uri = `nostr:${TEST_NPUB}`
      if (testUri(uri)) {
        // TypeScript should narrow type to NostrURI
        const _: NostrURI = uri
        expect(_).toBe(uri)
      }
    })
  })

  describe("parse()", () => {
    test("should parse npub URI", () => {
      const result = parse(`nostr:${TEST_NPUB}`)
      expect(result.uri).toBe(`nostr:${TEST_NPUB}`)
      expect(result.value).toBe(TEST_NPUB)
      expect(result.decoded.type).toBe("npub")
    })

    test("should parse note URI", () => {
      const result = parse(`nostr:${TEST_NOTE}`)
      expect(result.uri).toBe(`nostr:${TEST_NOTE}`)
      expect(result.value).toBe(TEST_NOTE)
      expect(result.decoded.type).toBe("note")
    })

    test("should parse nprofile URI", () => {
      const result = parse(`nostr:${TEST_NPROFILE}`)
      expect(result.decoded.type).toBe("nprofile")
    })

    test("should throw for invalid URI", () => {
      expect(() => parse("invalid")).toThrow()
      expect(() => parse(TEST_NPUB)).toThrow()
    })
  })

  describe("safeParse()", () => {
    test("should return parsed result for valid URI", () => {
      const result = safeParse(`nostr:${TEST_NPUB}`)
      expect(result).not.toBeNull()
      expect(result!.decoded.type).toBe("npub")
    })

    test("should return null for invalid URI", () => {
      expect(safeParse("invalid")).toBeNull()
      expect(safeParse(TEST_NPUB)).toBeNull()
    })
  })

  describe("extractBech32()", () => {
    test("should extract bech32 from nostr URI", () => {
      expect(extractBech32(`nostr:${TEST_NPUB}`)).toBe(TEST_NPUB)
      expect(extractBech32(`nostr:${TEST_NOTE}`)).toBe(TEST_NOTE)
    })

    test("should work with text containing nostr URI", () => {
      const text = `Check out nostr:${TEST_NPUB} for more info`
      expect(extractBech32(text)).toBe(TEST_NPUB)
    })

    test("should return null for text without nostr URI", () => {
      expect(extractBech32("no uri here")).toBeNull()
      expect(extractBech32(TEST_NPUB)).toBeNull()
    })
  })

  describe("encode()", () => {
    test("should encode npub to nostr URI", () => {
      const result = encode(TEST_NPUB)
      expect(result).toBe(`nostr:${TEST_NPUB}`)
      expect(testUri(result)).toBe(true)
    })

    test("should encode note to nostr URI", () => {
      const result = encode(TEST_NOTE)
      expect(result).toBe(`nostr:${TEST_NOTE}`)
      expect(testUri(result)).toBe(true)
    })

    test("should encode nprofile to nostr URI", () => {
      const result = encode(TEST_NPROFILE)
      expect(result).toBe(`nostr:${TEST_NPROFILE}`)
      expect(testUri(result)).toBe(true)
    })

    test("should throw for invalid bech32", () => {
      expect(() => encode("invalid")).toThrow()
      expect(() => encode("not-bech32")).toThrow()
      expect(() => encode("")).toThrow()
    })

    test("roundtrip: encode then parse", () => {
      const uri = encode(TEST_NPUB)
      const parsed = parse(uri)
      expect(parsed.value).toBe(TEST_NPUB)
      expect(parsed.decoded.type).toBe("npub")
    })
  })

  describe("safeEncode()", () => {
    test("should encode valid bech32", () => {
      const result = safeEncode(TEST_NPUB)
      expect(result).not.toBeNull()
      expect(result).toBe(`nostr:${TEST_NPUB}`)
    })

    test("should return null for invalid bech32", () => {
      expect(safeEncode("invalid")).toBeNull()
      expect(safeEncode("not-bech32")).toBeNull()
      expect(safeEncode("")).toBeNull()
    })
  })
})
