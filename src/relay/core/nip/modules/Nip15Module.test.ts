/**
 * NIP-15 Module Tests
 */
import { describe, it, expect } from "bun:test"
import { Nip15Module } from "./Nip15Module.js"
import type { NipModule } from "../NipModule.js"

describe("Nip15Module", () => {
  it("creates module with correct configuration", () => {
    const module = Nip15Module as NipModule

    expect(module.id).toBe("nip-15")
    expect(module.nips).toEqual([15])
    expect(module.description).toBe("Marketplace kinds (30017/30018/30019/30020) and bid kinds (1021/1022).")
    expect(module.kinds).toEqual([30017, 30018, 30019, 30020, 1021, 1022])
    expect(module.policies).toHaveLength(0)
  })
})
