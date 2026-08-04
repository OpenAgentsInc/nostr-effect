/**
 * NIP-59: Gift Wrap Tests
 * Tests ported from nostr-tools for 100% parity
 */
import { describe, test, expect } from "vite-plus/test"
import {
  createRumor,
  createSeal,
  createWrap,
  wrapEvent,
  unwrapEvent,
  wrapManyEvents,
  SEAL_KIND,
  GIFT_WRAP_KIND,
} from "./Nip59.js"
import { hexToBytes, bytesToHex } from "@noble/hashes/utils"
import { schnorr } from "@noble/curves/secp256k1"
import type { EventKind } from "./Schema.js"

// Test keys from nostr-tools
const senderPrivateKey = hexToBytes("0beebd062ec8735f4243466f14a397a5ed45e7830c1ea4b029e55d4d420d0989")
const recipientPrivateKey = hexToBytes("e108399bd8424357a710b606a0e6b8b2c1c28f0ea245c587a7037ef143e9ca18")
const recipientPublicKey = bytesToHex(schnorr.getPublicKey(recipientPrivateKey))
const wrapPrivateKey = hexToBytes("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

describe("NIP-59: Gift Wrap", () => {
  describe("SEAL_KIND", () => {
    test("should be kind 13", () => {
      expect(SEAL_KIND as number).toBe(13)
    })
  })

  describe("GIFT_WRAP_KIND", () => {
    test("should be kind 1059", () => {
      expect(GIFT_WRAP_KIND as number).toBe(1059)
    })
  })

  describe("createRumor", () => {
    test("should create rumor with id", () => {
      const rumor = createRumor(
        { kind: 1 as EventKind, content: "Hello", tags: [] },
        senderPrivateKey
      )

      expect(rumor.id).toBeDefined()
      expect(typeof rumor.id).toBe("string")
      expect(rumor.content).toBe("Hello")
      expect(rumor.kind as number).toBe(1)
    })

    test("should set pubkey from private key", () => {
      const rumor = createRumor(
        { kind: 1 as EventKind, content: "Test", tags: [] },
        senderPrivateKey
      )

      const expectedPubkey = bytesToHex(schnorr.getPublicKey(senderPrivateKey))
      expect(rumor.pubkey as string).toBe(expectedPubkey)
    })
  })

  describe("wrapEvent", () => {
    test("should create gift-wrapped event", () => {
      const event = {
        kind: 1 as EventKind,
        content: "Are you going to the party tonight?",
        tags: [],
      }

      const result = wrapEvent(event, senderPrivateKey, recipientPublicKey)

      expect(result.kind).toBe(GIFT_WRAP_KIND)
      expect(result.tags).toEqual([["p", recipientPublicKey]])
      expect(typeof result.id).toBe("string")
      expect(typeof result.sig).toBe("string")
      expect(typeof result.content).toBe("string")
    })
  })

  describe("unwrapEvent", () => {
    test("should unwrap gift-wrapped event", () => {
      const originalContent = "Are you going to the party tonight?"
      const event = {
        kind: 1 as EventKind,
        content: originalContent,
        tags: [],
      }

      const wrapped = wrapEvent(event, senderPrivateKey, recipientPublicKey)
      const unwrapped = unwrapEvent(wrapped, recipientPrivateKey)

      expect(unwrapped.content).toBe(originalContent)
      expect(unwrapped.kind as number).toBe(1)
      expect(unwrapped.pubkey as string).toBe(bytesToHex(schnorr.getPublicKey(senderPrivateKey)))
    })

    test("should reject a wrap whose signature does not match its ID", () => {
      const wrapped = wrapEvent(
        { kind: 1 as EventKind, content: "private", tags: [["p", recipientPublicKey]] },
        senderPrivateKey,
        recipientPublicKey
      )
      const tampered = {
        ...wrapped,
        sig: `${wrapped.sig[0] === "0" ? "1" : "0"}${wrapped.sig.slice(1)}` as never,
      }

      expect(() => unwrapEvent(tampered, recipientPrivateKey)).toThrow(
        "signature or ID is invalid"
      )
    })

    test("should reject a seal whose signature does not match its ID", () => {
      const rumor = createRumor(
        { kind: 1 as EventKind, content: "private", tags: [["p", recipientPublicKey]] },
        senderPrivateKey
      )
      const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey, {
        sealCreatedAt: 1_700_000_000,
        sealNonce: new Uint8Array(32).fill(3),
      })
      const tamperedSeal = {
        ...seal,
        sig: `${seal.sig[0] === "0" ? "1" : "0"}${seal.sig.slice(1)}` as never,
      }

      expect(() =>
        createWrap(tamperedSeal, recipientPublicKey, {
          wrapCreatedAt: 1_700_000_001,
          wrapNonce: new Uint8Array(32).fill(4),
          wrapPrivateKey,
        })
      ).toThrow("signature or ID is invalid")
    })

    test("should produce deterministic wraps from explicit material", () => {
      const event = {
        kind: 1 as EventKind,
        created_at: 1_700_000_002 as never,
        content: "private",
        tags: [["p", recipientPublicKey]],
      }
      const material = {
        sealCreatedAt: 1_700_000_000,
        wrapCreatedAt: 1_700_000_001,
        sealNonce: new Uint8Array(32).fill(3),
        wrapNonce: new Uint8Array(32).fill(4),
        wrapPrivateKey,
        sealAuxiliaryRandomData: new Uint8Array(32),
        wrapAuxiliaryRandomData: new Uint8Array(32),
      }

      const first = wrapEvent(event, senderPrivateKey, recipientPublicKey, material)
      const second = wrapEvent(event, senderPrivateKey, recipientPublicKey, material)

      expect(second).toEqual(first)
      expect(unwrapEvent(first, recipientPrivateKey).content).toBe("private")
    })
  })

  describe("wrapManyEvents", () => {
    test("should wrap for sender and recipients", () => {
      const event = {
        kind: 1 as EventKind,
        content: "Hello everyone!",
        tags: [],
      }

      const result = wrapManyEvents(event, senderPrivateKey, [recipientPublicKey])

      // Should have 2 wrapped events: one for sender, one for recipient
      expect(result).toHaveLength(2)
      expect(result[0]!.kind).toBe(GIFT_WRAP_KIND)
      expect(result[1]!.kind).toBe(GIFT_WRAP_KIND)

      // Each should have different p tag
      const senderPubkey = bytesToHex(schnorr.getPublicKey(senderPrivateKey))
      expect(result[0]!.tags).toEqual([["p", senderPubkey]])
      expect(result[1]!.tags).toEqual([["p", recipientPublicKey]])
    })

    test("should fail with no recipients", () => {
      const event = {
        kind: 1 as EventKind,
        content: "Hello!",
        tags: [],
      }

      expect(() => wrapManyEvents(event, senderPrivateKey, [])).toThrow(
        "At least one recipient is required."
      )
    })
  })

  describe("round trip", () => {
    test("should preserve event through wrap/unwrap cycle", () => {
      const original = {
        kind: 14 as EventKind,
        content: "Secret message",
        tags: [["p", "somepubkey"]],
      }

      const wrapped = wrapEvent(original, senderPrivateKey, recipientPublicKey)
      const unwrapped = unwrapEvent(wrapped, recipientPrivateKey)

      expect(unwrapped.kind).toBe(original.kind)
      expect(unwrapped.content).toBe(original.content)
      expect(unwrapped.tags).toEqual(original.tags)
    })
  })
})
