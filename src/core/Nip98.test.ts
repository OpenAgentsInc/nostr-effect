/**
 * NIP-98: HTTP Auth Tests
 */
import { describe, test, expect } from "bun:test"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, randomBytes } from "@noble/hashes/utils"
import { schnorr } from "@noble/curves/secp256k1"
import {
  getToken,
  validateToken,
  unpackEventFromToken,
  validateEventTimestamp,
  validateEventKind,
  validateEventUrlTag,
  validateEventMethodTag,
  validateEventPayloadTag,
  hashPayload,
  HTTP_AUTH_KIND,
  type EventTemplate,
} from "./Nip98.js"
import type { NostrEvent, EventId, Signature, PublicKey, Tag } from "./Schema.js"

const utf8Encoder = new TextEncoder()

// Helper to generate a secret key
function generateSecretKey(): Uint8Array {
  return randomBytes(32)
}

// Helper to get public key from secret key
function getPublicKey(sk: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(sk))
}

// Helper to finalize event (sign it)
function finalizeEvent(event: EventTemplate, sk: Uint8Array): NostrEvent {
  const pubkey = getPublicKey(sk) as PublicKey
  const eventForHash = {
    pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
  }
  const serialized = JSON.stringify([
    0,
    eventForHash.pubkey,
    eventForHash.created_at,
    eventForHash.kind,
    eventForHash.tags,
    eventForHash.content,
  ])
  const id = bytesToHex(sha256(utf8Encoder.encode(serialized))) as EventId
  const sig = bytesToHex(schnorr.sign(id, sk)) as Signature

  return {
    id,
    pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags as unknown as readonly Tag[],
    content: event.content,
    sig,
  }
}

describe("NIP-98: HTTP Auth", () => {
  describe("getToken", () => {
    test("returns without authorization scheme for GET", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk))
      const unpackedEvent = await unpackEventFromToken(token)

      expect(unpackedEvent.created_at).toBeGreaterThan(0)
      expect(unpackedEvent.content).toBe("")
      expect(unpackedEvent.kind).toBe(HTTP_AUTH_KIND)
      expect(unpackedEvent.pubkey as string).toBe(getPublicKey(sk))
      expect(unpackedEvent.tags as unknown as string[][]).toEqual([
        ["u", "http://test.com"],
        ["method", "get"],
      ])
    })

    test("returns token WITH authorization scheme for POST", async () => {
      const authorizationScheme = "Nostr "
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "post", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)

      expect(token.startsWith(authorizationScheme)).toBe(true)
      expect(unpackedEvent.created_at).toBeGreaterThan(0)
      expect(unpackedEvent.content).toBe("")
      expect(unpackedEvent.kind).toBe(HTTP_AUTH_KIND)
    })

    test("returns token with a valid payload tag when payload is present", async () => {
      const sk = generateSecretKey()
      const payload = { test: "payload" }
      const payloadHash = hashPayload(payload)
      const token = await getToken("http://test.com", "post", (e) => finalizeEvent(e, sk), true, payload)
      const unpackedEvent = await unpackEventFromToken(token)

      expect(unpackedEvent.tags).toContainEqual(["payload", payloadHash])
    })
  })

  describe("validateToken", () => {
    test("returns true for valid token without authorization scheme", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk))

      const isTokenValid = await validateToken(token, "http://test.com", "get")
      expect(isTokenValid).toBe(true)
    })

    test("returns true for valid token with authorization scheme", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const isTokenValid = await validateToken(token, "http://test.com", "get")

      expect(isTokenValid).toBe(true)
    })

    test("throws an error for invalid token", async () => {
      const isTokenValid = validateToken("fake", "http://test.com", "get")

      await expect(isTokenValid).rejects.toThrow(Error)
    })

    test("throws an error for missing token", async () => {
      const isTokenValid = validateToken("", "http://test.com", "get")

      await expect(isTokenValid).rejects.toThrow(Error)
    })
  })

  describe("validateEventTimestamp", () => {
    test("returns true for valid timestamp", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)
      const isEventTimestampValid = validateEventTimestamp(unpackedEvent)

      expect(isEventTimestampValid).toBe(true)
    })

    test("returns false for invalid timestamp", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)
      ;(unpackedEvent as { created_at: number }).created_at = 0
      const isEventTimestampValid = validateEventTimestamp(unpackedEvent)

      expect(isEventTimestampValid).toBe(false)
    })
  })

  describe("validateEventKind", () => {
    test("returns true for valid kind", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)
      const isEventKindValid = validateEventKind(unpackedEvent)

      expect(isEventKindValid).toBe(true)
    })

    test("returns false for invalid kind", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)
      ;(unpackedEvent as { kind: number }).kind = 0
      const isEventKindValid = validateEventKind(unpackedEvent)

      expect(isEventKindValid).toBe(false)
    })
  })

  describe("validateEventUrlTag", () => {
    test("returns true for valid url tag", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)
      const isEventUrlTagValid = validateEventUrlTag(unpackedEvent, "http://test.com")

      expect(isEventUrlTagValid).toBe(true)
    })

    test("returns false for invalid url tag", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)
      const isEventUrlTagValid = validateEventUrlTag(unpackedEvent, "http://wrong-test.com")

      expect(isEventUrlTagValid).toBe(false)
    })
  })

  describe("validateEventMethodTag", () => {
    test("returns true for valid method tag", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)
      const isEventMethodTagValid = validateEventMethodTag(unpackedEvent, "get")

      expect(isEventMethodTagValid).toBe(true)
    })

    test("returns false for invalid method tag", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "get", (e) => finalizeEvent(e, sk), true)
      const unpackedEvent = await unpackEventFromToken(token)
      const isEventMethodTagValid = validateEventMethodTag(unpackedEvent, "post")

      expect(isEventMethodTagValid).toBe(false)
    })
  })

  describe("validateEventPayloadTag", () => {
    test("returns true for valid payload tag", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "post", (e) => finalizeEvent(e, sk), true, { test: "payload" })
      const unpackedEvent = await unpackEventFromToken(token)
      const isEventPayloadTagValid = validateEventPayloadTag(unpackedEvent, { test: "payload" })

      expect(isEventPayloadTagValid).toBe(true)
    })

    test("returns false for invalid payload tag", async () => {
      const sk = generateSecretKey()
      const token = await getToken("http://test.com", "post", (e) => finalizeEvent(e, sk), true, { test: "a-payload" })
      const unpackedEvent = await unpackEventFromToken(token)
      const isEventPayloadTagValid = validateEventPayloadTag(unpackedEvent, { test: "a-different-payload" })

      expect(isEventPayloadTagValid).toBe(false)
    })
  })

  describe("hashPayload", () => {
    test("returns hash for valid payload", () => {
      const payload = { test: "payload" }
      const computedPayloadHash = hashPayload(payload)
      const expectedPayloadHash = bytesToHex(sha256(utf8Encoder.encode(JSON.stringify(payload))))

      expect(computedPayloadHash).toBe(expectedPayloadHash)
    })

    test("returns hash for empty payload", () => {
      const payload = {}
      const computedPayloadHash = hashPayload(payload)
      const expectedPayloadHash = bytesToHex(sha256(utf8Encoder.encode(JSON.stringify(payload))))

      expect(computedPayloadHash).toBe(expectedPayloadHash)
    })
  })
})
