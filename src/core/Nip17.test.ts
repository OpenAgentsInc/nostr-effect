/**
 * NIP-17: Private Direct Messages Tests
 */
import { describe, test, expect } from "bun:test"
import { wrapEvent, wrapManyEvents, unwrapEvent, PRIVATE_DIRECT_MESSAGE_KIND } from "./Nip17.js"
import { hexToBytes, bytesToHex } from "@noble/hashes/utils"
import { schnorr } from "@noble/curves/secp256k1"

// Test keys - use hexToBytes directly for test
const senderPrivateKey = hexToBytes("0beebd40c5d871af850a328090a7ba1fbdeb2c9dd0e3c28fd629aa843158712e")

const sk1 = hexToBytes("f09ac9b695d0a4c6daa418fe95b977eea20f54d9545592bc36a4f9e14f3eb840")
const sk2 = hexToBytes("5393a825e5892d8e18d4a5ea61ced105e8bb2a106f42876be3a40522e0b13747")

const recipients = [
  { publicKey: bytesToHex(schnorr.getPublicKey(sk1)), relayUrl: "wss://relay1.com" },
  { publicKey: bytesToHex(schnorr.getPublicKey(sk2)) },
]

const message = "Hello, this is a direct message!"
const conversationTitle = "Private Group Conversation"
const replyTo = { eventId: "previousEventId123" }

describe("NIP-17: Private Direct Messages", () => {
  describe("wrapEvent", () => {
    test("should create gift-wrapped event with correct kind", () => {
      const wrappedEvent = wrapEvent(senderPrivateKey, recipients[0]!, message, conversationTitle, replyTo)

      expect(wrappedEvent.kind as number).toBe(1059) // GIFT_WRAP_KIND
      expect(wrappedEvent.tags).toEqual([["p", recipients[0]!.publicKey]])
    })

    test("should create wrapped event with id and sig", () => {
      const wrappedEvent = wrapEvent(senderPrivateKey, recipients[0]!, message)

      expect(typeof wrappedEvent.id).toBe("string")
      expect(typeof wrappedEvent.sig).toBe("string")
      expect(wrappedEvent.id.length).toBe(64)
      expect(wrappedEvent.sig.length).toBe(128)
    })
  })

  describe("wrapManyEvents", () => {
    test("should wrap for sender and all recipients", () => {
      const wrappedEvents = wrapManyEvents(senderPrivateKey, recipients, message, conversationTitle, replyTo)

      // Should have 3 wrapped events: one for sender, two for recipients
      expect(wrappedEvents).toHaveLength(3)
      expect(wrappedEvents[0]!.kind as number).toBe(1059)
      expect(wrappedEvents[1]!.kind as number).toBe(1059)
      expect(wrappedEvents[2]!.kind as number).toBe(1059)
    })

    test("should throw error with no recipients", () => {
      expect(() => wrapManyEvents(senderPrivateKey, [], message)).toThrow("At least one recipient is required.")
    })
  })

  describe("unwrapEvent", () => {
    test("should unwrap gift-wrapped event", () => {
      const wrappedEvent = wrapEvent(senderPrivateKey, recipients[0]!, message, conversationTitle, replyTo)
      const result = unwrapEvent(wrappedEvent, sk1)

      expect(result.kind as number).toBe(PRIVATE_DIRECT_MESSAGE_KIND as number)
      expect(result.content).toBe(message)
      expect(result.tags).toContainEqual(["p", recipients[0]!.publicKey, "wss://relay1.com"])
      expect(result.tags).toContainEqual(["e", "previousEventId123", "", "reply"])
      expect(result.tags).toContainEqual(["subject", conversationTitle])
    })

    test("should preserve sender pubkey", () => {
      const wrappedEvent = wrapEvent(senderPrivateKey, recipients[0]!, message)
      const result = unwrapEvent(wrappedEvent, sk1)

      const senderPubkey = bytesToHex(schnorr.getPublicKey(senderPrivateKey))
      expect(result.pubkey as string).toBe(senderPubkey)
    })
  })
})
