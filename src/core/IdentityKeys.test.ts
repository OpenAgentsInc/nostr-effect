/**
 * IdentityKeys tests — OpenAgents #9092 Phase B
 * Uses only fixture mnemonics (never live secrets).
 */
import { describe, test, expect } from "bun:test"
import { IdentityKeys } from "./IdentityKeys.js"
import {
  OPENAGENTS_LEGACY_IDENTITY_PROFILE,
  NIP06_ACCOUNT_PATH,
  privateKeyToHex,
} from "./Nip06.js"
import { verifyEvent } from "../wrappers/pure.js"

const FIXTURE = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
const FIXTURE_PK_HEX = "c26cf31d8ba425b555ca27d00ca71b5008004f2f662470f8c8131822ec129fe2"

describe("IdentityKeys", () => {
  test("fromOpenAgentsLegacyMnemonic matches known zoo vector", () => {
    const id = IdentityKeys.fromOpenAgentsLegacyMnemonic(FIXTURE)
    expect(id.accountPath).toBe(NIP06_ACCOUNT_PATH)
    expect(id.profileId).toBe(OPENAGENTS_LEGACY_IDENTITY_PROFILE)
    expect(privateKeyToHex(id.exportPrivateKeyBytes())).toBe(FIXTURE_PK_HEX)
    expect(id.npub.startsWith("npub1")).toBe(true)
    expect(id.publicKey).toHaveLength(64)
  })

  test("fromMnemonic defaults empty passphrase account 0", () => {
    const a = IdentityKeys.fromMnemonic(FIXTURE)
    const b = IdentityKeys.fromOpenAgentsLegacyMnemonic(FIXTURE)
    expect(a.publicKey).toBe(b.publicKey)
    expect(a.accountPath).toBe("m/44'/1237'/0'/0/0")
  })

  test("asSigner signs without exposing private key on the port", async () => {
    const id = IdentityKeys.fromOpenAgentsLegacyMnemonic(FIXTURE)
    const signer = id.asSigner()
    const event = await signer.signEvent({
      kind: 1,
      content: "from identity",
      tags: [],
    })
    expect(verifyEvent(event)).toBe(true)
    expect(event.pubkey).toBe(id.publicKey)
    // Port surface: no export methods
    expect("exportPrivateKeyBytes" in signer).toBe(false)
    expect("exportNsec" in signer).toBe(false)
  })

  test("public manifest is JSON-safe without secrets", () => {
    const id = IdentityKeys.fromOpenAgentsLegacyMnemonic(FIXTURE)
    const json = JSON.stringify(id)
    expect(json).toContain(id.npub)
    expect(json).toContain(id.publicKey)
    expect(json).not.toContain(FIXTURE_PK_HEX)
    expect(json).not.toContain("zoo")
  })

  test("generate creates valid identity + one-time mnemonic", () => {
    const { mnemonic, identity } = IdentityKeys.generate()
    expect(mnemonic.split(" ").length).toBe(12)
    const again = IdentityKeys.fromMnemonic(mnemonic)
    expect(again.publicKey).toBe(identity.publicKey)
  })

  test("generate 24-word", () => {
    const { mnemonic, identity } = IdentityKeys.generate({ strength: 256 })
    expect(mnemonic.split(" ").length).toBe(24)
    expect(identity.publicKey).toHaveLength(64)
  })

  test("exportNsec starts with nsec1", () => {
    const id = IdentityKeys.fromOpenAgentsLegacyMnemonic(FIXTURE)
    expect(id.exportNsec().startsWith("nsec1")).toBe(true)
  })

  test("dispose blocks signer", async () => {
    const id = IdentityKeys.fromOpenAgentsLegacyMnemonic(FIXTURE)
    id.dispose()
    await expect(id.asSigner().getPublicKey()).rejects.toThrow(/disposed/)
  })

  test("rejects invalid mnemonic", () => {
    expect(() => IdentityKeys.fromMnemonic("not valid words")).toThrow(/invalid BIP-39/i)
  })

  test("account index 1 differs", () => {
    const a0 = IdentityKeys.fromMnemonic(FIXTURE, { accountIndex: 0 })
    const a1 = IdentityKeys.fromMnemonic(FIXTURE, { accountIndex: 1 })
    expect(a0.publicKey).not.toBe(a1.publicKey)
    expect(a1.accountPath).toBe("m/44'/1237'/1'/0/0")
  })
})
