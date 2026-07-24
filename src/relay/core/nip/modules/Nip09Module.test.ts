/**
 * NIP-09 Module Tests
 *
 * Event Deletion (kind 5)
 */
import { describe, it, expect } from "vite-plus/test"
import { Nip09Module } from "./Nip09Module.js"

describe("Nip09Module", () => {
  it("configures NIP-09 deletion support", () => {
    expect(Nip09Module.id).toBe("nip-09")
    expect(Nip09Module.nips).toContain(9)
    expect(Nip09Module.description).toContain("Deletion")
    expect(Nip09Module.kinds).toContain(5)
    expect(Nip09Module.policies).toHaveLength(0)
  })
})
