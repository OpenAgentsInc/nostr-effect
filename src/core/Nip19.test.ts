/**
 * Tests for NIP-19 bech32 encoding/decoding
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import {
  encodeNpub,
  decodeNpub,
  encodeNsec,
  decodeNsec,
  encodeNote,
  decodeNote,
  encodeNprofile,
  decodeNprofile,
  encodeNevent,
  decodeNevent,
  encodeNaddr,
  decodeNaddr,
  decode,
  type Nprofile,
  type Nevent,
  type Naddr,
} from "./Nip19.js"
import type { PublicKey, PrivateKey, EventId, EventKind } from "./Schema.js"

// Test vectors from NIP-19 spec
const TEST_PUBKEY = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" as PublicKey
const TEST_PUBKEY_NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

const TEST_PRIVKEY = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa" as PrivateKey
const TEST_PRIVKEY_NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5"

// Additional test data
const TEST_EVENT_ID = "b5c9a7f0d82e6b8e1f3a4c5d6e7b8a9f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f" as EventId
const TEST_KIND = 30023 as EventKind

describe("NIP-19 bech32 encoding", () => {
  describe("npub (public key)", () => {
    test("encodes correctly from spec test vector", async () => {
      const result = await Effect.runPromise(encodeNpub(TEST_PUBKEY))
      expect(result).toBe(TEST_PUBKEY_NPUB)
    })

    test("decodes correctly from spec test vector", async () => {
      const result = await Effect.runPromise(decodeNpub(TEST_PUBKEY_NPUB))
      expect(result).toBe(TEST_PUBKEY)
    })

    test("round-trip encoding/decoding", async () => {
      const encoded = await Effect.runPromise(encodeNpub(TEST_PUBKEY))
      const decoded = await Effect.runPromise(decodeNpub(encoded))
      expect(decoded).toBe(TEST_PUBKEY)
    })

    test("fails on invalid prefix", async () => {
      const result = Effect.runPromise(decodeNpub(TEST_PRIVKEY_NSEC))
      await expect(result).rejects.toThrow("Invalid prefix")
    })

    test("fails on invalid bech32", async () => {
      const result = Effect.runPromise(decodeNpub("invalid"))
      await expect(result).rejects.toThrow()
    })
  })

  describe("nsec (private key)", () => {
    test("encodes correctly from spec test vector", async () => {
      const result = await Effect.runPromise(encodeNsec(TEST_PRIVKEY))
      expect(result).toBe(TEST_PRIVKEY_NSEC)
    })

    test("decodes correctly from spec test vector", async () => {
      const result = await Effect.runPromise(decodeNsec(TEST_PRIVKEY_NSEC))
      expect(result).toBe(TEST_PRIVKEY)
    })

    test("round-trip encoding/decoding", async () => {
      const encoded = await Effect.runPromise(encodeNsec(TEST_PRIVKEY))
      const decoded = await Effect.runPromise(decodeNsec(encoded))
      expect(decoded).toBe(TEST_PRIVKEY)
    })

    test("fails on invalid prefix", async () => {
      const result = Effect.runPromise(decodeNsec(TEST_PUBKEY_NPUB))
      await expect(result).rejects.toThrow("Invalid prefix")
    })
  })

  describe("note (event ID)", () => {
    test("round-trip encoding/decoding", async () => {
      const encoded = await Effect.runPromise(encodeNote(TEST_EVENT_ID))
      expect(encoded.startsWith("note1")).toBe(true)
      const decoded = await Effect.runPromise(decodeNote(encoded))
      expect(decoded).toBe(TEST_EVENT_ID)
    })

    test("fails on invalid prefix", async () => {
      const result = Effect.runPromise(decodeNote(TEST_PUBKEY_NPUB))
      await expect(result).rejects.toThrow("Invalid prefix")
    })
  })

  describe("nprofile (profile with relays)", () => {
    test("round-trip with no relays", async () => {
      const profile: Nprofile = {
        pubkey: TEST_PUBKEY,
        relays: [],
      }
      const encoded = await Effect.runPromise(encodeNprofile(profile))
      expect(encoded.startsWith("nprofile1")).toBe(true)
      const decoded = await Effect.runPromise(decodeNprofile(encoded))
      expect(decoded.pubkey).toBe(TEST_PUBKEY)
      expect(decoded.relays).toEqual([])
    })

    test("round-trip with single relay", async () => {
      const profile: Nprofile = {
        pubkey: TEST_PUBKEY,
        relays: ["wss://relay.example.com"],
      }
      const encoded = await Effect.runPromise(encodeNprofile(profile))
      const decoded = await Effect.runPromise(decodeNprofile(encoded))
      expect(decoded.pubkey).toBe(TEST_PUBKEY)
      expect(decoded.relays).toEqual(["wss://relay.example.com"])
    })

    test("round-trip with multiple relays", async () => {
      const profile: Nprofile = {
        pubkey: TEST_PUBKEY,
        relays: ["wss://r.x.com", "wss://djbas.sadkb.com"],
      }
      const encoded = await Effect.runPromise(encodeNprofile(profile))
      const decoded = await Effect.runPromise(decodeNprofile(encoded))
      expect(decoded.pubkey).toBe(TEST_PUBKEY)
      expect(decoded.relays).toEqual(["wss://r.x.com", "wss://djbas.sadkb.com"])
    })

    test("fails on invalid prefix", async () => {
      const result = Effect.runPromise(decodeNprofile(TEST_PUBKEY_NPUB))
      await expect(result).rejects.toThrow("Invalid prefix")
    })
  })

  describe("nevent (event with metadata)", () => {
    test("round-trip with only ID", async () => {
      const nevent: Nevent = {
        id: TEST_EVENT_ID,
        relays: [],
      }
      const encoded = await Effect.runPromise(encodeNevent(nevent))
      expect(encoded.startsWith("nevent1")).toBe(true)
      const decoded = await Effect.runPromise(decodeNevent(encoded))
      expect(decoded.id).toBe(TEST_EVENT_ID)
      expect(decoded.relays).toEqual([])
      expect(decoded.author).toBeUndefined()
      expect(decoded.kind).toBeUndefined()
    })

    test("round-trip with full metadata", async () => {
      const nevent: Nevent = {
        id: TEST_EVENT_ID,
        relays: ["wss://relay.example.com"],
        author: TEST_PUBKEY,
        kind: TEST_KIND,
      }
      const encoded = await Effect.runPromise(encodeNevent(nevent))
      const decoded = await Effect.runPromise(decodeNevent(encoded))
      expect(decoded.id).toBe(TEST_EVENT_ID)
      expect(decoded.relays).toEqual(["wss://relay.example.com"])
      expect(decoded.author).toBe(TEST_PUBKEY)
      expect(decoded.kind).toBe(TEST_KIND)
    })

    test("preserves kind = 0", async () => {
      const nevent: Nevent = {
        id: TEST_EVENT_ID,
        relays: [],
        kind: 0 as unknown as EventKind,
      }
      const encoded = await Effect.runPromise(encodeNevent(nevent))
      const decoded = await Effect.runPromise(decodeNevent(encoded))
      expect(decoded.kind).toBe(0 as unknown as EventKind)
    })

    test("fails on invalid prefix", async () => {
      const result = Effect.runPromise(decodeNevent(TEST_PUBKEY_NPUB))
      await expect(result).rejects.toThrow("Invalid prefix")
    })
  })

  describe("naddr (addressable event)", () => {
    test("round-trip with empty identifier", async () => {
      const naddr: Naddr = {
        identifier: "",
        pubkey: TEST_PUBKEY,
        kind: TEST_KIND,
        relays: [],
      }
      const encoded = await Effect.runPromise(encodeNaddr(naddr))
      expect(encoded.startsWith("naddr1")).toBe(true)
      const decoded = await Effect.runPromise(decodeNaddr(encoded))
      expect(decoded.identifier).toBe("")
      expect(decoded.pubkey).toBe(TEST_PUBKEY)
      expect(decoded.kind).toBe(TEST_KIND)
      expect(decoded.relays).toEqual([])
    })

    test("round-trip with full metadata", async () => {
      const naddr: Naddr = {
        identifier: "my-article",
        pubkey: TEST_PUBKEY,
        kind: TEST_KIND,
        relays: ["wss://relay.example.com", "wss://backup.relay.com"],
      }
      const encoded = await Effect.runPromise(encodeNaddr(naddr))
      const decoded = await Effect.runPromise(decodeNaddr(encoded))
      expect(decoded.identifier).toBe("my-article")
      expect(decoded.pubkey).toBe(TEST_PUBKEY)
      expect(decoded.kind).toBe(TEST_KIND)
      expect(decoded.relays).toEqual(["wss://relay.example.com", "wss://backup.relay.com"])
    })

    test("handles unicode identifier", async () => {
      const naddr: Naddr = {
        identifier: "こんにちは",
        pubkey: TEST_PUBKEY,
        kind: TEST_KIND,
        relays: [],
      }
      const encoded = await Effect.runPromise(encodeNaddr(naddr))
      const decoded = await Effect.runPromise(decodeNaddr(encoded))
      expect(decoded.identifier).toBe("こんにちは")
    })

    test("fails on invalid prefix", async () => {
      const result = Effect.runPromise(decodeNaddr(TEST_PUBKEY_NPUB))
      await expect(result).rejects.toThrow("Invalid prefix")
    })
  })

  describe("decode (auto-detect)", () => {
    test("detects npub", async () => {
      const result = await Effect.runPromise(decode(TEST_PUBKEY_NPUB))
      expect(result.type).toBe("npub")
      if (result.type === "npub") {
        expect(result.data).toBe(TEST_PUBKEY)
      }
    })

    test("detects nsec", async () => {
      const result = await Effect.runPromise(decode(TEST_PRIVKEY_NSEC))
      expect(result.type).toBe("nsec")
      if (result.type === "nsec") {
        expect(result.data).toBe(TEST_PRIVKEY)
      }
    })

    test("detects note", async () => {
      const encoded = await Effect.runPromise(encodeNote(TEST_EVENT_ID))
      const result = await Effect.runPromise(decode(encoded))
      expect(result.type).toBe("note")
      if (result.type === "note") {
        expect(result.data).toBe(TEST_EVENT_ID)
      }
    })

    test("detects nprofile", async () => {
      const profile: Nprofile = { pubkey: TEST_PUBKEY, relays: ["wss://test.com"] }
      const encoded = await Effect.runPromise(encodeNprofile(profile))
      const result = await Effect.runPromise(decode(encoded))
      expect(result.type).toBe("nprofile")
      if (result.type === "nprofile") {
        expect(result.data.pubkey).toBe(TEST_PUBKEY)
        expect(result.data.relays).toEqual(["wss://test.com"])
      }
    })

    test("detects nevent", async () => {
      const nevent: Nevent = { id: TEST_EVENT_ID, relays: [], author: TEST_PUBKEY }
      const encoded = await Effect.runPromise(encodeNevent(nevent))
      const result = await Effect.runPromise(decode(encoded))
      expect(result.type).toBe("nevent")
      if (result.type === "nevent") {
        expect(result.data.id).toBe(TEST_EVENT_ID)
        expect(result.data.author).toBe(TEST_PUBKEY)
      }
    })

    test("detects naddr", async () => {
      const naddr: Naddr = {
        identifier: "test",
        pubkey: TEST_PUBKEY,
        kind: TEST_KIND,
        relays: [],
      }
      const encoded = await Effect.runPromise(encodeNaddr(naddr))
      const result = await Effect.runPromise(decode(encoded))
      expect(result.type).toBe("naddr")
      if (result.type === "naddr") {
        expect(result.data.identifier).toBe("test")
        expect(result.data.pubkey).toBe(TEST_PUBKEY)
        expect(result.data.kind).toBe(TEST_KIND)
      }
    })

    test("fails on unknown prefix", async () => {
      // Create a valid bech32 with unknown prefix using bc1 (bitcoin)
      const result = Effect.runPromise(decode("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"))
      await expect(result).rejects.toThrow("Unknown NIP-19 prefix")
    })

    test("fails on invalid bech32", async () => {
      const result = Effect.runPromise(decode("not-a-valid-bech32"))
      await expect(result).rejects.toThrow("Invalid bech32 string")
    })
  })
})
