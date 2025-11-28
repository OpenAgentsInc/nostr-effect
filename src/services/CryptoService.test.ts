import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { CryptoService, CryptoServiceLive } from "./CryptoService"

const runWithCrypto = <A, E>(
  effect: Effect.Effect<A, E, CryptoService>
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, CryptoServiceLive))

describe("CryptoService", () => {
  describe("generatePrivateKey", () => {
    test("generates valid 64-char hex private key", async () => {
      const privateKey = await runWithCrypto(
        Effect.flatMap(CryptoService, (s) => s.generatePrivateKey())
      )
      expect(privateKey).toHaveLength(64)
      expect(privateKey).toMatch(/^[a-f0-9]{64}$/)
    })

    test("generates unique keys", async () => {
      const [key1, key2] = await runWithCrypto(
        Effect.all([
          Effect.flatMap(CryptoService, (s) => s.generatePrivateKey()),
          Effect.flatMap(CryptoService, (s) => s.generatePrivateKey()),
        ])
      )
      expect(key1).not.toBe(key2)
    })
  })

  describe("getPublicKey", () => {
    test("derives public key from private key", async () => {
      const publicKey = await runWithCrypto(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const privateKey = yield* crypto.generatePrivateKey()
          return yield* crypto.getPublicKey(privateKey)
        })
      )
      expect(publicKey).toHaveLength(64)
      expect(publicKey).toMatch(/^[a-f0-9]{64}$/)
    })

    test("same private key produces same public key", async () => {
      const [pub1, pub2] = await runWithCrypto(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const privateKey = yield* crypto.generatePrivateKey()
          const pub1 = yield* crypto.getPublicKey(privateKey)
          const pub2 = yield* crypto.getPublicKey(privateKey)
          return [pub1, pub2] as const
        })
      )
      expect(pub1).toBe(pub2)
    })
  })

  describe("sign and verify", () => {
    test("signs message and verifies signature", async () => {
      const isValid = await runWithCrypto(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const privateKey = yield* crypto.generatePrivateKey()
          const publicKey = yield* crypto.getPublicKey(privateKey)

          // Create a test message (hex-encoded hash)
          const message = yield* crypto.hash("test message")
          const signature = yield* crypto.sign(message, privateKey)

          return yield* crypto.verify(signature, message, publicKey)
        })
      )
      expect(isValid).toBe(true)
    })

    test("rejects signature with wrong public key", async () => {
      const isValid = await runWithCrypto(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const privateKey1 = yield* crypto.generatePrivateKey()
          const privateKey2 = yield* crypto.generatePrivateKey()
          const publicKey2 = yield* crypto.getPublicKey(privateKey2)

          const message = yield* crypto.hash("test message")
          const signature = yield* crypto.sign(message, privateKey1)

          // Try to verify with wrong public key
          return yield* crypto.verify(signature, message, publicKey2)
        })
      )
      expect(isValid).toBe(false)
    })

    test("rejects signature with wrong message", async () => {
      const isValid = await runWithCrypto(
        Effect.gen(function* () {
          const crypto = yield* CryptoService
          const privateKey = yield* crypto.generatePrivateKey()
          const publicKey = yield* crypto.getPublicKey(privateKey)

          const message1 = yield* crypto.hash("message 1")
          const message2 = yield* crypto.hash("message 2")
          const signature = yield* crypto.sign(message1, privateKey)

          // Try to verify with wrong message
          return yield* crypto.verify(signature, message2, publicKey)
        })
      )
      expect(isValid).toBe(false)
    })
  })

  describe("hash", () => {
    test("produces 64-char hex hash", async () => {
      const hash = await runWithCrypto(
        Effect.flatMap(CryptoService, (s) => s.hash("hello world"))
      )
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    test("same input produces same hash", async () => {
      const [hash1, hash2] = await runWithCrypto(
        Effect.all([
          Effect.flatMap(CryptoService, (s) => s.hash("test")),
          Effect.flatMap(CryptoService, (s) => s.hash("test")),
        ])
      )
      expect(hash1).toBe(hash2)
    })

    test("different input produces different hash", async () => {
      const [hash1, hash2] = await runWithCrypto(
        Effect.all([
          Effect.flatMap(CryptoService, (s) => s.hash("hello")),
          Effect.flatMap(CryptoService, (s) => s.hash("world")),
        ])
      )
      expect(hash1).not.toBe(hash2)
    })
  })
})
