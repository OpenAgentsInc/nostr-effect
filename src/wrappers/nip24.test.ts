/**
 * NIP-24: Extra metadata fields and tags
 */
import { describe, test, expect } from "bun:test"
import {
  stringifyMetadata,
  normalizeMetadata,
  withUrlTag,
  withExternalIdTag,
  withTitleTag,
  withHashtags,
} from "./nip24.js"

describe("NIP-24 metadata helpers", () => {
  test("stringifyMetadata includes extra fields and stable ordering", () => {
    const json = stringifyMetadata({
      name: "alice",
      display_name: "Alice A.",
      website: "https://alice.example",
      banner: "https://img/banner.jpg",
      bot: false,
      birthday: { year: 1990, month: 5 },
      about: "hello",
    })
    const obj = JSON.parse(json)
    expect(obj.name).toBe("alice")
    expect(obj.display_name).toBe("Alice A.")
    expect(obj.website).toBe("https://alice.example")
    expect(obj.banner).toBe("https://img/banner.jpg")
    expect(obj.bot).toBe(false)
    expect(obj.birthday.year).toBe(1990)
    expect(obj.birthday.month).toBe(5)
    expect(obj.about).toBe("hello")
  })

  test("normalizeMetadata maps deprecated fields", () => {
    const out = normalizeMetadata({ username: "bob", displayName: "Bobby" })
    expect(out.name).toBe("bob")
    expect(out.display_name).toBe("Bobby")
    expect((out as any).username).toBeUndefined()
    expect((out as any).displayName).toBeUndefined()
  })

  test("stringifyMetadata preserves core order and keeps extra fields", () => {
    const json = stringifyMetadata({
      website: "https://example",
      picture: "https://img/p.png",
      name: "alice",
      display_name: "Alice",
      banner: "https://img/b.png",
      about: "hi",
      // extra fields should be preserved but sorted
      zzz_extra: "z",
      aaa_extra: "a",
    })
    const obj = JSON.parse(json)
    const keys = Object.keys(obj)
    // Core fields should come first in the defined order
    const core = ["name","about","picture","display_name","website","banner","bot","birthday"].filter((k)=>k in obj)
    expect(keys.slice(0, core.length)).toEqual(core)
    expect(obj.aaa_extra).toBe("a")
    expect(obj.zzz_extra).toBe("z")
  })
})

describe("NIP-24 tag helpers", () => {
  test("withUrlTag/withExternalIdTag/withTitleTag add tags", () => {
    let tags: string[][] = []
    tags = withUrlTag(tags, "https://example")
    tags = withExternalIdTag(tags, "ext-1")
    tags = withTitleTag(tags, "My Set")
    expect(tags).toContainEqual(["r", "https://example"])
    expect(tags).toContainEqual(["i", "ext-1"])
    expect(tags).toContainEqual(["title", "My Set"])
  })

  test("withHashtags lowercases and deduplicates", () => {
    let tags: string[][] = [["t", "news"], ["t", "tech"]]
    tags = withHashtags(tags, ["Tech", "Gossip", "news"]) // "news" already exists
    expect(tags).toContainEqual(["t", "tech"]) // original
    expect(tags).toContainEqual(["t", "gossip"]) // added lowercased
    // ensure no duplicate for "tech"
    const techCount = tags.filter((t) => t[0] === "t" && t[1] === "tech").length
    expect(techCount).toBe(1)
  })
})
