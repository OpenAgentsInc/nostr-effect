/**
 * NIP-30: Custom Emoji
 *
 * Match and replace custom emoji shortcodes in content.
 *
 * @example
 * ```typescript
 * import { regex, matchAll, replaceAll, getEmojiUrl } from 'nostr-effect/nip30'
 *
 * // Find all emoji shortcodes
 * for (const match of matchAll('Hello :smiley: world :heart:')) {
 *   console.log(match.name, match.shortcode)
 * }
 *
 * // Replace shortcodes with images
 * const html = replaceAll(content, (emoji) =>
 *   `<img src="${getEmojiUrl(emoji.name, event.tags)}" alt="${emoji.shortcode}" />`
 * )
 * ```
 */

// Re-export all from core implementation
export {
  EMOJI_SHORTCODE_REGEX,
  regex,
  matchAll,
  replaceAll,
  getEmojiUrl,
  createEmojiTag,
  type CustomEmoji,
  type CustomEmojiMatch,
} from "../core/Nip30.js"
