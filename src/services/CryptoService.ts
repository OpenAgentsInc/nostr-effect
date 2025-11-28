/**
 * CryptoService
 *
 * Schnorr signing, key generation, and hashing for Nostr events.
 * Uses @noble/curves for secp256k1 and @noble/hashes for SHA256.
 */
import { Context, Effect, Layer } from "effect"
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import {
  CryptoError,
  InvalidPrivateKey,
  InvalidPublicKey,
} from "../core/Errors.js"
import type { EventId, PrivateKey, PublicKey, Signature } from "../core/Schema.js"

// =============================================================================
// Service Interface
// =============================================================================

export interface CryptoService {
  readonly _tag: "CryptoService"

  /**
   * Generate a random private key
   */
  generatePrivateKey(): Effect.Effect<PrivateKey, CryptoError>

  /**
   * Derive public key from private key
   */
  getPublicKey(
    privateKey: PrivateKey
  ): Effect.Effect<PublicKey, CryptoError | InvalidPrivateKey>

  /**
   * Sign a message with a private key (Schnorr signature)
   */
  sign(
    message: string,
    privateKey: PrivateKey
  ): Effect.Effect<Signature, CryptoError | InvalidPrivateKey>

  /**
   * Verify a Schnorr signature
   */
  verify(
    signature: Signature,
    message: string,
    publicKey: PublicKey
  ): Effect.Effect<boolean, CryptoError | InvalidPublicKey>

  /**
   * Compute SHA256 hash of a message (for event ID)
   */
  hash(message: string): Effect.Effect<EventId, CryptoError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const CryptoService = Context.GenericTag<CryptoService>("CryptoService")

// =============================================================================
// Service Implementation
// =============================================================================

const make: CryptoService = {
  _tag: "CryptoService",

  generatePrivateKey: () =>
    Effect.try({
      try: () => {
        const privateKeyBytes = schnorr.utils.randomPrivateKey()
        return bytesToHex(privateKeyBytes) as PrivateKey
      },
      catch: (error) =>
        new CryptoError({
          message: `Failed to generate private key: ${error}`,
          operation: "generateKey",
        }),
    }),

  getPublicKey: (privateKey) =>
    Effect.try({
      try: () => {
        const privateKeyBytes = hexToBytes(privateKey)
        const publicKeyBytes = schnorr.getPublicKey(privateKeyBytes)
        return bytesToHex(publicKeyBytes) as PublicKey
      },
      catch: (error) =>
        new InvalidPrivateKey({
          message: `Failed to derive public key: ${error}`,
        }),
    }),

  sign: (message, privateKey) =>
    Effect.try({
      try: () => {
        const messageBytes = hexToBytes(message)
        const privateKeyBytes = hexToBytes(privateKey)
        const signatureBytes = schnorr.sign(messageBytes, privateKeyBytes)
        return bytesToHex(signatureBytes) as Signature
      },
      catch: (error) =>
        new CryptoError({
          message: `Failed to sign message: ${error}`,
          operation: "sign",
        }),
    }),

  verify: (signature, message, publicKey) =>
    Effect.try({
      try: () => {
        const signatureBytes = hexToBytes(signature)
        const messageBytes = hexToBytes(message)
        const publicKeyBytes = hexToBytes(publicKey)
        return schnorr.verify(signatureBytes, messageBytes, publicKeyBytes)
      },
      catch: (error) =>
        new CryptoError({
          message: `Failed to verify signature: ${error}`,
          operation: "verify",
        }),
    }),

  hash: (message) =>
    Effect.try({
      try: () => {
        const messageBytes = new TextEncoder().encode(message)
        const hashBytes = sha256(messageBytes)
        return bytesToHex(hashBytes) as EventId
      },
      catch: (error) =>
        new CryptoError({
          message: `Failed to hash message: ${error}`,
          operation: "hash",
        }),
    }),
}

// =============================================================================
// Service Layer
// =============================================================================

export const CryptoServiceLive = Layer.succeed(CryptoService, make)
