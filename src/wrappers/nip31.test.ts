import { test, expect, describe } from "bun:test"
import { withAltTag, getAltTag } from "./nip31.js"

describe("NIP-31 alt tag helpers", () => {
  test("withAltTag adds/replaces alt", () => {
    const tags: string[][] = [["p", "abc"]]
    const t1 = withAltTag(tags as any, "Custom Event: Action")
    expect(t1.find((t) => t[0] === "alt")?.[1]).toBe("Custom Event: Action")

    const t2 = withAltTag(t1 as any, "Updated Summary")
    const alts = t2.filter((t) => t[0] === "alt")
    expect(alts.length).toBe(1)
    expect(alts[0]?.[1]).toBe("Updated Summary")
  })

  test("getAltTag returns value or null", () => {
    const event = {
      id: "e".repeat(64),
      pubkey: "a".repeat(64),
      created_at: 123,
      kind: 40000,
      content: "",
      tags: [["alt", "Summary"], ["x", "y"]],
      sig: "f".repeat(128),
    } as any
    expect(getAltTag(event)).toBe("Summary")
    const event2 = { ...event, tags: [["x", "y"]] }
    expect(getAltTag(event2 as any)).toBeNull()
  })
})

