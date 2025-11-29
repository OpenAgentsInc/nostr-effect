/**
 * Tests for NIP-64 Chess (PGN) notes
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import { ChessKind, signChessEvent, buildChessEvent } from "./nip64.js"

describe("NIP-64 Chess (PGN)", () => {
  test("build/sign minimal PGN note", () => {
    const sk = generateSecretKey()
    const evt = signChessEvent({ content: "1. e4 *" }, sk)
    expect(evt.kind).toBe(ChessKind)
    expect(evt.content).toBe("1. e4 *")
    expect(Array.isArray(evt.tags)).toBe(true)
    expect(verifyEvent(evt)).toBe(true)
  })

  test("build with alt tag description", () => {
    const tmpl = buildChessEvent({
      content: "[White \"Fischer\"]\n[Black \"Spassky\"]\n1. e4 e5 *",
      tags: [["alt", "Fischer vs. Spassky"]],
    })
    expect(tmpl.kind).toBe(ChessKind)
    expect(tmpl.tags.find((t) => t[0] === "alt")?.[1]).toBe("Fischer vs. Spassky")
  })
})

