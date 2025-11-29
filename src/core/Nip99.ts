/**
 * NIP-99: Classified Listings
 * https://github.com/nostr-protocol/nips/blob/master/99.md
 *
 * Classified listing events
 */
import type { EventKind, UnixTimestamp, NostrEvent } from "./Schema.js"

/** Kind 30402: Classified Listing */
export const CLASSIFIED_LISTING_KIND = 30402 as EventKind

/** Kind 30403: Draft Classified Listing */
export const DRAFT_CLASSIFIED_LISTING_KIND = 30403 as EventKind

/**
 * Price details
 */
export interface PriceDetails {
  /** The amount of the price */
  amount: string
  /** The currency in 3-letter ISO 4217 format */
  currency: string
  /** Optional frequency of payment */
  frequency?: string
}

/**
 * Classified listing object
 */
export interface ClassifiedListingObject {
  /** Whether the listing is a draft */
  isDraft: boolean
  /** A title of the listing */
  title: string
  /** A short summary or tagline */
  summary: string
  /** A description in Markdown format */
  content: string
  /** Timestamp when listing was published */
  publishedAt: string
  /** Location of the listing */
  location: string
  /** Price details */
  price: PriceDetails
  /** Images with optional dimensions */
  images: Array<{ url: string; dimensions?: string }>
  /** Tags/Hashtags (categories, keywords) */
  hashtags: string[]
  /** Other standard tags */
  additionalTags: Record<string, string | string[]>
}

/** Event template for signing */
export interface EventTemplate {
  kind: EventKind
  content: string
  tags: string[][]
  created_at: UnixTimestamp
}

/**
 * Validate a classified listing event
 */
export function validateEvent(event: NostrEvent): boolean {
  if (event.kind !== CLASSIFIED_LISTING_KIND && event.kind !== DRAFT_CLASSIFIED_LISTING_KIND) {
    return false
  }

  const requiredTags = ["d", "title", "summary", "location", "published_at", "price"]
  const requiredTagCount = requiredTags.length
  const tagCounts: Record<string, number> = {}

  if (event.tags.length < requiredTagCount) return false

  for (const tag of event.tags) {
    if (tag.length < 2) return false

    const [tagName, ...tagValues] = tag

    if (tagName === "published_at") {
      const timestamp = parseInt(tagValues[0]!)
      if (isNaN(timestamp)) return false
    } else if (tagName === "price") {
      if (tagValues.length < 2) return false

      const price = parseInt(tagValues[0]!)
      if (isNaN(price) || tagValues[1]!.length !== 3) return false
    } else if ((tagName === "e" || tagName === "a") && tag.length !== 3) {
      return false
    }

    if (requiredTags.includes(tagName!)) {
      tagCounts[tagName!] = (tagCounts[tagName!] || 0) + 1
    }
  }

  return Object.values(tagCounts).every((count) => count === 1) && Object.keys(tagCounts).length === requiredTagCount
}

/**
 * Parse a classified listing event into an object
 */
export function parseEvent(event: NostrEvent): ClassifiedListingObject {
  if (!validateEvent(event)) {
    throw new Error("Invalid event")
  }

  const listing: ClassifiedListingObject = {
    isDraft: event.kind === DRAFT_CLASSIFIED_LISTING_KIND,
    title: "",
    summary: "",
    content: event.content,
    publishedAt: "",
    location: "",
    price: {
      amount: "",
      currency: "",
    },
    images: [],
    hashtags: [],
    additionalTags: {},
  }

  for (const tag of event.tags) {
    const [tagName, ...tagValues] = tag

    if (tagName === "title") {
      listing.title = tagValues[0]!
    } else if (tagName === "summary") {
      listing.summary = tagValues[0]!
    } else if (tagName === "published_at") {
      listing.publishedAt = tagValues[0]!
    } else if (tagName === "location") {
      listing.location = tagValues[0]!
    } else if (tagName === "price") {
      listing.price.amount = tagValues[0]!
      listing.price.currency = tagValues[1]!

      if (tagValues.length === 3 && tagValues[2] !== undefined) {
        listing.price.frequency = tagValues[2]
      }
    } else if (tagName === "image") {
      const imageEntry: { url: string; dimensions?: string } = { url: tagValues[0]! }
      if (tagValues[1] !== undefined) {
        imageEntry.dimensions = tagValues[1]
      }
      listing.images.push(imageEntry)
    } else if (tagName === "t") {
      listing.hashtags.push(tagValues[0]!)
    } else if (tagName === "e" || tagName === "a") {
      listing.additionalTags[tagName] = [...tagValues]
    }
  }

  return listing
}

/**
 * Generate an event template from a classified listing object
 */
export function generateEventTemplate(listing: ClassifiedListingObject): EventTemplate {
  const priceTag = ["price", listing.price.amount, listing.price.currency]
  if (listing.price.frequency) priceTag.push(listing.price.frequency)

  const tags: string[][] = [
    ["d", listing.title.trim().toLowerCase().replace(/ /g, "-")],
    ["title", listing.title],
    ["published_at", listing.publishedAt],
    ["summary", listing.summary],
    ["location", listing.location],
    priceTag,
  ]

  for (const image of listing.images) {
    const imageTag = ["image", image.url]
    if (image.dimensions) imageTag.push(image.dimensions)
    tags.push(imageTag)
  }

  for (const hashtag of listing.hashtags) {
    tags.push(["t", hashtag])
  }

  for (const [key, value] of Object.entries(listing.additionalTags)) {
    if (Array.isArray(value)) {
      for (const val of value) {
        tags.push([key, val])
      }
    } else {
      tags.push([key, value])
    }
  }

  return {
    kind: listing.isDraft ? DRAFT_CLASSIFIED_LISTING_KIND : CLASSIFIED_LISTING_KIND,
    content: listing.content,
    tags,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
  }
}
