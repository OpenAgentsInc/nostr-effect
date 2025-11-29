/**
 * NIP-06: Key Derivation from Mnemonic Seed Phrase Tests
 * Tests ported from nostr-tools for 100% parity
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
} from "./Nip06.js"
import { hexToBytes } from "@noble/hashes/utils"

describe("NIP-06: Mnemonic Key Derivation", () => {
  describe("DERIVATION_PATH", () => {
    test("should have correct derivation path", () => {
      expect(DERIVATION_PATH).toBe("m/44'/1237'")
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
    test("should generate 12-word mnemonic", () => {
      const words = generateSeedWords()
      const wordCount = words.split(" ").length
      expect(wordCount).toBe(12)
    })

    test("should generate valid mnemonic", () => {
      const words = generateSeedWords()
      expect(validateWords(words)).toBe(true)
    })

    test("should generate different mnemonics each time", () => {
      const words1 = generateSeedWords()
      const words2 = generateSeedWords()
      expect(words1).not.toBe(words2)
    })
  })

  describe("validateWords", () => {
    test("should validate correct mnemonic", () => {
      expect(validateWords("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong")).toBe(true)
    })

    test("should reject invalid mnemonic", () => {
      expect(validateWords("invalid mnemonic phrase")).toBe(false)
    })
  })

  describe("privateKeyToHex", () => {
    test("should convert private key to hex", () => {
      const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
      const privateKey = privateKeyFromSeedWords(mnemonic)
      const hex = privateKeyToHex(privateKey)
      expect(hex).toBe("c26cf31d8ba425b555ca27d00ca71b5008004f2f662470f8c8131822ec129fe2")
    })
  })
})
