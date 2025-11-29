/**
 * Tests for NIP-37 Draft Wraps
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import {
  DraftWrapKind,
  PrivateRelaysKind,
  signDraftWrap,
  decryptForAuthor,
  signPrivateRelays,
} from "./nip37.js"

describe("NIP-37 Draft Wraps", () => {
  test("build/sign draft wrap with encrypted content", () => {
    const sk = generateSecretKey()
    const draft = { kind: 1, content: "hello", tags: [] as string[][] }
    const evt = signDraftWrap({ draft, draftKind: 1, identifier: "note-1", expiration: String(Math.floor(Date.now() / 1000) + 777_600) }, sk)
    expect(evt.kind).toBe(DraftWrapKind)
    const k = evt.tags.find((t) => t[0] === "k")
    const d = evt.tags.find((t) => t[0] === "d")
    expect(k?.[1]).toBe("1")
    expect(d?.[1]).toBe("note-1")
    expect(evt.content.length).toBeGreaterThan(0)
    const plaintext = decryptForAuthor(evt.content, sk)
    expect(() => JSON.parse(plaintext)).not.toThrow()
    expect(verifyEvent(evt)).toBe(true)
  })

  test("build/sign private relays list with encrypted content", () => {
    const sk = generateSecretKey()
    const evt = signPrivateRelays({ relays: ["wss://a", "wss://b"] }, sk)
    expect(evt.kind).toBe(PrivateRelaysKind)
    expect(evt.tags.length).toBe(0)
    const tupleJson = decryptForAuthor(evt.content, sk)
    const tuples = JSON.parse(tupleJson) as string[][]
    expect(Array.isArray(tuples)).toBe(true)
    expect(tuples[0]?.[0]).toBe("relay")
    expect(tuples[0]?.[1]).toBe("wss://a")
    expect(verifyEvent(evt)).toBe(true)
  })
})
