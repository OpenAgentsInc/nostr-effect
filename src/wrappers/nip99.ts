/**
 * NIP-99: Classified Listings
 *
 * Create and parse classified listing events.
 *
 * @example
 * ```typescript
 * import { generateEventTemplate, validateEvent, parseEvent } from 'nostr-effect/nip99'
 *
 * // Create a classified listing
 * const template = generateEventTemplate({
 *   isDraft: false,
 *   title: 'For Sale',
 *   summary: 'Great item',
 *   content: 'Full description...',
 *   publishedAt: String(Date.now() / 1000),
 *   location: 'NYC',
 *   price: { amount: '100', currency: 'USD' },
 *   images: [],
 *   hashtags: [],
 *   additionalTags: {}
 * })
 * ```
 */

// Re-export all from core implementation
export {
  CLASSIFIED_LISTING_KIND,
  DRAFT_CLASSIFIED_LISTING_KIND,
  generateEventTemplate,
  validateEvent,
  parseEvent,
  type PriceDetails,
  type ClassifiedListingObject,
  type EventTemplate,
} from "../core/Nip99.js"
