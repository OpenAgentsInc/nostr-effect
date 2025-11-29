/**
 * NIP-94: File Metadata
 *
 * Create and parse file metadata events.
 *
 * @example
 * ```typescript
 * import { generateEventTemplate, validateEvent, parseEvent } from 'nostr-effect/nip94'
 *
 * // Create a file metadata event
 * const template = generateEventTemplate({
 *   content: 'My file',
 *   url: 'https://example.com/file.jpg',
 *   m: 'image/jpeg',
 *   x: '<sha256-hash>',
 *   ox: '<original-hash>'
 * })
 * ```
 */

// Re-export all from core implementation
export {
  FILE_METADATA_KIND,
  generateEventTemplate,
  validateEvent,
  parseEvent,
  type FileMetadataObject,
  type EventTemplate,
} from "../core/Nip94.js"
