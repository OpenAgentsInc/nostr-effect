/**
 * NIP-27: Content Parsing Tests
 */
import { describe, test, expect } from "bun:test"
import {
  parse,
  parseToArray,
  extractHashtags,
  extractReferences,
  extractUrls,
  type TextBlock,
  type HashtagBlock,
  type UrlBlock,
  type ReferenceBlock,
} from "./Nip27.js"
import type { NostrEvent, Tag } from "./Schema.js"

const TEST_NPUB = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m"
// Using a second npub for testing multiple refs
const TEST_NPUB2 = "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s"

describe("NIP-27: Content Parsing", () => {
  describe("parse() generator", () => {
    test("should parse plain text", () => {
      const blocks = [...parse("Hello, world!")]
      expect(blocks).toHaveLength(1)
      expect(blocks[0]!.type).toBe("text")
      expect((blocks[0] as TextBlock).text).toBe("Hello, world!")
    })

    test("should parse hashtags", () => {
      const blocks = [...parse("Hello #nostr #bitcoin")]
      expect(blocks).toHaveLength(4)
      expect(blocks[0]!.type).toBe("text")
      expect(blocks[1]!.type).toBe("hashtag")
      expect((blocks[1] as HashtagBlock).value).toBe("nostr")
      expect(blocks[2]!.type).toBe("text")
      expect(blocks[3]!.type).toBe("hashtag")
      expect((blocks[3] as HashtagBlock).value).toBe("bitcoin")
    })

    test("should parse URLs", () => {
      const blocks = [...parse("Check https://example.com for more")]
      expect(blocks).toHaveLength(3)
      expect(blocks[0]!.type).toBe("text")
      expect(blocks[1]!.type).toBe("url")
      expect((blocks[1] as UrlBlock).url).toBe("https://example.com/")
      expect(blocks[2]!.type).toBe("text")
    })

    test("should parse nostr: URIs", () => {
      const blocks = [...parse(`Check out nostr:${TEST_NPUB}`)]
      expect(blocks).toHaveLength(2)
      expect(blocks[0]!.type).toBe("text")
      expect(blocks[1]!.type).toBe("reference")
      const pointer = (blocks[1] as ReferenceBlock).pointer
      expect("pubkey" in pointer).toBe(true)
    })

    test("should parse image URLs", () => {
      const blocks = [...parse("Image: https://example.com/image.png")]
      const imageBlock = blocks.find((b) => b.type === "image")
      expect(imageBlock).toBeDefined()
      expect(imageBlock!.type).toBe("image")
    })

    test("should parse video URLs", () => {
      const blocks = [...parse("Video: https://example.com/video.mp4")]
      const videoBlock = blocks.find((b) => b.type === "video")
      expect(videoBlock).toBeDefined()
      expect(videoBlock!.type).toBe("video")
    })

    test("should parse audio URLs", () => {
      const blocks = [...parse("Audio: https://example.com/audio.mp3")]
      const audioBlock = blocks.find((b) => b.type === "audio")
      expect(audioBlock).toBeDefined()
      expect(audioBlock!.type).toBe("audio")
    })

    test("should parse relay URLs", () => {
      const blocks = [...parse("Connect to wss://relay.example.com")]
      const relayBlock = blocks.find((b) => b.type === "relay")
      expect(relayBlock).toBeDefined()
      expect(relayBlock!.type).toBe("relay")
    })

    test("should ignore nsec and note in nostr: URIs", () => {
      const blocks = [...parse("Secret: nostr:nsec1abc123")]
      // nsec should be treated as text, not a reference
      const refBlocks = blocks.filter((b) => b.type === "reference")
      expect(refBlocks).toHaveLength(0)
    })
  })

  describe("parse() with event (emojis)", () => {
    test("should parse custom emojis from event tags", () => {
      const event = {
        content: "Hello :smile: world",
        tags: [["emoji", "smile", "https://example.com/smile.png"] as unknown as Tag],
      } as unknown as NostrEvent

      const blocks = [...parse(event)]
      const emojiBlock = blocks.find((b) => b.type === "emoji")
      expect(emojiBlock).toBeDefined()
      expect(emojiBlock!.type).toBe("emoji")
    })
  })

  describe("parseToArray()", () => {
    test("should return array of blocks", () => {
      const blocks = parseToArray("Hello #nostr")
      expect(Array.isArray(blocks)).toBe(true)
      expect(blocks).toHaveLength(2)
    })
  })

  describe("extractHashtags()", () => {
    test("should extract all hashtags", () => {
      const hashtags = extractHashtags("Hello #nostr and #bitcoin")
      expect(hashtags).toEqual(["nostr", "bitcoin"])
    })

    test("should return empty array for no hashtags", () => {
      const hashtags = extractHashtags("No hashtags here")
      expect(hashtags).toEqual([])
    })
  })

  describe("extractReferences()", () => {
    test("should extract nostr references", () => {
      const refs = extractReferences(`Check nostr:${TEST_NPUB}`)
      expect(refs).toHaveLength(1)
      expect("pubkey" in refs[0]!).toBe(true)
    })

    test("should extract multiple references", () => {
      const refs = extractReferences(`Check nostr:${TEST_NPUB} and nostr:${TEST_NPUB2}`)
      expect(refs).toHaveLength(2)
    })
  })

  describe("extractUrls()", () => {
    test("should extract all URLs", () => {
      const urls = extractUrls("Check https://example.com and https://test.com/image.png")
      expect(urls).toHaveLength(2)
    })

    test("should include media URLs", () => {
      const urls = extractUrls("Image: https://example.com/photo.jpg Video: https://example.com/video.mp4")
      expect(urls).toHaveLength(2)
    })
  })

  describe("edge cases", () => {
    test("should handle empty content", () => {
      const blocks = parseToArray("")
      expect(blocks).toHaveLength(0)
    })

    test("should handle content with only hashtag", () => {
      const blocks = parseToArray("#nostr")
      expect(blocks).toHaveLength(1)
      expect(blocks[0]!.type).toBe("hashtag")
    })

    test("should handle multiple consecutive hashtags", () => {
      const blocks = parseToArray("#nostr#bitcoin")
      // First hashtag includes the rest since no space
      expect(blocks.filter((b) => b.type === "hashtag")).toHaveLength(1)
    })

    test("should handle URL followed by text without space", () => {
      const blocks = parseToArray("https://example.com,more text")
      const urlBlock = blocks.find((b) => b.type === "url")
      expect(urlBlock).toBeDefined()
    })
  })
})
