/**
 * NIP-57 Module Tests
 */
import { describe, it, expect } from "bun:test"
import { Nip57Module } from "./Nip57Module.js"
import type { NipModule } from "../NipModule.js"
import { ZAP_REQUEST_KIND, ZAP_RECEIPT_KIND } from "../../../../core/Schema.js"

describe("Nip57Module", () => {
  it("creates module with correct configuration", () => {
    const module = Nip57Module as NipModule

    expect(module.id).toBe("nip-57")
    expect(module.nips).toEqual([57])
    expect(module.description).toBe("Lightning Zaps: zap requests and receipts")
    expect(module.kinds).toEqual([ZAP_REQUEST_KIND, ZAP_RECEIPT_KIND])
    expect(module.policies).toHaveLength(0)
  })
})
