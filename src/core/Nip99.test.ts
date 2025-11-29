/**
 * NIP-99: Classified Listings Tests
 */
import { describe, test, expect } from "bun:test"
import {
  validateEvent,
  parseEvent,
  generateEventTemplate,
  CLASSIFIED_LISTING_KIND,
  DRAFT_CLASSIFIED_LISTING_KIND,
  type ClassifiedListingObject,
} from "./Nip99.js"
import type { NostrEvent, UnixTimestamp, PublicKey, EventId, Signature, Tag } from "./Schema.js"

// Helper to create a mock event
function createMockEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "test-id" as EventId,
    pubkey: "test-pubkey" as PublicKey,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: CLASSIFIED_LISTING_KIND,
    tags: [] as unknown as readonly Tag[],
    content: "",
    sig: "test-sig" as Signature,
    ...overrides,
  }
}

describe("NIP-99: Classified Listings", () => {
  describe("validateEvent", () => {
    test("should return true for a valid classified listing event", () => {
      const event = createMockEvent({
        kind: CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          ["d", "sample-title"],
          ["title", "Sample Title"],
          ["summary", "Sample Summary"],
          ["published_at", "1296962229"],
          ["location", "NYC"],
          ["price", "100", "USD"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(true)
    })

    test("should return false when the d tag is missing", () => {
      const event = createMockEvent({
        kind: CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          ["title", "Sample Title"],
          ["summary", "Sample Summary"],
          ["published_at", "1296962229"],
          ["location", "NYC"],
          ["price", "100", "USD"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })

    test("should return false when the title tag is missing", () => {
      const event = createMockEvent({
        kind: CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          ["d", "sample-title"],
          ["summary", "Sample Summary"],
          ["published_at", "1296962229"],
          ["location", "NYC"],
          ["price", "100", "USD"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })

    test("should return false when published_at is not a valid timestamp", () => {
      const event = createMockEvent({
        kind: CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          ["d", "sample-title"],
          ["title", "Sample Title"],
          ["summary", "Sample Summary"],
          ["published_at", "not-a-valid-timestamp"],
          ["location", "NYC"],
          ["price", "100", "USD"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })

    test("should return false when price has invalid number of elements", () => {
      const event = createMockEvent({
        kind: CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          ["d", "sample-title"],
          ["title", "Sample Title"],
          ["summary", "Sample Summary"],
          ["published_at", "1296962229"],
          ["location", "NYC"],
          ["price", "100"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })

    test("should return false when price is not a valid number", () => {
      const event = createMockEvent({
        kind: CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          ["d", "sample-title"],
          ["title", "Sample Title"],
          ["summary", "Sample Summary"],
          ["published_at", "1296962229"],
          ["location", "NYC"],
          ["price", "not-a-number", "USD"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })

    test("should return false when currency is not 3 characters", () => {
      const event = createMockEvent({
        kind: CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          ["d", "sample-title"],
          ["title", "Sample Title"],
          ["summary", "Sample Summary"],
          ["published_at", "1296962229"],
          ["location", "NYC"],
          ["price", "100", "invalid"],
        ] as unknown as readonly Tag[],
      })

      expect(validateEvent(event)).toBe(false)
    })
  })

  describe("parseEvent", () => {
    test("should parse a valid event", () => {
      const event = createMockEvent({
        kind: DRAFT_CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          ["d", "sample-title"],
          ["title", "Sample Title"],
          ["summary", "Sample Summary"],
          ["published_at", "1296962229"],
          ["location", "NYC"],
          ["price", "100", "USD"],
          ["image", "https://example.com/image1.jpg", "800x600"],
          ["image", "https://example.com/image2.jpg"],
          ["t", "tag1"],
          ["t", "tag2"],
          ["e", "value1", "value2"],
          ["a", "value1", "value2"],
        ] as unknown as readonly Tag[],
      })

      const listing = parseEvent(event)

      expect(listing.isDraft).toBe(true)
      expect(listing.title).toBe("Sample Title")
      expect(listing.summary).toBe("Sample Summary")
      expect(listing.publishedAt).toBe("1296962229")
      expect(listing.location).toBe("NYC")
      expect(listing.price.amount).toBe("100")
      expect(listing.price.currency).toBe("USD")
      expect(listing.images).toHaveLength(2)
      expect(listing.hashtags).toEqual(["tag1", "tag2"])
    })

    test("should throw an error for an invalid event", () => {
      const event = createMockEvent({
        kind: DRAFT_CLASSIFIED_LISTING_KIND,
        content: "Lorem ipsum dolor sit amet.",
        tags: [
          // Missing d tag
          ["title", "Sample Title"],
          ["summary", "Sample Summary"],
          ["published_at", "1296962229"],
          ["location", "NYC"],
          ["price", "100", "USD"],
        ] as unknown as readonly Tag[],
      })

      expect(() => parseEvent(event)).toThrow("Invalid event")
    })
  })

  describe("generateEventTemplate", () => {
    test("should generate the correct event template", () => {
      const listing: ClassifiedListingObject = {
        isDraft: true,
        title: "Sample Title",
        summary: "Sample Summary",
        content: "Lorem ipsum dolor sit amet.",
        publishedAt: "1296962229",
        location: "NYC",
        price: {
          amount: "100",
          currency: "USD",
        },
        images: [
          { url: "https://example.com/image1.jpg", dimensions: "800x600" },
          { url: "https://example.com/image2.jpg" },
        ],
        hashtags: ["tag1", "tag2"],
        additionalTags: {
          extra1: "value1",
          extra2: "value2",
        },
      }

      const eventTemplate = generateEventTemplate(listing)

      expect(eventTemplate.kind).toBe(DRAFT_CLASSIFIED_LISTING_KIND)
      expect(eventTemplate.content).toBe("Lorem ipsum dolor sit amet.")
      expect(eventTemplate.tags).toContainEqual(["d", "sample-title"])
      expect(eventTemplate.tags).toContainEqual(["title", "Sample Title"])
      expect(eventTemplate.tags).toContainEqual(["summary", "Sample Summary"])
      expect(eventTemplate.tags).toContainEqual(["published_at", "1296962229"])
      expect(eventTemplate.tags).toContainEqual(["location", "NYC"])
      expect(eventTemplate.tags).toContainEqual(["price", "100", "USD"])
      expect(eventTemplate.tags).toContainEqual(["image", "https://example.com/image1.jpg", "800x600"])
      expect(eventTemplate.tags).toContainEqual(["image", "https://example.com/image2.jpg"])
      expect(eventTemplate.tags).toContainEqual(["t", "tag1"])
      expect(eventTemplate.tags).toContainEqual(["t", "tag2"])
    })
  })
})
