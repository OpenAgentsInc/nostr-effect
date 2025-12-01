/**
 * Tests for NIP-84 Highlights
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import { signHighlight } from "./nip84.js"

describe("NIP-84 Highlights", () => {
  test("build and sign highlight with e + r + labels", () => {
    const sk = generateSecretKey()
    const evt = signHighlight({ eventId: "e".repeat(64), url: "https://example.com", labels: ["fav", "quote"], content: "nice" }, sk)
    expect(evt.kind).toBe(9802)
    const e = evt.tags.find((t) => t[0] === "e")
    const r = evt.tags.find((t) => t[0] === "r")
    const l = evt.tags.filter((t) => t[0] === "l").map((t) => t[1])
    expect(e?.[1]).toBe("e".repeat(64))
    expect(r?.[1]).toBe("https://example.com")
    expect(l).toEqual(["fav", "quote"])
    expect(verifyEvent(evt)).toBe(true)
  })

  test("highlight without references keeps tags empty and respects created_at override", () => {
    const sk = generateSecretKey()
    const createdAt = 1_700_000_000
    const evt = signHighlight({ content: "context-only", created_at: createdAt, labels: [] }, sk)
    expect(evt.tags.length).toBe(0)
    expect(evt.content).toBe("context-only")
    expect(evt.created_at).toBe(createdAt)
    expect(verifyEvent(evt)).toBe(true)
  })

  test("highlight defaults created_at near now when not provided", () => {
    const sk = generateSecretKey()
    const before = Math.floor(Date.now() / 1000)
    const evt = signHighlight({ eventId: "f".repeat(64) }, sk)
    const after = Math.floor(Date.now() / 1000)
    const e = evt.tags.find((t) => t[0] === "e")
    expect(e?.[1]).toBe("f".repeat(64))
    expect(evt.created_at).toBeGreaterThanOrEqual(before)
    expect(evt.created_at).toBeLessThanOrEqual(after)
    expect(verifyEvent(evt)).toBe(true)
  })

  test("highlight with only URL reference defaults empty content", () => {
    const sk = generateSecretKey()
    const evt = signHighlight({ url: "https://example.org/article" }, sk)
    const r = evt.tags.find((t) => t[0] === "r")
    const e = evt.tags.find((t) => t[0] === "e")
    expect(r?.[1]).toBe("https://example.org/article")
    expect(e).toBeUndefined()
    expect(evt.content).toBe("")
    expect(verifyEvent(evt)).toBe(true)
  })
})
