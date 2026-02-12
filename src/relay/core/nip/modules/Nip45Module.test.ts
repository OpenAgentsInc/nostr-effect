/**
 * NIP-45 Module Tests
 */
import { describe, it, expect } from "bun:test"
import { Nip45Module } from "./Nip45Module.js"
import type { NipModule } from "../NipModule.js"

describe("Nip45Module", () => {
  it("creates module with correct configuration", () => {
    const module = Nip45Module as NipModule

    expect(module.id).toBe("nip-45")
    expect(module.nips).toEqual([45])
    expect(module.description).toBe("COUNT messages supported (MessageHandler handleCount).")
    expect(module.kinds).toEqual([])
    expect(module.policies).toHaveLength(0)
  })
})
