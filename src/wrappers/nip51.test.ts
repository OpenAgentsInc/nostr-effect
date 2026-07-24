/**
 * Tests for NIP-51 pure helpers
 */
import { describe, test, expect } from "vite-plus/test"
import { parsePublicItems, getLatestList } from "./nip51.js"
import type { Event as NostrEvent } from "./pure.js"

const fakeEvent = (opts: {
  tags?: string[][]
  kind?: number
  pubkey?: string
  created_at?: number
  content?: string
}): NostrEvent => ({
  id: "fake",
  sig: "fake",
  kind: opts.kind ?? 10000,
  created_at: opts.created_at ?? 1,
  pubkey: opts.pubkey ?? "author",
  tags: opts.tags ?? [],
  content: opts.content ?? ""
})

describe("NIP-51 Lists (pure)", () => {
  test("parsePublicItems extracts non-d tags", () => {
    const event = fakeEvent({ tags: [["p", "a"], ["r", "b.com"], ["d", "set"], ["e", "evt"]], kind: 10003 })
    const items = parsePublicItems(event)
    expect(items).toEqual([["p", "a"], ["r", "b.com"], ["e", "evt"]])
    expect(items.length).toBe(3)
  })

  test("parsePublicItems ignores malformed tags and d only", () => {
    const event = fakeEvent({ tags: [["d", "set"], ["p"], ["r", "valid"]], kind: 10000 })
    expect(parsePublicItems(event)).toEqual([["r", "valid"]])
  })

  test("parsePublicItems empty or no tags", () => {
    expect(parsePublicItems(fakeEvent({ tags: [] }))).toEqual([])
    expect(parsePublicItems(fakeEvent({ tags: [["d", "set"]] }))).toEqual([])
  })

  test("getLatestList picks max created_at same author/kind", () => {
    const author = "author1"
    const events: NostrEvent[] = [
      fakeEvent({ tags: [["d", "s"]], created_at: 1, pubkey: author, kind: 10003 }),
      fakeEvent({ tags: [["d", "s"]], created_at: 3, pubkey: author, kind: 10003 }),
      fakeEvent({ tags: [], created_at: 4, pubkey: "other", kind: 10003 }),
      fakeEvent({ tags: [["d", "other"]], created_at: 2, pubkey: author, kind: 10003 })
    ]
    const latest = getLatestList(events, author, 10003)
    if (latest === null) throw new Error("expected latest event")
    expect(latest.created_at).toBe(3)
    expect(latest.tags[0]?.[1]).toBe("s")
  })

  test("getLatestList filters by d", () => {
    const events: NostrEvent[] = [
      fakeEvent({ tags: [["d", "s1"]], created_at: 1, kind: 10000, pubkey: "other" }),
      fakeEvent({ tags: [["d", "s2"]], created_at: 2, kind: 10000, pubkey: "author" })
    ]
    const latest = getLatestList(events, "author", 10000, "s1")
    expect(latest).toBeNull() // no match for s1 with author
    // adjust
    const e1 = fakeEvent({ tags: [["d", "s1"]], created_at: 5, pubkey: "author", kind: 10000 })
    const latest2 = getLatestList([e1, ...events], "author", 10000, "s1")
    if (latest2 === null) throw new Error("expected matching event")
    expect(latest2.tags[0]?.[1]).toBe("s1")
  })

  test("getLatestList no matches", () => {
    expect(getLatestList([], "author", 10000)).toBeNull()
    expect(getLatestList([fakeEvent({})], "other", 10000)).toBeNull()
  })
})
