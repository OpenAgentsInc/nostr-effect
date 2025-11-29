/**
 * Tests for NIP-17: Private Direct Messages
 */
import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { Nip17Service, Nip17ServiceLive, CHAT_MESSAGE_KIND, FILE_MESSAGE_KIND, DM_INBOX_RELAYS_KIND } from "./Nip17Service.js"
import type { FileMetadata } from "./Nip17Service.js"
import { wrapEvent } from "../core/Nip59.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { makeRelayPool } from "./RelayPool.js"
import type { PublicKey } from "../core/Schema.js"

const TestLayer = Layer.provideMerge(
  Nip17ServiceLive,
  Layer.merge(CryptoServiceLive, makeRelayPool())
)

describe("NIP-17: Private Direct Messages", () => {
  describe("createChatMessage", () => {
    test("creates a basic chat message", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const receivers: PublicKey[] = ["receiver1" as PublicKey, "receiver2" as PublicKey]

        const message = yield* service.createChatMessage("Hello, world!", receivers)

        expect(message.kind).toBe(CHAT_MESSAGE_KIND)
        expect(message.content).toBe("Hello, world!")
        expect(message.tags.length).toBe(2)
        expect(message.tags[0]).toEqual(["p", "receiver1", ""])
        expect(message.tags[1]).toEqual(["p", "receiver2", ""])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("creates a chat message with subject", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const receivers: PublicKey[] = ["receiver1" as PublicKey]

        const message = yield* service.createChatMessage("Party tonight?", receivers, {
          subject: "Weekend Plans",
        })

        expect(message.kind).toBe(CHAT_MESSAGE_KIND)
        expect(message.content).toBe("Party tonight?")
        expect(message.tags).toContainEqual(["subject", "Weekend Plans"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("creates a chat message with reply", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const receivers: PublicKey[] = ["receiver1" as PublicKey]

        const message = yield* service.createChatMessage("Yes, I'm coming!", receivers, {
          replyTo: "event123",
          relayHint: "wss://relay.example.com",
        })

        expect(message.kind).toBe(CHAT_MESSAGE_KIND)
        expect(message.tags).toContainEqual(["e", "event123", "wss://relay.example.com"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("creates a chat message with quotes", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const receivers: PublicKey[] = ["receiver1" as PublicKey]

        const message = yield* service.createChatMessage("Check this out", receivers, {
          quotes: [
            {
              eventId: "quote1",
              relayUrl: "wss://relay.example.com",
              pubkey: "author1",
            },
          ],
        })

        expect(message.kind).toBe(CHAT_MESSAGE_KIND)
        expect(message.tags).toContainEqual(["q", "quote1", "wss://relay.example.com", "author1"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe("createFileMessage", () => {
    test("creates a basic file message", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const receivers: PublicKey[] = ["receiver1" as PublicKey]

        const file: FileMetadata = {
          url: "https://example.com/encrypted-file.bin",
          fileType: "image/jpeg",
          encryptionAlgorithm: "aes-gcm",
          decryptionKey: "key123",
          decryptionNonce: "nonce456",
          hash: "abc123",
        }

        const message = yield* service.createFileMessage(file, receivers)

        expect(message.kind).toBe(FILE_MESSAGE_KIND)
        expect(message.content).toBe("https://example.com/encrypted-file.bin")
        expect(message.tags).toContainEqual(["p", "receiver1", ""])
        expect(message.tags).toContainEqual(["file-type", "image/jpeg"])
        expect(message.tags).toContainEqual(["encryption-algorithm", "aes-gcm"])
        expect(message.tags).toContainEqual(["decryption-key", "key123"])
        expect(message.tags).toContainEqual(["decryption-nonce", "nonce456"])
        expect(message.tags).toContainEqual(["x", "abc123"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("creates a file message with optional metadata", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const receivers: PublicKey[] = ["receiver1" as PublicKey]

        const file: FileMetadata = {
          url: "https://example.com/encrypted-file.bin",
          fileType: "image/jpeg",
          encryptionAlgorithm: "aes-gcm",
          decryptionKey: "key123",
          decryptionNonce: "nonce456",
          hash: "abc123",
          originalHash: "def456",
          size: 1024000,
          dimensions: "1920x1080",
          blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
          thumbnail: "https://example.com/thumb.jpg",
          fallback: ["https://mirror1.com/file", "https://mirror2.com/file"],
        }

        const message = yield* service.createFileMessage(file, receivers)

        expect(message.kind).toBe(FILE_MESSAGE_KIND)
        expect(message.tags).toContainEqual(["ox", "def456"])
        expect(message.tags).toContainEqual(["size", "1024000"])
        expect(message.tags).toContainEqual(["dim", "1920x1080"])
        expect(message.tags).toContainEqual(["blurhash", "LEHV6nWB2yk8pyo0adR*.7kCMdnj"])
        expect(message.tags).toContainEqual(["thumb", "https://example.com/thumb.jpg"])
        expect(message.tags).toContainEqual(["fallback", "https://mirror1.com/file"])
        expect(message.tags).toContainEqual(["fallback", "https://mirror2.com/file"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("creates a file message with subject and reply", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const receivers: PublicKey[] = ["receiver1" as PublicKey]

        const file: FileMetadata = {
          url: "https://example.com/encrypted-file.bin",
          fileType: "application/pdf",
          encryptionAlgorithm: "aes-gcm",
          decryptionKey: "key123",
          decryptionNonce: "nonce456",
          hash: "abc123",
        }

        const message = yield* service.createFileMessage(file, receivers, {
          subject: "Meeting Notes",
          replyTo: "event789",
          relayHint: "wss://relay.example.com",
        })

        expect(message.kind).toBe(FILE_MESSAGE_KIND)
        expect(message.tags).toContainEqual(["subject", "Meeting Notes"])
        expect(message.tags).toContainEqual(["e", "event789", "wss://relay.example.com", "reply"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe("createDMInboxRelays", () => {
    test("creates a DM inbox relays event", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const relays = ["wss://inbox.nostr.wine", "wss://relay.example.com"]

        const event = yield* service.createDMInboxRelays(relays)

        expect(event.kind).toBe(DM_INBOX_RELAYS_KIND)
        expect(event.content).toBe("")
        expect(event.tags.length).toBe(2)
        expect(event.tags).toContainEqual(["relay", "wss://inbox.nostr.wine"])
        expect(event.tags).toContainEqual(["relay", "wss://relay.example.com"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("creates a DM inbox relays event with single relay", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const relays = ["wss://inbox.nostr.wine"]

        const event = yield* service.createDMInboxRelays(relays)

        expect(event.kind).toBe(DM_INBOX_RELAYS_KIND)
        expect(event.tags.length).toBe(1)
        expect(event.tags[0]).toEqual(["relay", "wss://inbox.nostr.wine"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe("encrypted DM roundtrip", () => {
    test("wraps and unwraps a chat message", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const crypto = yield* CryptoService

        // Generate keys
        const senderPrivateKey = yield* crypto.generatePrivateKey()
        const senderPublicKey = yield* crypto.getPublicKey(senderPrivateKey)
        const recipientPrivateKey = yield* crypto.generatePrivateKey()
        const recipientPublicKey = yield* crypto.getPublicKey(recipientPrivateKey)

        // Create chat message
        const message = yield* service.createChatMessage("Hello, private message!", [recipientPublicKey])

        // Wrap the message
        const senderKeyBytes = Uint8Array.from(Buffer.from(senderPrivateKey, "hex"))
        const wrapped = wrapEvent(message, senderKeyBytes, recipientPublicKey)

        // Unwrap the message
        const unwrapped = yield* service.receiveEncryptedDM(wrapped, recipientPrivateKey)

        // Verify the unwrapped content
        expect(unwrapped.kind).toBe(CHAT_MESSAGE_KIND)
        expect(unwrapped.content).toBe("Hello, private message!")
        expect(unwrapped.pubkey).toBe(senderPublicKey)
        expect(unwrapped.tags).toContainEqual(["p", recipientPublicKey, ""])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("wraps and unwraps a file message", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const crypto = yield* CryptoService

        // Generate keys
        const senderPrivateKey = yield* crypto.generatePrivateKey()
        const senderPublicKey = yield* crypto.getPublicKey(senderPrivateKey)
        const recipientPrivateKey = yield* crypto.generatePrivateKey()
        const recipientPublicKey = yield* crypto.getPublicKey(recipientPrivateKey)

        // Create file message
        const file: FileMetadata = {
          url: "https://example.com/secret.jpg",
          fileType: "image/jpeg",
          encryptionAlgorithm: "aes-gcm",
          decryptionKey: "key123",
          decryptionNonce: "nonce456",
          hash: "abc123",
          size: 2048000,
        }

        const message = yield* service.createFileMessage(file, [recipientPublicKey])

        // Wrap the message
        const senderKeyBytes = Uint8Array.from(Buffer.from(senderPrivateKey, "hex"))
        const wrapped = wrapEvent(message, senderKeyBytes, recipientPublicKey)

        // Unwrap the message
        const unwrapped = yield* service.receiveEncryptedDM(wrapped, recipientPrivateKey)

        // Verify the unwrapped content
        expect(unwrapped.kind).toBe(FILE_MESSAGE_KIND)
        expect(unwrapped.content).toBe("https://example.com/secret.jpg")
        expect(unwrapped.pubkey).toBe(senderPublicKey)
        expect(unwrapped.tags).toContainEqual(["file-type", "image/jpeg"])
        expect(unwrapped.tags).toContainEqual(["size", "2048000"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("verifies sender identity from seal", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const crypto = yield* CryptoService

        // Generate keys
        const senderPrivateKey = yield* crypto.generatePrivateKey()
        const senderPublicKey = yield* crypto.getPublicKey(senderPrivateKey)
        const recipientPrivateKey = yield* crypto.generatePrivateKey()
        const recipientPublicKey = yield* crypto.getPublicKey(recipientPrivateKey)

        // Create and wrap message
        const message = yield* service.createChatMessage("Verified message", [recipientPublicKey])
        const senderKeyBytes = Uint8Array.from(Buffer.from(senderPrivateKey, "hex"))
        const wrapped = wrapEvent(message, senderKeyBytes, recipientPublicKey)

        // Unwrap and verify sender
        const unwrapped = yield* service.receiveEncryptedDM(wrapped, recipientPrivateKey)

        // The unwrapped rumor should have the sender's pubkey
        expect(unwrapped.pubkey).toBe(senderPublicKey)

        // The gift wrap itself has a random pubkey (metadata protection)
        expect(wrapped.pubkey).not.toBe(senderPublicKey)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe("metadata protection", () => {
    test("gift wrap has random pubkey", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const crypto = yield* CryptoService

        const senderPrivateKey = yield* crypto.generatePrivateKey()
        const senderPublicKey = yield* crypto.getPublicKey(senderPrivateKey)
        const recipientPrivateKey = yield* crypto.generatePrivateKey()
        const recipientPublicKey = yield* crypto.getPublicKey(recipientPrivateKey)

        const message = yield* service.createChatMessage("Secret message", [recipientPublicKey])
        const senderKeyBytes = Uint8Array.from(Buffer.from(senderPrivateKey, "hex"))

        // Create two wraps of the same message
        const wrap1 = wrapEvent(message, senderKeyBytes, recipientPublicKey)
        const wrap2 = wrapEvent(message, senderKeyBytes, recipientPublicKey)

        // Each wrap should have a different random pubkey
        expect(wrap1.pubkey).not.toBe(wrap2.pubkey)
        expect(wrap1.pubkey).not.toBe(senderPublicKey)
        expect(wrap2.pubkey).not.toBe(senderPublicKey)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    test("timestamps are randomized", async () => {
      const program = Effect.gen(function* () {
        const service = yield* Nip17Service
        const crypto = yield* CryptoService

        const senderPrivateKey = yield* crypto.generatePrivateKey()
        const recipientPrivateKey = yield* crypto.generatePrivateKey()
        const recipientPublicKey = yield* crypto.getPublicKey(recipientPrivateKey)

        const message = yield* service.createChatMessage("Message", [recipientPublicKey])
        const senderKeyBytes = Uint8Array.from(Buffer.from(senderPrivateKey, "hex"))

        const wrapped = wrapEvent(message, senderKeyBytes, recipientPublicKey)

        // Wrapped timestamp should be in the past (up to 2 days)
        const now = Math.floor(Date.now() / 1000)
        const twoDaysAgo = now - 2 * 24 * 60 * 60

        expect(wrapped.created_at).toBeLessThanOrEqual(now)
        expect(wrapped.created_at).toBeGreaterThanOrEqual(twoDaysAgo)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })
})
