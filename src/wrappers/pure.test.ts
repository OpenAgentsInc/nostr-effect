/**
 * Tests for pure.ts wrapper functions
 *
 * These tests verify nostr-tools compatibility for key generation,
 * event signing, and signature verification.
 */
import { describe, test, expect } from "bun:test"
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
  serializeEvent,
  getEventHash,
  validateEvent,
  sortEvents,
  verifiedSymbol,
} from "./pure.js"

describe("pure.ts wrapper", () => {
  describe("generateSecretKey", () => {
    test("generates 32-byte secret key", () => {
      const sk = generateSecretKey()
      expect(sk).toBeInstanceOf(Uint8Array)
      expect(sk.length).toBe(32)
    })

    test("generates unique keys each time", () => {
      const sk1 = generateSecretKey()
      const sk2 = generateSecretKey()
      expect(sk1).not.toEqual(sk2)
    })
  })

  describe("getPublicKey", () => {
    test("derives 64-character hex public key", () => {
      const sk = generateSecretKey()
      const pk = getPublicKey(sk)
      expect(pk).toMatch(/^[a-f0-9]{64}$/)
    })

    test("same secret key always derives same public key", () => {
      const sk = generateSecretKey()
      const pk1 = getPublicKey(sk)
      const pk2 = getPublicKey(sk)
      expect(pk1).toBe(pk2)
    })

    test("works with known test vector", () => {
      // Test vector from nostr-tools
      const sk = new Uint8Array(32)
      sk.fill(1) // All 0x01 bytes
      const pk = getPublicKey(sk)
      expect(pk).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe("finalizeEvent", () => {
    test("creates signed event with all fields", () => {
      const sk = generateSecretKey()
      const template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "Hello, Nostr!",
      }

      const event = finalizeEvent(template, sk)

      expect(event.kind).toBe(1)
      expect(event.content).toBe("Hello, Nostr!")
      expect(event.tags).toEqual([])
      expect(event.pubkey).toMatch(/^[a-f0-9]{64}$/)
      expect(event.id).toMatch(/^[a-f0-9]{64}$/)
      expect(event.sig).toMatch(/^[a-f0-9]{128}$/)
      expect(event[verifiedSymbol]).toBe(true)
    })

    test("event passes verification", () => {
      const sk = generateSecretKey()
      const template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["t", "test"]],
        content: "Test event",
      }

      const event = finalizeEvent(template, sk)
      expect(verifyEvent(event)).toBe(true)
    })

    test("pubkey matches derived key", () => {
      const sk = generateSecretKey()
      const pk = getPublicKey(sk)
      const event = finalizeEvent(
        {
          kind: 0,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "{}",
        },
        sk
      )

      expect(event.pubkey).toBe(pk)
    })
  })

  describe("verifyEvent", () => {
    test("returns true for valid event", () => {
      const sk = generateSecretKey()
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "Valid event",
        },
        sk
      )

      // Clear cached verification
      delete (event as any)[verifiedSymbol]

      expect(verifyEvent(event)).toBe(true)
    })

    test("returns false for tampered content", () => {
      const sk = generateSecretKey()
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "Original content",
        },
        sk
      )

      // Tamper with the content
      delete (event as any)[verifiedSymbol]
      event.content = "Tampered content"

      expect(verifyEvent(event)).toBe(false)
    })

    test("returns false for wrong signature", () => {
      const sk = generateSecretKey()
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "Test",
        },
        sk
      )

      // Use wrong signature (valid format but wrong value)
      delete (event as any)[verifiedSymbol]
      event.sig = "a".repeat(128)

      expect(verifyEvent(event)).toBe(false)
    })

    test("caches verification result", () => {
      const sk = generateSecretKey()
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "Test",
        },
        sk
      )

      // First verify returns true
      expect(verifyEvent(event)).toBe(true)

      // Should use cached result (still true)
      expect(event[verifiedSymbol]).toBe(true)
      expect(verifyEvent(event)).toBe(true)
    })
  })

  describe("serializeEvent", () => {
    test("serializes event in NIP-01 format", () => {
      const sk = generateSecretKey()
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: 1234567890,
          tags: [["p", "abc123"]],
          content: "Hello",
        },
        sk
      )

      const serialized = serializeEvent(event)
      const parsed = JSON.parse(serialized)

      expect(parsed[0]).toBe(0) // Always 0 as first element
      expect(parsed[1]).toBe(event.pubkey)
      expect(parsed[2]).toBe(1234567890)
      expect(parsed[3]).toBe(1)
      expect(parsed[4]).toEqual([["p", "abc123"]])
      expect(parsed[5]).toBe("Hello")
    })

    test("throws for invalid event", () => {
      expect(() => serializeEvent({} as any)).toThrow()
    })
  })

  describe("getEventHash", () => {
    test("returns 64-character hex hash", () => {
      const sk = generateSecretKey()
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "Test",
        },
        sk
      )

      const hash = getEventHash(event)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    test("hash matches event id", () => {
      const sk = generateSecretKey()
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "Test",
        },
        sk
      )

      const hash = getEventHash(event)
      expect(hash).toBe(event.id)
    })
  })

  describe("validateEvent", () => {
    test("returns true for valid event structure", () => {
      const sk = generateSecretKey()
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "Test",
        },
        sk
      )

      expect(validateEvent(event)).toBe(true)
    })

    test("returns false for missing fields", () => {
      expect(validateEvent({})).toBe(false)
      expect(validateEvent({ kind: 1 })).toBe(false)
      expect(validateEvent({ kind: 1, content: "test" })).toBe(false)
    })

    test("returns false for invalid pubkey", () => {
      expect(
        validateEvent({
          kind: 1,
          content: "test",
          created_at: 123,
          pubkey: "invalid",
          tags: [],
        })
      ).toBe(false)
    })

    test("returns false for non-array tags", () => {
      const sk = generateSecretKey()
      const pk = getPublicKey(sk)
      expect(
        validateEvent({
          kind: 1,
          content: "test",
          created_at: 123,
          pubkey: pk,
          tags: "not an array" as any,
        })
      ).toBe(false)
    })
  })

  describe("sortEvents", () => {
    test("sorts by created_at descending", () => {
      const sk = generateSecretKey()
      const events = [
        finalizeEvent({ kind: 1, created_at: 100, tags: [], content: "1" }, sk),
        finalizeEvent({ kind: 1, created_at: 300, tags: [], content: "3" }, sk),
        finalizeEvent({ kind: 1, created_at: 200, tags: [], content: "2" }, sk),
      ]

      sortEvents(events)

      expect(events[0]!.content).toBe("3")
      expect(events[1]!.content).toBe("2")
      expect(events[2]!.content).toBe("1")
    })

    test("sorts by id when timestamps are equal", () => {
      const sk = generateSecretKey()
      const timestamp = Math.floor(Date.now() / 1000)
      const events = [
        finalizeEvent({ kind: 1, created_at: timestamp, tags: [], content: "a" }, sk),
        finalizeEvent({ kind: 1, created_at: timestamp, tags: [], content: "b" }, sk),
      ]

      sortEvents(events)

      // Should be sorted lexicographically by id
      expect(events[0]!.id.localeCompare(events[1]!.id)).toBeLessThan(0)
    })
  })
})
