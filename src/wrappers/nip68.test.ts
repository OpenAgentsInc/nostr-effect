/**
 * Tests for NIP-68 Picture-first feeds (kind 20)
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import { buildImetaTag, signPictureEvent, parseImetaTag, AllowedMediaTypes, PictureEventKind } from "./nip68.js"

describe("NIP-68 Picture Events", () => {
  test("build and sign picture event with two images + fallbacks + annotate-user", () => {
    const sk = generateSecretKey()
    const evt = signPictureEvent({
      title: "Costa Rica Trip",
      description: "Scenic shots",
      images: [
        {
          url: "https://nostr.build/i/1.jpg",
          mime: "image/jpeg",
          blurhash: "eAbcd",
          dim: "3024x4032",
          alt: "Overlook",
          sha256: "a".repeat(64),
          fallbacks: ["https://nostrcheck.me/1.jpg", "https://void.cat/1.jpg"],
        },
        {
          url: "https://nostr.build/i/2.jpg",
          mime: "image/jpeg",
          alt: "Beach",
          annotateUsers: [{ pubkey: "b".repeat(64), x: 100, y: 250 }],
        },
      ],
      mediaTypeFilter: "image/jpeg",
      hashtags: ["travel", "beach"],
      location: "Tamarindo, Costa Rica",
      geohash: "dr5r7",
      languages: [{ L: "ISO-639-1" }, { l: "en", L: "ISO-639-1" }],
    }, sk)

    expect(evt.kind).toBe(PictureEventKind)
    const title = evt.tags.find((t) => t[0] === "title")
    expect(title?.[1]).toBe("Costa Rica Trip")
    const imetaTags = evt.tags.filter((t) => t[0] === "imeta")
    expect(imetaTags.length).toBe(2)
    const parsed0 = parseImetaTag(imetaTags[0]!)
    const parsed1 = parseImetaTag(imetaTags[1]!)
    expect(parsed0?.url).toBe("https://nostr.build/i/1.jpg")
    expect(parsed1?.annotateUsers?.[0]?.x).toBe(100)
    const m = evt.tags.find((t) => t[0] === "m")
    expect(m?.[1]).toBe("image/jpeg")
    expect(verifyEvent(evt)).toBe(true)
  })

  test("invalid media type throws", () => {
    expect(() => buildImetaTag({ url: "https://img", mime: "image/xyz" })).toThrow()
    expect(AllowedMediaTypes.has("image/jpeg")).toBe(true)
  })
})
