/**
 * Nip44Service
 *
 * NIP-44 versioned encryption for Nostr.
 * Implements secp256k1 ECDH, HKDF, ChaCha20, HMAC-SHA256, and custom padding.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/44.md
 */
import { Context, Effect, Layer } from "effect"
import { secp256k1 } from "@noble/curves/secp256k1"
import { extract, expand } from "@noble/hashes/hkdf"
import { sha256 } from "@noble/hashes/sha256"
import { hmac } from "@noble/hashes/hmac"
import { chacha20 } from "@noble/ciphers/chacha"
import { randomBytes } from "@noble/hashes/utils"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { CryptoError } from "../core/Errors.js"
import type { PrivateKey, PublicKey } from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

/** Conversation key (32 bytes hex) derived from ECDH + HKDF */
export type ConversationKey = string & { readonly _brand: "ConversationKey" }

/** NIP-44 encrypted payload (base64 encoded) */
export type EncryptedPayload = string & { readonly _brand: "EncryptedPayload" }

// =============================================================================
// Constants
// =============================================================================

const MIN_PLAINTEXT_SIZE = 1
const MAX_PLAINTEXT_SIZE = 65535
const SALT = new TextEncoder().encode("nip44-v2")
const VERSION = 2

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate padded length for a plaintext of given unpadded length
 */
const calcPaddedLen = (unpaddedLen: number): number => {
  if (unpaddedLen <= 32) return 32

  const nextPower = 1 << (Math.floor(Math.log2(unpaddedLen - 1)) + 1)
  const chunk = nextPower <= 256 ? 32 : nextPower / 8

  return chunk * (Math.floor((unpaddedLen - 1) / chunk) + 1)
}

/**
 * Pad plaintext according to NIP-44 spec
 */
const pad = (plaintext: string): Uint8Array => {
  const unpadded = new TextEncoder().encode(plaintext)
  const unpaddedLen = unpadded.length

  if (unpaddedLen < MIN_PLAINTEXT_SIZE || unpaddedLen > MAX_PLAINTEXT_SIZE) {
    throw new Error(
      `Invalid plaintext length: ${unpaddedLen}. Must be between ${MIN_PLAINTEXT_SIZE} and ${MAX_PLAINTEXT_SIZE}`
    )
  }

  const paddedLen = calcPaddedLen(unpaddedLen)
  const padded = new Uint8Array(2 + paddedLen)

  // Write length as big-endian u16
  padded[0] = (unpaddedLen >> 8) & 0xff
  padded[1] = unpaddedLen & 0xff

  // Copy plaintext
  padded.set(unpadded, 2)

  // Rest is already zeros
  return padded
}

/**
 * Unpad plaintext according to NIP-44 spec
 */
const unpad = (padded: Uint8Array): string => {
  if (padded.length < 2) {
    throw new Error("Invalid padded data: too short")
  }

  // Read length as big-endian u16
  const unpaddedLen = (padded[0]! << 8) | padded[1]!

  if (unpaddedLen === 0) {
    throw new Error("Invalid padding: plaintext length is 0")
  }

  if (padded.length < 2 + unpaddedLen) {
    throw new Error("Invalid padding: data too short for declared length")
  }

  const expectedPaddedLen = calcPaddedLen(unpaddedLen)
  if (padded.length !== 2 + expectedPaddedLen) {
    throw new Error(
      `Invalid padding: expected ${2 + expectedPaddedLen} bytes, got ${padded.length}`
    )
  }

  const unpadded = padded.slice(2, 2 + unpaddedLen)
  return new TextDecoder().decode(unpadded)
}

/**
 * Derive message keys from conversation key and nonce
 */
const getMessageKeys = (
  conversationKey: Uint8Array,
  nonce: Uint8Array
): { chachaKey: Uint8Array; chachaNonce: Uint8Array; hmacKey: Uint8Array } => {
  if (conversationKey.length !== 32) {
    throw new Error("Invalid conversation key length")
  }
  if (nonce.length !== 32) {
    throw new Error("Invalid nonce length")
  }

  // HKDF-expand with conversation_key as PRK, nonce as info, L=76
  const keys = expand(sha256, conversationKey, nonce, 76)

  return {
    chachaKey: keys.slice(0, 32),
    chachaNonce: keys.slice(32, 44),
    hmacKey: keys.slice(44, 76),
  }
}

/**
 * Calculate HMAC with AAD (nonce prepended to message)
 */
const hmacAad = (key: Uint8Array, message: Uint8Array, aad: Uint8Array): Uint8Array => {
  if (aad.length !== 32) {
    throw new Error("AAD must be 32 bytes")
  }

  const combined = new Uint8Array(aad.length + message.length)
  combined.set(aad)
  combined.set(message, aad.length)

  return hmac(sha256, key, combined)
}

/**
 * Constant-time comparison of two byte arrays
 */
const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!
  }
  return result === 0
}

/**
 * Decode base64 payload into components
 */
const decodePayload = (
  payload: string
): { nonce: Uint8Array; ciphertext: Uint8Array; mac: Uint8Array } => {
  if (payload.length === 0 || payload[0] === "#") {
    throw new Error("Unknown version or unsupported encoding")
  }

  if (payload.length < 132 || payload.length > 87472) {
    throw new Error(`Invalid payload size: ${payload.length}`)
  }

  // Decode base64
  const data = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))

  if (data.length < 99 || data.length > 65603) {
    throw new Error(`Invalid decoded data size: ${data.length}`)
  }

  const version = data[0]
  if (version !== VERSION) {
    throw new Error(`Unknown version: ${version}`)
  }

  const nonce = data.slice(1, 33)
  const ciphertext = data.slice(33, data.length - 32)
  const mac = data.slice(data.length - 32)

  return { nonce, ciphertext, mac }
}

// =============================================================================
// Service Interface
// =============================================================================

export interface Nip44Service {
  readonly _tag: "Nip44Service"

  /**
   * Calculate conversation key from private key A and public key B.
   * The result is symmetric: conv(a, B) == conv(b, A)
   */
  getConversationKey(
    privateKey: PrivateKey,
    publicKey: PublicKey
  ): Effect.Effect<ConversationKey, CryptoError>

  /**
   * Encrypt plaintext using a conversation key.
   * Generates a random nonce internally.
   */
  encrypt(
    plaintext: string,
    conversationKey: ConversationKey
  ): Effect.Effect<EncryptedPayload, CryptoError>

  /**
   * Encrypt plaintext with a specific nonce (for testing).
   * In production, use encrypt() which generates a secure random nonce.
   */
  encryptWithNonce(
    plaintext: string,
    conversationKey: ConversationKey,
    nonce: Uint8Array
  ): Effect.Effect<EncryptedPayload, CryptoError>

  /**
   * Decrypt a NIP-44 encrypted payload using a conversation key.
   */
  decrypt(
    payload: EncryptedPayload,
    conversationKey: ConversationKey
  ): Effect.Effect<string, CryptoError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const Nip44Service = Context.GenericTag<Nip44Service>("Nip44Service")

// =============================================================================
// Service Implementation
// =============================================================================

const make: Nip44Service = {
  _tag: "Nip44Service",

  getConversationKey: (privateKey, publicKey) =>
    Effect.try({
      try: () => {
        const privKeyBytes = hexToBytes(privateKey)
        // Public key needs to be in compressed format (33 bytes with prefix)
        // But schnorr public keys are x-only (32 bytes)
        // We need to reconstruct the full point
        const pubKeyBytes = hexToBytes(publicKey)

        // For schnorr pubkeys (32 bytes), we need to add the 02 prefix
        // to make it a valid compressed pubkey for ECDH
        let fullPubKey: Uint8Array
        if (pubKeyBytes.length === 32) {
          fullPubKey = new Uint8Array(33)
          fullPubKey[0] = 0x02 // Even y coordinate (standard for schnorr)
          fullPubKey.set(pubKeyBytes, 1)
        } else {
          fullPubKey = pubKeyBytes
        }

        // Perform ECDH: multiply pubkey point by private key scalar
        const sharedPoint = secp256k1.getSharedSecret(privKeyBytes, fullPubKey)

        // Extract x coordinate (first 32 bytes after the prefix byte)
        // getSharedSecret returns uncompressed point (65 bytes: 04 + x + y)
        const sharedX = sharedPoint.slice(1, 33)

        // HKDF-extract with shared_x as IKM and salt
        const conversationKey = extract(sha256, sharedX, SALT)

        return bytesToHex(conversationKey) as ConversationKey
      },
      catch: (error) =>
        new CryptoError({
          message: `Failed to derive conversation key: ${error}`,
          operation: "getConversationKey",
        }),
    }),

  encrypt: (plaintext, conversationKey) =>
    Effect.try({
      try: () => {
        const nonce = randomBytes(32)
        return encryptInternal(plaintext, conversationKey, nonce)
      },
      catch: (error) =>
        new CryptoError({
          message: `Failed to encrypt: ${error}`,
          operation: "encrypt",
        }),
    }),

  encryptWithNonce: (plaintext, conversationKey, nonce) =>
    Effect.try({
      try: () => encryptInternal(plaintext, conversationKey, nonce),
      catch: (error) =>
        new CryptoError({
          message: `Failed to encrypt: ${error}`,
          operation: "encryptWithNonce",
        }),
    }),

  decrypt: (payload, conversationKey) =>
    Effect.try({
      try: () => {
        const { nonce, ciphertext, mac } = decodePayload(payload)
        const convKeyBytes = hexToBytes(conversationKey)

        const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(convKeyBytes, nonce)

        // Verify MAC
        const calculatedMac = hmacAad(hmacKey, ciphertext, nonce)
        if (!constantTimeEqual(calculatedMac, mac)) {
          throw new Error("Invalid MAC")
        }

        // Decrypt
        const paddedPlaintext = chacha20(chachaKey, chachaNonce, ciphertext)

        // Unpad
        return unpad(paddedPlaintext)
      },
      catch: (error) =>
        new CryptoError({
          message: `Failed to decrypt: ${error}`,
          operation: "decrypt",
        }),
    }),
}

/**
 * Internal encryption function used by both encrypt and encryptWithNonce
 */
const encryptInternal = (
  plaintext: string,
  conversationKey: ConversationKey,
  nonce: Uint8Array
): EncryptedPayload => {
  const convKeyBytes = hexToBytes(conversationKey)

  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(convKeyBytes, nonce)

  // Pad plaintext
  const padded = pad(plaintext)

  // Encrypt with ChaCha20
  const ciphertext = chacha20(chachaKey, chachaNonce, padded)

  // Calculate MAC with AAD
  const mac = hmacAad(hmacKey, ciphertext, nonce)

  // Encode: version (1) + nonce (32) + ciphertext + mac (32)
  const result = new Uint8Array(1 + 32 + ciphertext.length + 32)
  result[0] = VERSION
  result.set(nonce, 1)
  result.set(ciphertext, 33)
  result.set(mac, 33 + ciphertext.length)

  // Base64 encode
  return btoa(String.fromCharCode(...result)) as EncryptedPayload
}

// =============================================================================
// Service Layer
// =============================================================================

export const Nip44ServiceLive = Layer.succeed(Nip44Service, make)
