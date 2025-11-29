/**
 * Tests for NIP-08 Handling Mentions helpers
 */
import { describe, test, expect } from "bun:test"
import { buildMentionedContent } from "./nip08.js"

describe("NIP-08 Handling Mentions", () => {
  test("build content with p and e mentions", () => {
    const pub = "a".repeat(64)
    const ev = "b".repeat(64)
    const res = buildMentionedContent([
      "Hello ",
      { type: "p", value: pub },
      ", see ",
      { type: "e", value: ev },
      "!",
    ])

    expect(res.content).toBe("Hello #[0], see #[1]!")
    expect(res.tags[0]).toEqual(["p", pub])
    expect(res.tags[1]).toEqual(["e", ev])
  })

  test("indices account for existing base tags", () => {
    const base = [["alt", "context"]]
    const pub = "c".repeat(64)
    const res = buildMentionedContent(["Hi ", { type: "p", value: pub }], base)
    expect(res.content).toBe("Hi #[1]")
    expect(res.tags[0]).toEqual(["alt", "context"]) // base preserved
    expect(res.tags[1]).toEqual(["p", pub])
  })
})

