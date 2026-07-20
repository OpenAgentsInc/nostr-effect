/**
 * NIP-06: Key Derivation from Mnemonic Seed Phrase Tests
 * Official NIP-06 vectors + nostr-tools parity + OpenAgents #9092 empty-passphrase path
 */
import { describe, test, expect } from "bun:test"
import {
  privateKeyFromSeedWords,
  accountFromSeedWords,
  extendedKeysFromSeedWords,
  accountFromExtendedKey,
  generateSeedWords,
  validateWords,
  privateKeyToHex,
  DERIVATION_PATH,
  NIP06_ACCOUNT_PATH,
  accountPath,
  deriveOpenAgentsLegacyNostrAccount,
  normalizeMnemonic,
} from "./Nip06.js"
import { hexToBytes } from "@noble/hashes/utils"
import { nsecEncodeSync, npubEncodeSync } from "./Nip19.js"

describe("NIP-06: Mnemonic Key Derivation", () => {
  describe("paths", () => {
    test("DERIVATION_PATH is purpose+coin type", () => {
      expect(DERIVATION_PATH).toBe("m/44'/1237'")
    })

    test("NIP06_ACCOUNT_PATH matches OpenAgents / Pylon account 0", () => {
      expect(NIP06_ACCOUNT_PATH).toBe("m/44'/1237'/0'/0/0")
      expect(accountPath(0)).toBe(NIP06_ACCOUNT_PATH)
      expect(accountPath(1)).toBe("m/44'/1237'/1'/0/0")
    })
  })

  describe("official NIP-06 test vectors", () => {
    test("vector 1: leader monkey…", () => {
      const mnemonic =
        "leader monkey parrot ring guide accident before fence cannon height naive bean"
      const privateKey = privateKeyFromSeedWords(mnemonic, "")
      expect(privateKeyToHex(privateKey)).toBe(
        "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a"
      )
      const { publicKey } = accountFromSeedWords(mnemonic, "")
      expect(publicKey).toBe("17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917")
      expect(nsecEncodeSync(privateKey)).toBe(
        "nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp"
      )
      expect(npubEncodeSync(publicKey)).toBe(
        "npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu"
      )
    })

    test("vector 2: what bleak badge… (24 words)", () => {
      const mnemonic =
        "what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade"
      const privateKey = privateKeyFromSeedWords(mnemonic)
      expect(privateKeyToHex(privateKey)).toBe(
        "c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add"
      )
      const { publicKey } = accountFromSeedWords(mnemonic)
      expect(publicKey).toBe("d41b22899549e1f3d335a31002cfd382174006e166d3e658e3a5eecdb6463573")
      expect(nsecEncodeSync(privateKey)).toBe(
        "nsec1c9wh8xy5eqdzln7n5t0ctgxjcrdug73gp5yj0x03gntn67h83twssdfhel"
      )
      expect(npubEncodeSync(publicKey)).toBe(
        "npub16sdj9zv4f8sl85e45vgq9n7nsgt5qphpvmf7vk8r5hhvmdjxx4es8rq74h"
      )
    })
  })

  describe("OpenAgents #9092 empty-passphrase legacy", () => {
    test("deriveOpenAgentsLegacyNostrAccount matches empty passphrase account 0", () => {
      const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
      const a = deriveOpenAgentsLegacyNostrAccount(mnemonic)
      const b = accountFromSeedWords(mnemonic, "", 0)
      expect(a.privateKey).toEqual(b.privateKey)
      expect(a.publicKey).toBe(b.publicKey)
      expect(privateKeyToHex(a.privateKey)).toBe(
        "c26cf31d8ba425b555ca27d00ca71b5008004f2f662470f8c8131822ec129fe2"
      )
    })

    test("undefined passphrase equals empty string (legacy)", () => {
      const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
      const a = privateKeyFromSeedWords(mnemonic)
      const b = privateKeyFromSeedWords(mnemonic, "")
      expect(a).toEqual(b)
    })
  })

  // Test vectors from nostr-tools
  test("generate private key from a mnemonic", () => {
    const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
    const privateKey = privateKeyFromSeedWords(mnemonic)
    expect(privateKey).toEqual(hexToBytes("c26cf31d8ba425b555ca27d00ca71b5008004f2f662470f8c8131822ec129fe2"))
  })

  test("generate private key for account 1 from a mnemonic", () => {
    const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
    const privateKey = privateKeyFromSeedWords(mnemonic, undefined, 1)
    expect(privateKey).toEqual(hexToBytes("b5fc7f229de3fb5c189063e3b3fc6c921d8f4366cff5bd31c6f063493665eb2b"))
  })

  test("generate private key from a mnemonic and passphrase", () => {
    const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
    const passphrase = "123"
    const privateKey = privateKeyFromSeedWords(mnemonic, passphrase)
    expect(privateKey).toEqual(hexToBytes("55a22b8203273d0aaf24c22c8fbe99608e70c524b17265641074281c8b978ae4"))
  })

  test("generate private key for account 1 from a mnemonic and passphrase", () => {
    const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
    const passphrase = "123"
    const privateKey = privateKeyFromSeedWords(mnemonic, passphrase, 1)
    expect(privateKey).toEqual(hexToBytes("2e0f7bd9e3c3ebcdff1a90fb49c913477e7c055eba1a415d571b6a8c714c7135"))
  })

  test("generate private and public key for account 1 from a mnemonic and passphrase", () => {
    const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
    const passphrase = "123"
    const { privateKey, publicKey } = accountFromSeedWords(mnemonic, passphrase, 1)
    expect(privateKey).toEqual(hexToBytes("2e0f7bd9e3c3ebcdff1a90fb49c913477e7c055eba1a415d571b6a8c714c7135"))
    expect(publicKey).toBe("13f55f4f01576570ea342eb7d2b611f9dc78f8dc601aeb512011e4e73b90cf0a")
  })

  test("generate extended keys from mnemonic", () => {
    const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    const passphrase = ""
    const extendedAccountIndex = 0
    const { privateExtendedKey, publicExtendedKey } = extendedKeysFromSeedWords(
      mnemonic,
      passphrase,
      extendedAccountIndex
    )

    expect(privateExtendedKey).toBe(
      "xprv9z78fizET65qsCaRr1MSutTSGk1fcKfSt1sBqmuWShtkjRJJ4WCKcSnha6EmgNzFSsyom3MWtydHyPtJtSLZQUtictVQtM2vkPcguh6TQCH"
    )
    expect(publicExtendedKey).toBe(
      "xpub6D6V5EX8HTe95getx2tTH2QApmrA1nPJFEnneAK813RjcDdSc3WaAF7BRNpTF7o7zXjVm3DD3VMX66jhQ7wLaZ9sS6NzyfiwfzqDZbxvpDN"
    )
  })

  test("generate account from extended private key", () => {
    const xprv =
      "xprv9z78fizET65qsCaRr1MSutTSGk1fcKfSt1sBqmuWShtkjRJJ4WCKcSnha6EmgNzFSsyom3MWtydHyPtJtSLZQUtictVQtM2vkPcguh6TQCH"
    const { privateKey, publicKey } = accountFromExtendedKey(xprv)

    expect(privateKey).toEqual(hexToBytes("5f29af3b9676180290e77a4efad265c4c2ff28a5302461f73597fda26bb25731"))
    expect(publicKey).toBe("e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f")
  })

  test("generate account from extended public key", () => {
    const xpub =
      "xpub6D6V5EX8HTe95getx2tTH2QApmrA1nPJFEnneAK813RjcDdSc3WaAF7BRNpTF7o7zXjVm3DD3VMX66jhQ7wLaZ9sS6NzyfiwfzqDZbxvpDN"
    const { publicKey } = accountFromExtendedKey(xpub)

    expect(publicKey).toBe("e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f")
  })

  describe("generateSeedWords", () => {
    test("should generate 12-word mnemonic by default", () => {
      const words = generateSeedWords()
      expect(words.split(" ").length).toBe(12)
      expect(validateWords(words)).toBe(true)
    })

    test("should generate 24-word mnemonic at 256-bit strength", () => {
      const words = generateSeedWords(256)
      expect(words.split(" ").length).toBe(24)
      expect(validateWords(words)).toBe(true)
    })

    test("should generate different mnemonics each time", () => {
      const words1 = generateSeedWords()
      const words2 = generateSeedWords()
      expect(words1).not.toBe(words2)
    })
  })

  describe("validateWords / normalizeMnemonic", () => {
    test("should validate correct mnemonic", () => {
      expect(validateWords("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong")).toBe(true)
    })

    test("should reject invalid mnemonic", () => {
      expect(validateWords("invalid mnemonic phrase")).toBe(false)
    })

    test("should normalize extra whitespace", () => {
      expect(normalizeMnemonic("  zoo   zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong  ")).toBe(
        "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
      )
      expect(
        validateWords("  zoo   zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong  ")
      ).toBe(true)
    })

    test("rejects invalid mnemonic on derive", () => {
      expect(() => privateKeyFromSeedWords("not a real mnemonic at all")).toThrow(/Invalid BIP-39/)
    })
  })

  test("roundtrip: generate → derive → nsec/npub", () => {
    const mnemonic = generateSeedWords()
    const { privateKey, publicKey } = accountFromSeedWords(mnemonic)
    expect(privateKey.length).toBe(32)
    expect(publicKey).toHaveLength(64)
    expect(nsecEncodeSync(privateKey).startsWith("nsec1")).toBe(true)
    expect(npubEncodeSync(publicKey).startsWith("npub1")).toBe(true)
  })
})
