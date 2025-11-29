/**
 * NIP-27: Content Parsing
 *
 * Parses event content into structured blocks (text, references, URLs, etc.)
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/27.md
 */
import type { NostrEvent } from "./Schema.js"
import { decodeSync, type ProfilePointer, type EventPointer, type AddressPointer } from "./Nip19.js"

// =============================================================================
// Types
// =============================================================================

/** Text content block */
export interface TextBlock {
  readonly type: "text"
  readonly text: string
}

/** Nostr reference block (npub, nevent, naddr, nprofile) */
export interface ReferenceBlock {
  readonly type: "reference"
  readonly pointer: ProfilePointer | AddressPointer | EventPointer
}

/** URL block */
export interface UrlBlock {
  readonly type: "url"
  readonly url: string
}

/** WebSocket relay URL block */
export interface RelayBlock {
  readonly type: "relay"
  readonly url: string
}

/** Image URL block */
export interface ImageBlock {
  readonly type: "image"
  readonly url: string
}

/** Video URL block */
export interface VideoBlock {
  readonly type: "video"
  readonly url: string
}

/** Audio URL block */
export interface AudioBlock {
  readonly type: "audio"
  readonly url: string
}

/** Custom emoji block */
export interface EmojiBlock {
  readonly type: "emoji"
  readonly shortcode: string
  readonly url: string
}

/** Hashtag block */
export interface HashtagBlock {
  readonly type: "hashtag"
  readonly value: string
}

/** All possible block types */
export type Block =
  | TextBlock
  | ReferenceBlock
  | UrlBlock
  | RelayBlock
  | ImageBlock
  | VideoBlock
  | AudioBlock
  | EmojiBlock
  | HashtagBlock

// =============================================================================
// Constants
// =============================================================================

const NO_CHARACTER = /\W/
const NO_URL_CHARACTER = /\W |\W$|$|,| /
const MAX_HASHTAG_LENGTH = 42

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|heic|svg)$/i
const VIDEO_EXTENSIONS = /\.(mp4|avi|webm|mkv|mov)$/i
const AUDIO_EXTENSIONS = /\.(mp3|aac|ogg|opus|wav|flac)$/i

// =============================================================================
// Functions
// =============================================================================

/**
 * Parse content into blocks.
 * Can accept either a string or a NostrEvent (for emoji tag extraction).
 */
export function* parse(content: string | NostrEvent): Generator<Block, void, unknown> {
  // Extract emoji tags if input is an event
  const emojis: EmojiBlock[] = []
  if (typeof content !== "string") {
    for (const tag of content.tags) {
      if (tag[0] === "emoji" && tag.length >= 3) {
        emojis.push({ type: "emoji", shortcode: tag[1]!, url: tag[2]! })
      }
    }
    content = content.content
  }

  const max = content.length
  let prevIndex = 0
  let index = 0

  mainloop: while (index < max) {
    const colonIdx = content.indexOf(":", index)
    const hashIdx = content.indexOf("#", index)

    if (colonIdx === -1 && hashIdx === -1) {
      // Reached end
      break mainloop
    }

    // Handle hashtag before colon
    if (colonIdx === -1 || (hashIdx >= 0 && hashIdx < colonIdx)) {
      // Parse hashtag
      if (hashIdx === 0 || content[hashIdx - 1] === " ") {
        const match = content.slice(hashIdx + 1, hashIdx + MAX_HASHTAG_LENGTH).match(NO_CHARACTER)
        const end = match ? hashIdx + 1 + match.index! : max
        const hashtagValue = content.slice(hashIdx + 1, end)

        if (hashtagValue.length > 0) {
          if (prevIndex !== hashIdx) {
            yield { type: "text", text: content.slice(prevIndex, hashIdx) }
          }
          yield { type: "hashtag", value: hashtagValue }
          index = end
          prevIndex = index
          continue mainloop
        }
      }

      // Ignore this, it's nothing
      index = hashIdx + 1
      continue mainloop
    }

    // Otherwise parse things that have a ":"

    // Check for nostr: URI
    if (content.slice(colonIdx - 5, colonIdx) === "nostr") {
      const match = content.slice(colonIdx + 60).match(NO_CHARACTER)
      const end = match ? colonIdx + 60 + match.index! : max

      try {
        const bech32String = content.slice(colonIdx + 1, end)
        const decoded = decodeSync(bech32String)

        let pointer: ProfilePointer | AddressPointer | EventPointer

        switch (decoded.type) {
          case "npub":
            pointer = { pubkey: decoded.data as string }
            break
          case "nsec":
          case "note":
            // Ignore these, treat as not valid URI
            index = end + 1
            continue mainloop
          default:
            pointer = decoded.data as ProfilePointer | AddressPointer | EventPointer
        }

        if (prevIndex !== colonIdx - 5) {
          yield { type: "text", text: content.slice(prevIndex, colonIdx - 5) }
        }
        yield { type: "reference", pointer }
        index = end
        prevIndex = index
        continue mainloop
      } catch {
        // Not a valid nostr URI
        index = colonIdx + 1
        continue mainloop
      }
    }

    // Check for https:// or http://
    if (content.slice(colonIdx - 5, colonIdx) === "https" || content.slice(colonIdx - 4, colonIdx) === "http") {
      const match = content.slice(colonIdx + 4).match(NO_URL_CHARACTER)
      const end = match ? colonIdx + 4 + match.index! : max
      const prefixLen = content[colonIdx - 1] === "s" ? 5 : 4

      try {
        const url = new URL(content.slice(colonIdx - prefixLen, end))
        if (!url.hostname.includes(".")) {
          throw new Error("invalid url")
        }

        if (prevIndex !== colonIdx - prefixLen) {
          yield { type: "text", text: content.slice(prevIndex, colonIdx - prefixLen) }
        }

        // Check for media types
        if (IMAGE_EXTENSIONS.test(url.pathname)) {
          yield { type: "image", url: url.toString() }
          index = end
          prevIndex = index
          continue mainloop
        }
        if (VIDEO_EXTENSIONS.test(url.pathname)) {
          yield { type: "video", url: url.toString() }
          index = end
          prevIndex = index
          continue mainloop
        }
        if (AUDIO_EXTENSIONS.test(url.pathname)) {
          yield { type: "audio", url: url.toString() }
          index = end
          prevIndex = index
          continue mainloop
        }

        yield { type: "url", url: url.toString() }
        index = end
        prevIndex = index
        continue mainloop
      } catch {
        // Not a valid URL
        index = end + 1
        continue mainloop
      }
    }

    // Check for wss:// or ws://
    if (content.slice(colonIdx - 3, colonIdx) === "wss" || content.slice(colonIdx - 2, colonIdx) === "ws") {
      const match = content.slice(colonIdx + 4).match(NO_URL_CHARACTER)
      const end = match ? colonIdx + 4 + match.index! : max
      const prefixLen = content[colonIdx - 1] === "s" ? 3 : 2

      try {
        const url = new URL(content.slice(colonIdx - prefixLen, end))
        if (!url.hostname.includes(".")) {
          throw new Error("invalid ws url")
        }

        if (prevIndex !== colonIdx - prefixLen) {
          yield { type: "text", text: content.slice(prevIndex, colonIdx - prefixLen) }
        }
        yield { type: "relay", url: url.toString() }
        index = end
        prevIndex = index
        continue mainloop
      } catch {
        // Not a valid URL
        index = end + 1
        continue mainloop
      }
    }

    // Try to parse an emoji shortcode
    for (const emoji of emojis) {
      if (
        content[colonIdx + emoji.shortcode.length + 1] === ":" &&
        content.slice(colonIdx + 1, colonIdx + emoji.shortcode.length + 1) === emoji.shortcode
      ) {
        // Found an emoji
        if (prevIndex !== colonIdx) {
          yield { type: "text", text: content.slice(prevIndex, colonIdx) }
        }
        yield emoji
        index = colonIdx + emoji.shortcode.length + 2
        prevIndex = index
        continue mainloop
      }
    }

    // Ignore this, it's nothing
    index = colonIdx + 1
    continue mainloop
  }

  // Yield remaining text
  if (prevIndex !== max) {
    yield { type: "text", text: content.slice(prevIndex) }
  }
}

/**
 * Parse content and return as array instead of generator
 */
export function parseToArray(content: string | NostrEvent): Block[] {
  return [...parse(content)]
}

/**
 * Extract all hashtags from content
 */
export function extractHashtags(content: string | NostrEvent): string[] {
  const blocks = parseToArray(content)
  return blocks
    .filter((b): b is HashtagBlock => b.type === "hashtag")
    .map((b) => b.value)
}

/**
 * Extract all nostr references from content
 */
export function extractReferences(content: string | NostrEvent): ReferenceBlock["pointer"][] {
  const blocks = parseToArray(content)
  return blocks
    .filter((b): b is ReferenceBlock => b.type === "reference")
    .map((b) => b.pointer)
}

/**
 * Extract all URLs from content (including images, videos, audio)
 */
export function extractUrls(content: string | NostrEvent): string[] {
  const blocks = parseToArray(content)
  return blocks
    .filter(
      (b): b is UrlBlock | ImageBlock | VideoBlock | AudioBlock =>
        b.type === "url" || b.type === "image" || b.type === "video" || b.type === "audio"
    )
    .map((b) => b.url)
}
