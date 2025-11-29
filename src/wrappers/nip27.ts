/**
 * NIP-27: Content Parsing
 *
 * Parse event content into structured blocks (text, references, URLs, media, emoji, hashtags).
 *
 * @example
 * ```typescript
 * import { parse } from 'nostr-effect/nip27'
 *
 * // Parse content into blocks
 * for (const block of parse('Check out nostr:npub1... #bitcoin')) {
 *   if (block.type === 'text') console.log('Text:', block.text)
 *   if (block.type === 'reference') console.log('Reference:', block.pointer)
 *   if (block.type === 'hashtag') console.log('Hashtag:', block.value)
 * }
 * ```
 */

// Re-export all from core implementation
export {
  parse,
  parseToArray,
  extractHashtags,
  extractReferences,
  extractUrls,
  type Block,
  type TextBlock,
  type ReferenceBlock,
  type UrlBlock,
  type RelayBlock,
  type ImageBlock,
  type VideoBlock,
  type AudioBlock,
  type EmojiBlock,
  type HashtagBlock,
} from "../core/Nip27.js"
