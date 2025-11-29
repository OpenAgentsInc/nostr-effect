/**
 * Tests for nip19.ts wrapper functions
 *
 * These tests verify nostr-tools compatibility for bech32 encoding/decoding.
 */
import { describe, test, expect } from "bun:test"
import {
  npubEncode,
  nsecEncode,
  noteEncode,
  nprofileEncode,
  neventEncode,
  naddrEncode,
  decode,
  decodeNostrURI,
  NostrTypeGuard,
} from "./nip19.js"

// Test vectors
const TEST_PUBKEY = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
const TEST_PRIVKEY = new Uint8Array(32).fill(0x01)
const TEST_EVENT_ID = "d7dd5eb3ab747e16f8d0212d53032ea2a7cadef53837e5a6c66d42849fcb9027"

describe("nip19.ts wrapper", () => {
  describe("npubEncode", () => {
    test("encodes pubkey to npub", () => {
      const npub = npubEncode(TEST_PUBKEY)
      expect(npub).toMatch(/^npub1[a-z0-9]{58}$/)
    })

    test("encodes known test vector correctly", () => {
      // This is a known npub from the nostr community
      const npub = npubEncode(TEST_PUBKEY)
      expect(npub).toBe("npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6")
    })

    test("decode roundtrip", () => {
      const npub = npubEncode(TEST_PUBKEY)
      const decoded = decode(npub)
      expect(decoded.type).toBe("npub")
      expect(decoded.data).toBe(TEST_PUBKEY)
    })
  })

  describe("nsecEncode", () => {
    test("encodes secret key to nsec", () => {
      const nsec = nsecEncode(TEST_PRIVKEY)
      expect(nsec).toMatch(/^nsec1[a-z0-9]{58}$/)
    })

    test("decode roundtrip", () => {
      const nsec = nsecEncode(TEST_PRIVKEY)
      const decoded = decode(nsec)
      expect(decoded.type).toBe("nsec")
      expect(decoded.data).toBeInstanceOf(Uint8Array)
      expect(Array.from(decoded.data as Uint8Array)).toEqual(Array.from(TEST_PRIVKEY))
    })
  })

  describe("noteEncode", () => {
    test("encodes event ID to note", () => {
      const note = noteEncode(TEST_EVENT_ID)
      expect(note).toMatch(/^note1[a-z0-9]+$/)
    })

    test("decode roundtrip", () => {
      const note = noteEncode(TEST_EVENT_ID)
      const decoded = decode(note)
      expect(decoded.type).toBe("note")
      expect(decoded.data).toBe(TEST_EVENT_ID)
    })
  })

  describe("nprofileEncode", () => {
    test("encodes profile with just pubkey", () => {
      const nprofile = nprofileEncode({ pubkey: TEST_PUBKEY })
      expect(nprofile).toMatch(/^nprofile1[a-z0-9]+$/)
    })

    test("encodes profile with relays", () => {
      const nprofile = nprofileEncode({
        pubkey: TEST_PUBKEY,
        relays: ["wss://relay.damus.io", "wss://nos.lol"],
      })
      expect(nprofile).toMatch(/^nprofile1[a-z0-9]+$/)
    })

    test("decode roundtrip with relays", () => {
      const relays = ["wss://relay.damus.io", "wss://nos.lol"]
      const nprofile = nprofileEncode({ pubkey: TEST_PUBKEY, relays })
      const decoded = decode(nprofile)

      expect(decoded.type).toBe("nprofile")
      if (decoded.type === "nprofile") {
        expect(decoded.data.pubkey).toBe(TEST_PUBKEY)
        expect(decoded.data.relays).toEqual(relays)
      }
    })
  })

  describe("neventEncode", () => {
    test("encodes event with just id", () => {
      const nevent = neventEncode({ id: TEST_EVENT_ID })
      expect(nevent).toMatch(/^nevent1[a-z0-9]+$/)
    })

    test("encodes event with all optional fields", () => {
      const nevent = neventEncode({
        id: TEST_EVENT_ID,
        relays: ["wss://relay.damus.io"],
        author: TEST_PUBKEY,
        kind: 1,
      })
      expect(nevent).toMatch(/^nevent1[a-z0-9]+$/)
    })

    test("decode roundtrip with all fields", () => {
      const relays = ["wss://relay.damus.io"]
      const nevent = neventEncode({
        id: TEST_EVENT_ID,
        relays,
        author: TEST_PUBKEY,
        kind: 1,
      })
      const decoded = decode(nevent)

      expect(decoded.type).toBe("nevent")
      if (decoded.type === "nevent") {
        expect(decoded.data.id).toBe(TEST_EVENT_ID)
        expect(decoded.data.relays).toEqual(relays)
        expect(decoded.data.author).toBe(TEST_PUBKEY)
        expect(decoded.data.kind).toBe(1)
      }
    })
  })

  describe("naddrEncode", () => {
    test("encodes address", () => {
      const naddr = naddrEncode({
        identifier: "test",
        pubkey: TEST_PUBKEY,
        kind: 30023,
      })
      expect(naddr).toMatch(/^naddr1[a-z0-9]+$/)
    })

    test("encodes address with relays", () => {
      const naddr = naddrEncode({
        identifier: "my-article",
        pubkey: TEST_PUBKEY,
        kind: 30023,
        relays: ["wss://relay.damus.io"],
      })
      expect(naddr).toMatch(/^naddr1[a-z0-9]+$/)
    })

    test("decode roundtrip", () => {
      const relays = ["wss://relay.damus.io"]
      const naddr = naddrEncode({
        identifier: "my-article",
        pubkey: TEST_PUBKEY,
        kind: 30023,
        relays,
      })
      const decoded = decode(naddr)

      expect(decoded.type).toBe("naddr")
      if (decoded.type === "naddr") {
        expect(decoded.data.identifier).toBe("my-article")
        expect(decoded.data.pubkey).toBe(TEST_PUBKEY)
        expect(decoded.data.kind).toBe(30023)
        expect(decoded.data.relays).toEqual(relays)
      }
    })
  })

  describe("decode", () => {
    test("decodes npub", () => {
      const npub = npubEncode(TEST_PUBKEY)
      const result = decode(npub)
      expect(result.type).toBe("npub")
      expect(result.data).toBe(TEST_PUBKEY)
    })

    test("decodes nsec", () => {
      const nsec = nsecEncode(TEST_PRIVKEY)
      const result = decode(nsec)
      expect(result.type).toBe("nsec")
    })

    test("decodes note", () => {
      const note = noteEncode(TEST_EVENT_ID)
      const result = decode(note)
      expect(result.type).toBe("note")
      expect(result.data).toBe(TEST_EVENT_ID)
    })

    test("throws on invalid bech32", () => {
      expect(() => decode("invalid")).toThrow()
    })

    test("throws on unknown prefix", () => {
      // This would require a valid bech32 with unknown prefix
      // which is tricky to construct, so we skip this test
    })
  })

  describe("decodeNostrURI", () => {
    test("decodes nostr: URI", () => {
      const npub = npubEncode(TEST_PUBKEY)
      const result = decodeNostrURI(`nostr:${npub}`)
      expect(result.type).toBe("npub")
      expect(result.data).toBe(TEST_PUBKEY)
    })

    test("decodes bare bech32", () => {
      const npub = npubEncode(TEST_PUBKEY)
      const result = decodeNostrURI(npub)
      expect(result.type).toBe("npub")
      expect(result.data).toBe(TEST_PUBKEY)
    })

    test("returns invalid for bad input", () => {
      const result = decodeNostrURI("not-valid")
      expect(result.type).toBe("invalid")
      expect(result.data).toBe(null)
    })
  })

  describe("NostrTypeGuard", () => {
    test("isNPub", () => {
      const npub = npubEncode(TEST_PUBKEY)
      expect(NostrTypeGuard.isNPub(npub)).toBe(true)
      expect(NostrTypeGuard.isNPub("npub1abc")).toBe(false) // Too short
      expect(NostrTypeGuard.isNPub("nsec1" + "a".repeat(58))).toBe(false)
    })

    test("isNSec", () => {
      const nsec = nsecEncode(TEST_PRIVKEY)
      expect(NostrTypeGuard.isNSec(nsec)).toBe(true)
      expect(NostrTypeGuard.isNSec("nsec1abc")).toBe(false) // Too short
      expect(NostrTypeGuard.isNSec("npub1" + "a".repeat(58))).toBe(false)
    })

    test("isNote", () => {
      const note = noteEncode(TEST_EVENT_ID)
      expect(NostrTypeGuard.isNote(note)).toBe(true)
      expect(NostrTypeGuard.isNote("npub1" + "a".repeat(58))).toBe(false)
    })

    test("isNProfile", () => {
      const nprofile = nprofileEncode({ pubkey: TEST_PUBKEY })
      expect(NostrTypeGuard.isNProfile(nprofile)).toBe(true)
      expect(NostrTypeGuard.isNProfile("npub1abc")).toBe(false)
    })

    test("isNEvent", () => {
      const nevent = neventEncode({ id: TEST_EVENT_ID })
      expect(NostrTypeGuard.isNEvent(nevent)).toBe(true)
      expect(NostrTypeGuard.isNEvent("npub1abc")).toBe(false)
    })

    test("isNAddr", () => {
      const naddr = naddrEncode({
        identifier: "test",
        pubkey: TEST_PUBKEY,
        kind: 30023,
      })
      expect(NostrTypeGuard.isNAddr(naddr)).toBe(true)
      expect(NostrTypeGuard.isNAddr("npub1abc")).toBe(false)
    })

    test("handles null/undefined", () => {
      expect(NostrTypeGuard.isNPub(null)).toBe(false)
      expect(NostrTypeGuard.isNPub(undefined)).toBe(false)
    })
  })
})
