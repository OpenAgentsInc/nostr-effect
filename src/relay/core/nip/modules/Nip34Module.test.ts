import { describe, expect, it } from "bun:test"
import { getAllNips, handlesKind } from "../NipModule.js"
import { DefaultModules, Nip34Module } from "./index.js"

describe("Nip34Module", () => {
  it("covers every NIP-34 forge event kind", () => {
    expect(Nip34Module.id).toBe("nip-34")
    expect(Nip34Module.nips).toEqual([34])
    expect(Nip34Module.kinds).toEqual([
      30617,
      30618,
      1617,
      1618,
      1619,
      1621,
      1111,
      1630,
      1631,
      1632,
      1633,
      10317,
    ])
    for (const kind of Nip34Module.kinds) {
      expect(handlesKind(Nip34Module, kind)).toBe(true)
    }
  })

  it("is enabled by default so NIP-11 advertises NIP-34", () => {
    expect(DefaultModules).toContain(Nip34Module)
    expect(getAllNips(DefaultModules)).toContain(34)
  })
})
