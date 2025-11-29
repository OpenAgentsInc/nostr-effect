/**
 * Tests for NIP-03 OpenTimestamps Attestations
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import { signOpenTimestampsEvent, OpenTimestampsKind } from "./nip03.js"

describe("NIP-03 OpenTimestamps", () => {
  test("build/sign OTS event with e/k and base64 content", () => {
    const sk = generateSecretKey()
    const otsB64 = btoa("dummy-ots-binary")
    const evt = signOpenTimestampsEvent({ targetEventId: "e".repeat(64), targetKind: 1, otsBase64: otsB64, relayHint: "wss://relay" }, sk)
    expect(evt.kind).toBe(OpenTimestampsKind)
    const e = evt.tags.find((t) => t[0] === "e")
    const k = evt.tags.find((t) => t[0] === "k")
    expect(e?.[1]).toBe("e".repeat(64))
    expect(e?.[2]).toBe("wss://relay")
    expect(k?.[1]).toBe("1")
    expect(evt.content).toBe(otsB64)
    expect(verifyEvent(evt)).toBe(true)
  })
})
