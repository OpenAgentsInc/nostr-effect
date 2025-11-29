import { test, expect, describe } from "bun:test"
import { withContentWarning, getContentWarningReason, withContentWarningLabels } from "./nip36.js"

describe("NIP-36 content warning helpers", () => {
  test("withContentWarning adds/replaces content-warning tag", () => {
    const tags: string[][] = [["t", "yak"]]
    const t1 = withContentWarning(tags as any)
    expect(t1.find((t) => t[0] === "content-warning")?.length).toBe(1)
    const t2 = withContentWarning(t1 as any, "nsfw")
    const cw = t2.find((t) => t[0] === "content-warning")
    expect(cw?.[1]).toBe("nsfw")
  })

  test("getContentWarningReason handles none/empty/reason", () => {
    const base = {
      id: "e".repeat(64),
      pubkey: "a".repeat(64),
      created_at: 1,
      kind: 1,
      content: "",
      sig: "f".repeat(128),
    } as any
    const evNone = { ...base, tags: [["t", "yak"]] }
    expect(getContentWarningReason(evNone)).toBeNull()
    const evEmpty = { ...base, tags: [["content-warning"]] }
    expect(getContentWarningReason(evEmpty)).toBe("")
    const evReason = { ...base, tags: [["content-warning", "nsfw"]] }
    expect(getContentWarningReason(evReason)).toBe("nsfw")
  })

  test("withContentWarningLabels adds L and l tags for content-warning namespace", () => {
    const tags: string[][] = []
    const t1 = withContentWarningLabels(tags as any, ["NS-nud", "NS-viol"])
    expect(t1.find((t) => t[0] === "L" && t[1] === "content-warning")).toBeTruthy()
    const ls = t1.filter((t) => t[0] === "l")
    expect(ls.map((t) => t[1])).toEqual(["NS-nud", "NS-viol"])
    expect(ls.every((t) => t[2] === "content-warning")).toBe(true)
  })
})

