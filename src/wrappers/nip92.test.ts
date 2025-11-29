/**
 * NIP-92: Media Attachments (imeta) tests
 */
import { describe, test, expect } from "bun:test"
import { buildImetaTag, parseImetaTag, extractContentImetas } from "./nip92.js"

describe("NIP-92 imeta helpers", () => {
  test("builds imeta tag with all fields", () => {
    const tag = buildImetaTag({
      url: "https://nostr.build/i/pic.jpg",
      mime: "image/jpeg",
      blurhash: "eVF$..",
      dim: { width: 640, height: 480 },
      alt: "A picture",
      x: "aa".repeat(32),
      fallback: ["https://alt1", "https://alt2"],
      extra: { author: "me" },
    })

    expect(tag[0]).toBe("imeta")
    expect(tag).toContain("url https://nostr.build/i/pic.jpg")
    expect(tag).toContain("m image/jpeg")
    expect(tag).toContain("blurhash eVF$..")
    expect(tag).toContain("dim 640x480")
    expect(tag).toContain("alt A picture")
    expect(tag).toContain(`x ${"aa".repeat(32)}`)
    expect(tag).toContain("fallback https://alt1")
    expect(tag).toContain("fallback https://alt2")
    expect(tag).toContain("author me")
  })

  test("parses imeta tag back to fields", () => {
    const tag = [
      "imeta",
      "url https://nostr.build/i/pic.jpg",
      "m image/jpeg",
      "blurhash eVF$..",
      "dim 640x480",
      "alt A picture",
      `x ${"aa".repeat(32)}`,
      "fallback https://alt1",
      "author me",
    ]

    const parsed = parseImetaTag(tag)!
    expect(parsed.url).toBe("https://nostr.build/i/pic.jpg")
    expect(parsed.mime).toBe("image/jpeg")
    expect(parsed.blurhash).toBe("eVF$..")
    expect(parsed.dim?.width).toBe(640)
    expect(parsed.dim?.height).toBe(480)
    expect(parsed.alt).toBe("A picture")
    expect(parsed.x?.length).toBe(64)
    expect(parsed.fallback).toEqual(["https://alt1"])
    expect(parsed.extras.author).toBe("me")
  })

  test("extracts only imetas whose URLs are present in content", () => {
    const content = "Hello https://nostr.build/i/p1.jpg and https://nostr.build/i/p2.jpg"
    const tags = [
      ["imeta", "url https://nostr.build/i/p1.jpg", "m image/jpeg"],
      ["imeta", "url https://nostr.build/i/p2.jpg", "m image/jpeg"],
      ["imeta", "url https://nostr.build/i/other.jpg", "m image/jpeg"],
    ] as string[][]

    const matches = extractContentImetas({ content, tags } as any)
    expect(matches.length).toBe(2)
    expect(matches.map((m) => m.url).sort()).toEqual([
      "https://nostr.build/i/p1.jpg",
      "https://nostr.build/i/p2.jpg",
    ])
  })
})

