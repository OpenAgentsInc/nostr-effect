/**
 * NIP-20 Module Tests
 */
import { describe, it, expect } from "vite-plus/test"
import { Nip20Module } from "./Nip20Module.js"
import type { NipModule } from "../NipModule.js"

describe("Nip20Module", () => {
  it("creates module with correct configuration", () => {
    const module = Nip20Module as NipModule

    expect(module.id).toBe("nip-20")
    expect(module.nips).toEqual([20])
    expect(module.description).toBe("OK command results (handled at MessageHandler layer).")
    expect(module.kinds).toEqual([])
    expect(module.policies).toHaveLength(0)
  })
})
