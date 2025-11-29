/**
 * NIP-94: File Metadata Tests
 */
import { describe, test, expect } from "bun:test"
import {
  generateEventTemplate,
  validateEvent,
  parseEvent,
  FILE_METADATA_KIND,
  type FileMetadataObject,
} from "./Nip94.js"
import type { NostrEvent, EventKind, UnixTimestamp, PublicKey, EventId, Signature, Tag } from "./Schema.js"

// Helper to create a mock event
function createMockEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "test-id" as EventId,
    pubkey: "test-pubkey" as PublicKey,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: FILE_METADATA_KIND,
    tags: [] as unknown as readonly Tag[],
    content: "test content",
    sig: "test-sig" as Signature,
    ...overrides,
  }
}

describe("NIP-94: File Metadata", () => {
  describe("generateEventTemplate", () => {
    test("should generate the correct event template", () => {
      const fileMetadataObject: FileMetadataObject = {
        content: "Lorem ipsum dolor sit amet",
        url: "https://example.com/image.jpg",
        m: "image/jpeg",
        x: "image",
        ox: "original",
        size: "1024",
        dim: "800x600",
        i: "abc123",
        blurhash: "abcdefg",
        thumb: "https://example.com/thumb.jpg",
        image: "https://example.com/image.jpg",
        summary: "Lorem ipsum",
        alt: "Image alt text",
        fallback: ["https://fallback1.example.com/image.jpg", "https://fallback2.example.com/image.jpg"],
      }

      const eventTemplate = generateEventTemplate(fileMetadataObject)

      expect(eventTemplate.content).toBe("Lorem ipsum dolor sit amet")
      expect(eventTemplate.kind).toBe(FILE_METADATA_KIND)
      expect(eventTemplate.tags).toEqual([
        ["url", "https://example.com/image.jpg"],
        ["m", "image/jpeg"],
        ["x", "image"],
        ["ox", "original"],
        ["size", "1024"],
        ["dim", "800x600"],
        ["i", "abc123"],
        ["blurhash", "abcdefg"],
        ["thumb", "https://example.com/thumb.jpg"],
        ["image", "https://example.com/image.jpg"],
        ["summary", "Lorem ipsum"],
        ["alt", "Image alt text"],
        ["fallback", "https://fallback1.example.com/image.jpg"],
        ["fallback", "https://fallback2.example.com/image.jpg"],
      ])
    })
  })

  describe("validateEvent", () => {
    test("should return true for a valid event", () => {
      const event = createMockEvent({
        kind: FILE_METADATA_KIND,
        content: "Lorem ipsum dolor sit amet",
        tags: [
          ["url", "https://example.com/image.jpg"],
          ["m", "image/jpeg"],
          ["x", "image"],
          ["ox", "original"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(true)
    })

    test("should return false if kind is not FILE_METADATA_KIND", () => {
      const event = createMockEvent({
        kind: 0 as EventKind,
        content: "Lorem ipsum dolor sit amet",
        tags: [
          ["url", "https://example.com/image.jpg"],
          ["m", "image/jpeg"],
          ["x", "image"],
          ["ox", "original"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })

    test("should return false if content is empty", () => {
      const event = createMockEvent({
        kind: FILE_METADATA_KIND,
        content: "",
        tags: [
          ["url", "https://example.com/image.jpg"],
          ["m", "image/jpeg"],
          ["x", "image"],
          ["ox", "original"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })

    test("should return false if required tags are missing", () => {
      const eventWithoutUrl = createMockEvent({
        kind: FILE_METADATA_KIND,
        content: "Lorem ipsum dolor sit amet",
        tags: [
          ["m", "image/jpeg"],
          ["x", "image"],
          ["ox", "original"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(eventWithoutUrl)).toBe(false)
    })

    test("should return false if size is not a number", () => {
      const event = createMockEvent({
        kind: FILE_METADATA_KIND,
        content: "Lorem ipsum dolor sit amet",
        tags: [
          ["url", "https://example.com/image.jpg"],
          ["m", "image/jpeg"],
          ["x", "image"],
          ["ox", "original"],
          ["size", "abc"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })

    test("should return false if dim is not a valid dimension string", () => {
      const event = createMockEvent({
        kind: FILE_METADATA_KIND,
        content: "Lorem ipsum dolor sit amet",
        tags: [
          ["url", "https://example.com/image.jpg"],
          ["m", "image/jpeg"],
          ["x", "image"],
          ["ox", "original"],
          ["dim", "abc"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })
  })

  describe("parseEvent", () => {
    test("should parse a valid event", () => {
      const event = createMockEvent({
        kind: FILE_METADATA_KIND,
        content: "Lorem ipsum dolor sit amet",
        tags: [
          ["url", "https://example.com/image.jpg"],
          ["m", "image/jpeg"],
          ["x", "image"],
          ["ox", "original"],
          ["size", "1024"],
          ["dim", "800x600"],
          ["fallback", "https://fallback1.example.com/image.jpg"],
          ["fallback", "https://fallback2.example.com/image.jpg"],
        ] as unknown as readonly Tag[],
      })

      const parsedEvent = parseEvent(event)

      expect(parsedEvent.content).toBe("Lorem ipsum dolor sit amet")
      expect(parsedEvent.url).toBe("https://example.com/image.jpg")
      expect(parsedEvent.m).toBe("image/jpeg")
      expect(parsedEvent.x).toBe("image")
      expect(parsedEvent.ox).toBe("original")
      expect(parsedEvent.size).toBe("1024")
      expect(parsedEvent.dim).toBe("800x600")
      expect(parsedEvent.fallback).toEqual([
        "https://fallback1.example.com/image.jpg",
        "https://fallback2.example.com/image.jpg",
      ])
    })

    test("should throw an error if the event is invalid", () => {
      const event = createMockEvent({
        kind: FILE_METADATA_KIND,
        content: "",
        tags: [
          ["url", "https://example.com/image.jpg"],
          ["m", "image/jpeg"],
          ["x", "image"],
          ["ox", "original"],
        ] as unknown as readonly Tag[],
      })

      expect(() => parseEvent(event)).toThrow("Invalid event")
    })
  })
})
