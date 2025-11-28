/**
 * Tests for Nip44Service (NIP-44 encryption)
 */
import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import {
  Nip44Service,
  Nip44ServiceLive,
  type ConversationKey,
  type EncryptedPayload,
} from "./Nip44Service.js"
import { CryptoService, CryptoServiceLive } from "./CryptoService.js"
import type { PrivateKey, PublicKey } from "../core/Schema.js"
import { hexToBytes } from "@noble/hashes/utils"

describe("Nip44Service", () => {
  const makeTestLayers = () => {
    return Layer.merge(CryptoServiceLive, Nip44ServiceLive)
  }

  describe("getConversationKey", () => {
    test("derives conversation key from private and public key", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey1 = yield* crypto.getPublicKey(privateKey1)
        const privateKey2 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(privateKey2)

        // conv(a, B) should equal conv(b, A)
        const convKey1 = yield* nip44.getConversationKey(privateKey1, publicKey2)
        const convKey2 = yield* nip44.getConversationKey(privateKey2, publicKey1)

        expect(convKey1).toBe(convKey2)
        expect(convKey1.length).toBe(64) // 32 bytes = 64 hex chars
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("produces different keys for different key pairs", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const privateKey2 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(privateKey2)
        const privateKey3 = yield* crypto.generatePrivateKey()
        const publicKey3 = yield* crypto.getPublicKey(privateKey3)

        const convKey12 = yield* nip44.getConversationKey(privateKey1, publicKey2)
        const convKey13 = yield* nip44.getConversationKey(privateKey1, publicKey3)

        expect(convKey12).not.toBe(convKey13)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    // Test vector from NIP-44 spec
    test("matches test vector from NIP-44 spec", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service

        // Test vector from nip44.vectors.json
        const sec1 =
          "0000000000000000000000000000000000000000000000000000000000000001" as PrivateKey

        // Derive public keys manually for test vectors
        // pub2 for sec2 = 02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5
        // But schnorr pubkeys are x-only, so just x coordinate
        const pub2 =
          "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5" as PublicKey

        const convKey = yield* nip44.getConversationKey(sec1, pub2)

        // Expected from test vector
        expect(convKey as string).toBe(
          "c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d"
        )
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("encrypt and decrypt", () => {
    test("encrypts and decrypts a message", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const privateKey2 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(privateKey2)

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)

        const plaintext = "Hello, NIP-44!"
        const encrypted = yield* nip44.encrypt(plaintext, convKey)

        // Encrypted payload should be base64
        expect(encrypted.length).toBeGreaterThan(0)

        // Decrypt with same conversation key
        const decrypted = yield* nip44.decrypt(encrypted, convKey)
        expect(decrypted).toBe(plaintext)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("encrypts and decrypts long messages", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)

        // Test with a longer message
        const plaintext = "A".repeat(1000)
        const encrypted = yield* nip44.encrypt(plaintext, convKey)
        const decrypted = yield* nip44.decrypt(encrypted, convKey)

        expect(decrypted).toBe(plaintext)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("encrypts and decrypts unicode messages", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)

        const plaintext = "Hello 🌍! こんにちは 世界!"
        const encrypted = yield* nip44.encrypt(plaintext, convKey)
        const decrypted = yield* nip44.decrypt(encrypted, convKey)

        expect(decrypted).toBe(plaintext)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("produces different ciphertext for same plaintext (random nonce)", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)

        const plaintext = "Same message"
        const encrypted1 = yield* nip44.encrypt(plaintext, convKey)
        const encrypted2 = yield* nip44.encrypt(plaintext, convKey)

        // Different nonces should produce different ciphertexts
        expect(encrypted1).not.toBe(encrypted2)

        // But both should decrypt to the same plaintext
        const decrypted1 = yield* nip44.decrypt(encrypted1, convKey)
        const decrypted2 = yield* nip44.decrypt(encrypted2, convKey)
        expect(decrypted1).toBe(plaintext)
        expect(decrypted2).toBe(plaintext)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    // Test vector from NIP-44 spec
    test("matches test vector from NIP-44 spec", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service

        const convKey =
          "c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d" as ConversationKey
        const nonce = hexToBytes(
          "0000000000000000000000000000000000000000000000000000000000000001"
        )
        const plaintext = "a"
        const expectedPayload =
          "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb"

        const encrypted = yield* nip44.encryptWithNonce(plaintext, convKey, nonce)
        expect(encrypted as string).toBe(expectedPayload)

        const decrypted = yield* nip44.decrypt(encrypted, convKey)
        expect(decrypted).toBe(plaintext)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("decrypt error handling", () => {
    test("fails on invalid MAC", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)
        const encrypted = yield* nip44.encrypt("test message", convKey)

        // Tamper with the payload (change last character)
        const tampered = (encrypted.slice(0, -1) +
          (encrypted.slice(-1) === "A" ? "B" : "A")) as EncryptedPayload

        const result = yield* nip44.decrypt(tampered, convKey).pipe(Effect.either)

        expect(result._tag).toBe("Left")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("fails on wrong conversation key", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())
        const privateKey3 = yield* crypto.generatePrivateKey()
        const publicKey4 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey1 = yield* nip44.getConversationKey(privateKey1, publicKey2)
        const convKey2 = yield* nip44.getConversationKey(privateKey3, publicKey4)

        const encrypted = yield* nip44.encrypt("test message", convKey1)

        // Try to decrypt with wrong key
        const result = yield* nip44.decrypt(encrypted, convKey2).pipe(Effect.either)

        expect(result._tag).toBe("Left")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("fails on empty payload", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)

        const result = yield* nip44
          .decrypt("" as EncryptedPayload, convKey)
          .pipe(Effect.either)

        expect(result._tag).toBe("Left")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("fails on unknown version", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)

        // Payload starting with # indicates unsupported version
        const result = yield* nip44
          .decrypt("#invalid" as unknown as EncryptedPayload, convKey)
          .pipe(Effect.either)

        expect(result._tag).toBe("Left")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("padding", () => {
    test("handles minimum plaintext size (1 byte)", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)

        const plaintext = "a"
        const encrypted = yield* nip44.encrypt(plaintext, convKey)
        const decrypted = yield* nip44.decrypt(encrypted, convKey)

        expect(decrypted).toBe(plaintext)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("handles various message sizes correctly", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        const privateKey1 = yield* crypto.generatePrivateKey()
        const publicKey2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const convKey = yield* nip44.getConversationKey(privateKey1, publicKey2)

        // Test various sizes
        for (const size of [1, 15, 16, 31, 32, 33, 64, 100, 255, 256, 500]) {
          const plaintext = "x".repeat(size)
          const encrypted = yield* nip44.encrypt(plaintext, convKey)
          const decrypted = yield* nip44.decrypt(encrypted, convKey)
          expect(decrypted).toBe(plaintext)
        }
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("bidirectional communication", () => {
    test("allows two parties to encrypt/decrypt to each other", async () => {
      const program = Effect.gen(function* () {
        const nip44 = yield* Nip44Service
        const crypto = yield* CryptoService

        // Alice
        const alicePriv = yield* crypto.generatePrivateKey()
        const alicePub = yield* crypto.getPublicKey(alicePriv)

        // Bob
        const bobPriv = yield* crypto.generatePrivateKey()
        const bobPub = yield* crypto.getPublicKey(bobPriv)

        // Alice derives conversation key using her private and Bob's public
        const aliceConvKey = yield* nip44.getConversationKey(alicePriv, bobPub)

        // Bob derives conversation key using his private and Alice's public
        const bobConvKey = yield* nip44.getConversationKey(bobPriv, alicePub)

        // Both should have the same conversation key
        expect(aliceConvKey).toBe(bobConvKey)

        // Alice encrypts a message
        const aliceMessage = "Hello Bob!"
        const aliceEncrypted = yield* nip44.encrypt(aliceMessage, aliceConvKey)

        // Bob decrypts Alice's message
        const bobDecrypted = yield* nip44.decrypt(aliceEncrypted, bobConvKey)
        expect(bobDecrypted).toBe(aliceMessage)

        // Bob encrypts a reply
        const bobMessage = "Hi Alice!"
        const bobEncrypted = yield* nip44.encrypt(bobMessage, bobConvKey)

        // Alice decrypts Bob's reply
        const aliceDecrypted = yield* nip44.decrypt(bobEncrypted, aliceConvKey)
        expect(aliceDecrypted).toBe(bobMessage)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })
})
