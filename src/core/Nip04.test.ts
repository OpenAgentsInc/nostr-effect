/**
 * NIP-04: Encrypted Direct Message Tests
 */
import { describe, test, expect } from "bun:test"
import { encrypt, decrypt } from "./Nip04.js"
import { schnorr } from "@noble/curves/secp256k1"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"

// Test keys
const sk1 = "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a"
const sk2 = "c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add"

const pk1 = bytesToHex(schnorr.getPublicKey(sk1))
const pk2 = bytesToHex(schnorr.getPublicKey(sk2))

describe("NIP-04: Encrypted Direct Message", () => {
  describe("encrypt and decrypt", () => {
    test("should encrypt and decrypt a message", () => {
      const plaintext = "hello"
      const ciphertext = encrypt(sk1, pk2, plaintext)
      const decrypted = decrypt(sk2, pk1, ciphertext)
      expect(decrypted).toBe(plaintext)
    })

    test("should work with Uint8Array secret key", () => {
      const plaintext = "hello with bytes"
      const sk1Bytes = hexToBytes(sk1)
      const ciphertext = encrypt(sk1Bytes, pk2, plaintext)
      const decrypted = decrypt(sk2, pk1, ciphertext)
      expect(decrypted).toBe(plaintext)
    })

    test("should handle large payloads", () => {
      // 800 character message
      const longText = "z".repeat(800)
      const ciphertext = encrypt(sk1, pk2, longText)
      const decrypted = decrypt(sk2, pk1, ciphertext)
      expect(decrypted).toBe(longText)
    })

    test("should handle unicode text", () => {
      const unicodeText = "Hello 世界 🌍 emoji test"
      const ciphertext = encrypt(sk1, pk2, unicodeText)
      const decrypted = decrypt(sk2, pk1, ciphertext)
      expect(decrypted).toBe(unicodeText)
    })

    test("should throw on invalid format", () => {
      expect(() => decrypt(sk1, pk2, "invalid-format")).toThrow("Invalid encrypted data format")
    })
  })
})
