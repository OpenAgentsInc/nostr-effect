/**
 * Tests for NIP-22 Comment (kind 1111)
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import { signCommentEvent, CommentKind, buildCommentEvent } from "./nip22.js"

describe("NIP-22 Comment (kind 1111)", () => {
  test("build/sign comment on NIP-23 blog post (A + a + e + K/k + P/p)", () => {
    const sk = generateSecretKey()
    const pk = "3c9849383bdea883b0bd16fece1ed36d37e37cdde3ce43b17ea4e9192ec11289"
    const addr = "30023:3c9849383bdea883b0bd16fece1ed36d37e37cdde3ce43b17ea4e9192ec11289:f9347ca7"
    const parentId = "5b4fc7fed15672fefe65d2426f67197b71ccc82aa0cc8a9e94f683eb78e07651"

    const evt = signCommentEvent({
      content: "Great blog post!",
      root: { type: "A", value: addr, relay: "wss://example.relay" },
      parent: { type: "a", value: addr, relay: "wss://example.relay" },
      rootKind: 30023,
      parentKind: 30023,
      rootAuthor: { pubkey: pk, relay: "wss://example.relay" },
      parentAuthor: { pubkey: pk, relay: "wss://example.relay" },
      // Also include an 'e' tag for the parent concrete id
      extraTags: [["e", parentId, "wss://example.relay"]],
    }, sk)

    expect(evt.kind).toBe(CommentKind)
    expect(verifyEvent(evt)).toBe(true)

    // Root tags
    const A = evt.tags.find((t) => t[0] === "A")!
    const K = evt.tags.find((t) => t[0] === "K")!
    const P = evt.tags.find((t) => t[0] === "P")!
    expect(A[1]).toBe(addr)
    expect(A[2]).toBe("wss://example.relay")
    expect(K[1]).toBe("30023")
    expect(P[1]).toBe(pk)

    // Parent tags
    const a = evt.tags.find((t) => t[0] === "a")!
    const k = evt.tags.find((t) => t[0] === "k")!
    const p = evt.tags.find((t) => t[0] === "p")!
    expect(a[1]).toBe(addr)
    expect(k[1]).toBe("30023")
    expect(p[1]).toBe(pk)

    // Extra 'e' parent id helper
    const e = evt.tags.find((t) => t[0] === "e")!
    expect(e[1]).toBe(parentId)
  })

  test("comment on NIP-94 file (E + e + K/k + P/p)", () => {
    const sk = generateSecretKey()
    const rootId = "768ac8720cdeb59227cf95e98b66560ef03d8bc9a90d721779e76e68fb42f5e6"
    const rootPk = "3721e07b079525289877c366ccab47112bdff3d1b44758ca333feb2dbbbbe5bb"

    const tmpl = buildCommentEvent({
      content: "Great file!",
      root: { type: "E", value: rootId, relay: "wss://example.relay", pubkey: rootPk },
      parent: { type: "e", value: rootId, relay: "wss://example.relay", pubkey: rootPk },
      rootKind: 1063,
      parentKind: 1063,
      rootAuthor: { pubkey: rootPk },
      parentAuthor: { pubkey: rootPk },
    })

    expect(tmpl.kind).toBe(CommentKind)
    // ensure tag layout
    const E = tmpl.tags.find((t) => t[0] === "E")!
    const e = tmpl.tags.find((t) => t[0] === "e")!
    const K = tmpl.tags.find((t) => t[0] === "K")!
    const k = tmpl.tags.find((t) => t[0] === "k")!
    const P = tmpl.tags.find((t) => t[0] === "P")!
    const p = tmpl.tags.find((t) => t[0] === "p")!
    expect(E[1]).toBe(rootId)
    expect(E[2]).toBe("wss://example.relay")
    expect(E[3]).toBe(rootPk)
    expect(e[1]).toBe(rootId)
    expect(e[3]).toBe(rootPk)
    expect(K[1]).toBe("1063")
    expect(k[1]).toBe("1063")
    expect(P[1]).toBe(rootPk)
    expect(p[1]).toBe(rootPk)

    const evt = finalizeAndVerify(tmpl, sk)
    expect(evt.kind).toBe(CommentKind)
    expect(verifyEvent(evt)).toBe(true)
  })
})

function finalizeAndVerify(t: ReturnType<typeof buildCommentEvent>, sk: Uint8Array) {
  const { finalizeEvent, verifyEvent } = require("./pure.js")
  const evt = finalizeEvent(t, sk)
  expect(verifyEvent(evt)).toBe(true)
  return evt
}

