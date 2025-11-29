/**
 * Tests for NIP-56 Reporting (kind 1984)
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, getPublicKey, verifyEvent } from "./pure.js"
import {
  buildProfileReportTemplate,
  buildNoteReportTemplate,
  buildBlobReportTemplate,
  signReport,
} from "./nip56.js"

describe("NIP-56 Reporting", () => {
  test("profile report builds correct tags and verifies", () => {
    const sk = generateSecretKey()
    const target = getPublicKey(generateSecretKey())
    const tmpl = buildProfileReportTemplate({ kind: 1984, pubkey: target, report: "nudity" })
    const evt = signReport(tmpl, sk)
    expect(evt.kind).toBe(1984)
    const p = evt.tags.find((t) => t[0] === "p")
    expect(p?.[1]).toBe(target)
    expect(p?.[2]).toBe("nudity")
    expect(verifyEvent(evt)).toBe(true)
  })

  test("note report includes e + optional p tag", () => {
    const sk = generateSecretKey()
    const eventId = "e".repeat(64)
    const target = getPublicKey(generateSecretKey())
    const tmpl = buildNoteReportTemplate({ kind: 1984, eventId, pubkey: target, report: "illegal" })
    const evt = signReport(tmpl, sk)
    const e = evt.tags.find((t) => t[0] === "e")
    const p = evt.tags.find((t) => t[0] === "p")
    expect(e?.[1]).toBe(eventId)
    expect(e?.[2]).toBe("illegal")
    expect(p?.[1]).toBe(target)
    expect(verifyEvent(evt)).toBe(true)
  })

  test("blob report includes x + e + server tags as applicable", () => {
    const sk = generateSecretKey()
    const blobHash = "a".repeat(64)
    const eventId = "b".repeat(64)
    const server = "https://media.example/file.jpg"
    const tmpl = buildBlobReportTemplate({ kind: 1984, blobHash, eventId, server, report: "malware" })
    const evt = signReport(tmpl, sk)
    const x = evt.tags.find((t) => t[0] === "x")
    const e = evt.tags.find((t) => t[0] === "e")
    const s = evt.tags.find((t) => t[0] === "server")
    expect(x?.[1]).toBe(blobHash)
    expect(x?.[2]).toBe("malware")
    expect(e?.[1]).toBe(eventId)
    expect(e?.[2]).toBe("malware")
    expect(s?.[1]).toBe(server)
    expect(verifyEvent(evt)).toBe(true)
  })
})
