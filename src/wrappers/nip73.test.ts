/**
 * Tests for NIP-73 External Content IDs
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import { buildIAndKTags, signExternalIdEvent } from "./nip73.js"

describe("NIP-73 External Content IDs", () => {
  test("web URL normalization + k=web", () => {
    const sk = generateSecretKey()
    const evt = signExternalIdEvent({
      kind: 1,
      content: "webref",
      externals: [{ k: "web", i: "https://example.com/path#frag" }],
    }, sk)
    const itag = evt.tags.find((t) => t[0] === "i")
    const ktag = evt.tags.find((t) => t[0] === "k")
    expect(itag?.[1]).toBe("https://example.com/path")
    expect(ktag?.[1]).toBe("web")
    expect(verifyEvent(evt)).toBe(true)
  })

  test("isbn + podcast guids + hashtag + blockchain", () => {
    const sk = generateSecretKey()
    const evt = signExternalIdEvent({
      kind: 1,
      externals: [
        { k: "isbn", i: "isbn:9780765382030" },
        { k: "podcast:guid", i: "podcast:guid:c90e609a-df1e-596a-bd5e-57bcc8aad6cc", urlHint: "https://podcastindex.org/podcast/c90e..." },
        { k: "#", i: "#nostr" },
        { k: "bitcoin:tx", i: "bitcoin:tx:a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d" },
        { k: "ethereum:address", i: "ethereum:1:address:0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
      ],
    }, sk)
    const tags = evt.tags
    const iVals = tags.filter((t) => t[0] === "i").map((t) => t[1])
    const kVals = tags.filter((t) => t[0] === "k").map((t) => t[1])
    expect(iVals).toContain("isbn:9780765382030")
    expect(kVals).toContain("isbn")
    expect(iVals.find((x) => x?.startsWith("podcast:guid:"))).toBeTruthy()
    expect(kVals).toContain("podcast:guid")
    expect(iVals).toContain("#nostr")
    expect(kVals).toContain("#")
    expect(kVals).toContain("bitcoin:tx")
    expect(kVals).toContain("ethereum:address")
    expect(verifyEvent(evt)).toBe(true)
  })

  test("i tag may include url hint as second arg", () => {
    const pair = buildIAndKTags({ k: "isan", i: "isan:0000-0000-401A-0000", urlHint: "https://www.imdb.com/title/tt0120737" })
    const it = pair[0]!
    const kt = pair[1]!
    expect(it[0]).toBe("i")
    expect(it[2]).toBe("https://www.imdb.com/title/tt0120737")
    expect(kt[0]).toBe("k")
    expect(kt[1]).toBe("isan")
  })
})
