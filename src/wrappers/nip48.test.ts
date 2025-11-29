import { test, expect, describe } from "bun:test"
import { addProxyTag, getProxyTags } from "./nip48.js"

describe("NIP-48 proxy tags", () => {
  test("add and read proxy tags", () => {
    const tags: string[][] = []
    const t1 = addProxyTag(tags as any, "https://example.com/objects/123", "activitypub")
    const t2 = addProxyTag(t1 as any, "at://did:xyz/app.bsky.feed.post/123", "atproto")
    const event = {
      id: "e".repeat(64),
      pubkey: "a".repeat(64),
      created_at: 1,
      kind: 1,
      content: "",
      tags: t2,
      sig: "f".repeat(128),
    } as any
    const proxies = getProxyTags(event)
    expect(proxies.length).toBe(2)
    expect(proxies[0]?.protocol).toBe("activitypub")
    expect(proxies[1]?.protocol).toBe("atproto")
  })
})

