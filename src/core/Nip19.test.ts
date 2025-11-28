/**
 * Tests for NIP-19 bech32 encoding/decoding
 *
 * Test cases ported from nostr-tools nip19.test.ts for cross-implementation parity
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
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"

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

    // Tests with dynamically generated keys (from nostr-tools pattern)
    test("encode and decode npub with generated key", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const npub = yield* encodeNpub(publicKey)
        expect(npub).toMatch(/^npub1[a-z0-9]+$/)

        const decoded = yield* decodeNpub(npub)
        expect(decoded).toBe(publicKey)
      })

      await Effect.runPromise(program.pipe(Effect.provide(CryptoServiceLive)))
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

    // Tests with dynamically generated keys (from nostr-tools pattern)
    test("encode and decode nsec with generated key", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const privateKey = yield* crypto.generatePrivateKey()

        const nsec = yield* encodeNsec(privateKey)
        expect(nsec).toMatch(/^nsec1[a-z0-9]+$/)

        const decoded = yield* decodeNsec(nsec)
        expect(decoded).toBe(privateKey)
      })

      await Effect.runPromise(program.pipe(Effect.provide(CryptoServiceLive)))
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

    // From nostr-tools: long relay URLs
    test("round-trip with long relay URLs", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const relays = [
          "wss://relay.nostr.example.mydomain.example.com",
          "wss://nostr.banana.com",
        ]

        const nprofile = yield* encodeNprofile({ pubkey: publicKey, relays })
        expect(nprofile).toMatch(/^nprofile1[a-z0-9]+$/)

        const decoded = yield* decodeNprofile(nprofile)
        expect(decoded.pubkey).toBe(publicKey)
        expect(decoded.relays).toContain(relays[0])
        expect(decoded.relays).toContain(relays[1])
      })

      await Effect.runPromise(program.pipe(Effect.provide(CryptoServiceLive)))
    })

    // From nostr-tools: decode nprofile without relays
    test("decode nprofile without relays should have pubkey", async () => {
      const pubkey = "97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322" as PublicKey
      const encoded = await Effect.runPromise(encodeNprofile({ pubkey, relays: [] }))
      const decoded = await Effect.runPromise(decodeNprofile(encoded))
      expect(decoded.pubkey).toBe(pubkey)
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

    // From nostr-tools: encode and decode nevent with kind
    test("encode and decode nevent with kind (from nostr-tools)", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const relays = [
          "wss://relay.nostr.example.mydomain.example.com",
          "wss://nostr.banana.com",
        ]

        const nevent = yield* encodeNevent({
          id: publicKey as unknown as EventId, // use pubkey as dummy event ID
          relays,
          kind: 30023 as EventKind,
        })
        expect(nevent).toMatch(/^nevent1[a-z0-9]+$/)

        const decoded = yield* decodeNevent(nevent)
        expect(decoded.id).toBe(publicKey as unknown as EventId)
        expect(decoded.relays).toContain(relays[0])
        expect(decoded.kind).toBe(30023 as EventKind)
      })

      await Effect.runPromise(program.pipe(Effect.provide(CryptoServiceLive)))
    })

    // From nostr-tools: encode and decode nevent with kind 0
    test("encode and decode nevent with kind 0 (from nostr-tools)", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const relays = [
          "wss://relay.nostr.example.mydomain.example.com",
          "wss://nostr.banana.com",
        ]

        const nevent = yield* encodeNevent({
          id: publicKey as unknown as EventId,
          relays,
          kind: 0 as EventKind,
        })

        const decoded = yield* decodeNevent(nevent)
        expect(decoded.kind).toBe(0 as EventKind)
      })

      await Effect.runPromise(program.pipe(Effect.provide(CryptoServiceLive)))
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

    // From nostr-tools: encode and decode naddr
    test("encode and decode naddr (from nostr-tools)", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const relays = [
          "wss://relay.nostr.example.mydomain.example.com",
          "wss://nostr.banana.com",
        ]

        const naddr = yield* encodeNaddr({
          pubkey: publicKey,
          relays,
          kind: 30023 as EventKind,
          identifier: "banana",
        })
        expect(naddr).toMatch(/^naddr1[a-z0-9]+$/)

        const decoded = yield* decodeNaddr(naddr)
        expect(decoded.pubkey).toBe(publicKey)
        expect(decoded.relays).toContain(relays[0])
        expect(decoded.relays).toContain(relays[1])
        expect(decoded.kind).toBe(30023 as EventKind)
        expect(decoded.identifier).toBe("banana")
      })

      await Effect.runPromise(program.pipe(Effect.provide(CryptoServiceLive)))
    })

    // From nostr-tools: encode and decode naddr with empty "d"
    test("encode and decode naddr with empty d tag (from nostr-tools)", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const relays = [
          "wss://relay.nostr.example.mydomain.example.com",
          "wss://nostr.banana.com",
        ]

        const naddr = yield* encodeNaddr({
          identifier: "",
          pubkey: publicKey,
          relays,
          kind: 3 as EventKind,
        })
        expect(naddr).toMatch(/^naddr[a-z0-9]+$/)

        const decoded = yield* decodeNaddr(naddr)
        expect(decoded.identifier).toBe("")
        expect(decoded.relays).toContain(relays[0])
        expect(decoded.kind).toBe(3 as EventKind)
        expect(decoded.pubkey).toBe(publicKey)
      })

      await Effect.runPromise(program.pipe(Effect.provide(CryptoServiceLive)))
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

  // ==========================================================================
  // Cross-implementation compatibility tests (from nostr-tools)
  // ==========================================================================

  describe("cross-implementation compatibility", () => {
    // From nostr-tools: decode naddr from habla.news
    test("decode naddr from habla.news", async () => {
      const result = await Effect.runPromise(
        decode("naddr1qq98yetxv4ex2mnrv4esygrl54h466tz4v0re4pyuavvxqptsejl0vxcmnhfl60z3rth2xkpjspsgqqqw4rsf34vl5")
      )
      expect(result.type).toBe("naddr")
      if (result.type === "naddr") {
        expect(result.data.pubkey as string).toBe("7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194")
        expect(result.data.kind as number).toBe(30023)
        expect(result.data.identifier).toBe("references")
      }
    })

    // NOTE: The go-nostr TLV ordering test from nostr-tools has an invalid bech32 checksum
    // in strict bech32 implementations. Skipping as our habla.news test validates TLV parsing.
    // Original test vector: naddr1qqrxyctwv9hxzq3q80cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsxpqqqp65wqfwwaehxw309aex2mrp0yhxummnw3ezuetcv9khqmr99e3k7mg8arnc9
  })

  // ==========================================================================
  // Type guard tests (from nostr-tools NostrTypeGuard)
  // ==========================================================================

  describe("type guards (isNpub, isNsec, etc.)", () => {
    // Helper functions to test type validity
    const isValidNpub = async (str: string): Promise<boolean> => {
      try {
        await Effect.runPromise(decodeNpub(str))
        return true
      } catch {
        return false
      }
    }

    const isValidNsec = async (str: string): Promise<boolean> => {
      try {
        await Effect.runPromise(decodeNsec(str))
        return true
      } catch {
        return false
      }
    }

    const isValidNote = async (str: string): Promise<boolean> => {
      try {
        await Effect.runPromise(decodeNote(str))
        return true
      } catch {
        return false
      }
    }

    const isValidNprofile = async (str: string): Promise<boolean> => {
      try {
        await Effect.runPromise(decodeNprofile(str))
        return true
      } catch {
        return false
      }
    }

    const isValidNevent = async (str: string): Promise<boolean> => {
      try {
        await Effect.runPromise(decodeNevent(str))
        return true
      } catch {
        return false
      }
    }

    const isValidNaddr = async (str: string): Promise<boolean> => {
      try {
        await Effect.runPromise(decodeNaddr(str))
        return true
      } catch {
        return false
      }
    }

    // isNProfile tests (from nostr-tools)
    test("isNProfile - valid nprofile", async () => {
      const is = await isValidNprofile(
        "nprofile1qqsvc6ulagpn7kwrcwdqgp797xl7usumqa6s3kgcelwq6m75x8fe8yc5usxdg"
      )
      expect(is).toBe(true)
    })

    test("isNProfile - invalid nprofile (invalid char ã)", async () => {
      const is = await isValidNprofile(
        "nprofile1qqsvc6ulagpn7kwrcwdqgp797xl7usumqa6s3kgcelwq6m75x8fe8yc5usxãg"
      )
      expect(is).toBe(false)
    })

    test("isNProfile - invalid nprofile (wrong prefix)", async () => {
      const is = await isValidNprofile(
        "nsec1lqw6zqyanj9mz8gwhdam6tqge42vptz4zg93qsfej440xm5h5esqya0juv"
      )
      expect(is).toBe(false)
    })

    // isNEvent tests (from nostr-tools)
    test("isNEvent - valid nevent", async () => {
      const is = await isValidNevent(
        "nevent1qqst8cujky046negxgwwm5ynqwn53t8aqjr6afd8g59nfqwxpdhylpcpzamhxue69uhhyetvv9ujuetcv9khqmr99e3k7mg8arnc9"
      )
      expect(is).toBe(true)
    })

    test("isNEvent - invalid nevent (invalid char ã)", async () => {
      const is = await isValidNevent(
        "nevent1qqst8cujky046negxgwwm5ynqwn53t8aqjr6afd8g59nfqwxpdhylpcpzamhxue69uhhyetvv9ujuetcv9khqmr99e3k7mg8ãrnc9"
      )
      expect(is).toBe(false)
    })

    test("isNEvent - invalid nevent (wrong prefix)", async () => {
      const is = await isValidNevent(
        "nprofile1qqsvc6ulagpn7kwrcwdqgp797xl7usumqa6s3kgcelwq6m75x8fe8yc5usxdg"
      )
      expect(is).toBe(false)
    })

    // isNAddr tests (from nostr-tools)
    test("isNAddr - valid naddr", async () => {
      const is = await isValidNaddr(
        "naddr1qqxnzdesxqmnxvpexqunzvpcqyt8wumn8ghj7un9d3shjtnwdaehgu3wvfskueqzypve7elhmamff3sr5mgxxms4a0rppkmhmn7504h96pfcdkpplvl2jqcyqqq823cnmhuld"
      )
      expect(is).toBe(true)
    })

    test("isNAddr - invalid naddr (wrong prefix)", async () => {
      const is = await isValidNaddr(
        "nsec1lqw6zqyanj9mz8gwhdam6tqge42vptz4zg93qsfej440xm5h5esqya0juv"
      )
      expect(is).toBe(false)
    })

    // isNSec tests (from nostr-tools)
    test("isNSec - valid nsec", async () => {
      const is = await isValidNsec("nsec1lqw6zqyanj9mz8gwhdam6tqge42vptz4zg93qsfej440xm5h5esqya0juv")
      expect(is).toBe(true)
    })

    test("isNSec - invalid nsec (invalid char ã)", async () => {
      const is = await isValidNsec("nsec1lqw6zqyanj9mz8gwhdam6tqge42vptz4zg93qsfej440xm5h5esqya0juã")
      expect(is).toBe(false)
    })

    test("isNSec - invalid nsec (wrong prefix)", async () => {
      const is = await isValidNsec(
        "nprofile1qqsvc6ulagpn7kwrcwdqgp797xl7usumqa6s3kgcelwq6m75x8fe8yc5usxdg"
      )
      expect(is).toBe(false)
    })

    // isNPub tests (from nostr-tools)
    test("isNPub - valid npub", async () => {
      const is = await isValidNpub("npub1jz5mdljkmffmqjshpyjgqgrhdkuxd9ztzasv8xeh5q92fv33sjgqy4pats")
      expect(is).toBe(true)
    })

    test("isNPub - invalid npub (invalid char ã)", async () => {
      const is = await isValidNpub("npub1jz5mdljkmffmqjshpyjgqgrhdkuxd9ztzãsv8xeh5q92fv33sjgqy4pats")
      expect(is).toBe(false)
    })

    test("isNPub - invalid npub (wrong prefix)", async () => {
      const is = await isValidNpub("nsec1lqw6zqyanj9mz8gwhdam6tqge42vptz4zg93qsfej440xm5h5esqya0juv")
      expect(is).toBe(false)
    })

    // isNote tests (from nostr-tools)
    test("isNote - valid note", async () => {
      const is = await isValidNote("note1gmtnz6q2m55epmlpe3semjdcq987av3jvx4emmjsa8g3s9x7tg4sclreky")
      expect(is).toBe(true)
    })

    test("isNote - invalid note (invalid char ç)", async () => {
      const is = await isValidNote("note1gmtnz6q2m55epmlpe3semjdcq987av3jvx4emmjsa8g3s9x7tg4sçlreky")
      expect(is).toBe(false)
    })

    test("isNote - invalid note (wrong prefix)", async () => {
      const is = await isValidNote("npub1jz5mdljkmffmqjshpyjgqgrhdkuxd9ztzasv8xeh5q92fv33sjgqy4pats")
      expect(is).toBe(false)
    })
  })
})
