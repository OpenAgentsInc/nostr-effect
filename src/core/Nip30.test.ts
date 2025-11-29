/**
 * NIP-30: Custom Emoji Tests
 * Tests ported from nostr-tools for 100% parity
 */
import { describe, test, expect } from "bun:test"
import { matchAll, replaceAll } from "./Nip30.js"

describe("NIP-30: Custom Emoji", () => {
  test("matchAll", () => {
    const result = matchAll("Hello :blobcat: :disputed: ::joy:joy:")

    expect([...result]).toEqual([
      {
        name: "blobcat",
        shortcode: ":blobcat:",
        start: 6,
        end: 15,
      },
      {
        name: "disputed",
        shortcode: ":disputed:",
        start: 16,
        end: 26,
      },
    ])
  })

  test("replaceAll", () => {
    const content = "Hello :blobcat: :disputed: ::joy:joy:"

    const result = replaceAll(content, ({ name }) => {
      return `<img src="https://ditto.pub/emoji/${name}.png" />`
    })

    expect(result).toEqual(
      'Hello <img src="https://ditto.pub/emoji/blobcat.png" /> <img src="https://ditto.pub/emoji/disputed.png" /> ::joy:joy:'
    )
  })

  test("should not match emoji at word boundaries", () => {
    const result = [...matchAll("test:emoji:test")]
    expect(result).toHaveLength(0)
  })

  test("should match standalone emoji", () => {
    const result = [...matchAll(":smile:")]
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("smile")
  })
})
