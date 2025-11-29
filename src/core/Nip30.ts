/**
 * NIP-30: Custom Emoji
 * https://github.com/nostr-protocol/nips/blob/master/30.md
 *
 * Custom emoji shortcode matching and replacement in content.
 */

/** Regex for a single emoji shortcode. */
export const EMOJI_SHORTCODE_REGEX = /:(\w+):/

/** Regex to find emoji shortcodes in content. */
export const regex = (): RegExp => new RegExp(`\\B${EMOJI_SHORTCODE_REGEX.source}\\B`, "g")

/** Represents a Nostr custom emoji. */
export interface CustomEmoji {
  /** The matched emoji name with colons. */
  readonly shortcode: `:${string}:`
  /** The matched emoji name without colons. */
  readonly name: string
}

/** Match result for a custom emoji in text content. */
export interface CustomEmojiMatch extends CustomEmoji {
  /** Index where the emoji begins in the text content. */
  readonly start: number
  /** Index where the emoji ends in the text content. */
  readonly end: number
}

/** Find all custom emoji shortcodes in content. */
export function* matchAll(content: string): Iterable<CustomEmojiMatch> {
  const matches = content.matchAll(regex())

  for (const match of matches) {
    try {
      const shortcode = match[0]
      const name = match[1]

      if (!shortcode || !name) continue

      yield {
        shortcode: shortcode as `:${string}:`,
        name,
        start: match.index!,
        end: match.index! + shortcode.length,
      }
    } catch (_e) {
      // do nothing
    }
  }
}

/** Replace all emoji shortcodes in the content. */
export function replaceAll(content: string, replacer: (match: CustomEmoji) => string): string {
  return content.replaceAll(regex(), (shortcode, name) => {
    return replacer({
      shortcode: shortcode as `:${string}:`,
      name,
    })
  })
}

/**
 * Get emoji URL from event tags
 */
export function getEmojiUrl(
  name: string,
  tags: readonly (readonly string[])[]
): string | undefined {
  const emojiTag = tags.find((t) => t[0] === "emoji" && t[1] === name)
  return emojiTag?.[2]
}

/**
 * Create an emoji tag for an event
 */
export function createEmojiTag(name: string, url: string): readonly string[] {
  return ["emoji", name, url] as const
}
