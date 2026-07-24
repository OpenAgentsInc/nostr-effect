/**
 * NIP-62 Module Tests
 */
import { describe, it, expect } from "vite-plus/test"
import { Nip62Module } from "./Nip62Module.js"
import type { NipModule } from "../NipModule.js"

describe("Nip62Module", () => {
  it("creates module with correct configuration", () => {
    const module = Nip62Module as NipModule

    expect(module.id).toBe("nip-62")
    expect(module.nips).toEqual([62])
    expect(module.description).toBe("Request to Vanish (kind 62). Deletion of older events handled in MessageHandler.")
    expect(module.kinds).toEqual([62])
    expect(module.policies).toHaveLength(0)
  })
})
