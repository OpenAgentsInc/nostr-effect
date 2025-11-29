/**
 * NIP-04: Encrypted Direct Message (Legacy)
 * https://github.com/nostr-protocol/nips/blob/master/04.md
 *
 * DEPRECATED: Use NIP-17 for private direct messages instead.
 * This implementation is provided for backwards compatibility only.
 *
 * Uses ECDH with secp256k1 + AES-256-CBC encryption.
 */
import { bytesToHex, randomBytes } from "@noble/hashes/utils"
import { secp256k1 } from "@noble/curves/secp256k1"
import { cbc } from "@noble/ciphers/aes"
import { base64 } from "@scure/base"

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Encrypt a message using NIP-04 encryption
 * @param secretKey - The sender's private key (hex string or Uint8Array)
 * @param pubkey - The recipient's public key (hex string, without 02 prefix)
 * @param text - The plaintext message to encrypt
 * @returns Encrypted message in format "ciphertext?iv=ivBase64"
 */
export function encrypt(secretKey: string | Uint8Array, pubkey: string, text: string): string {
  const privkey: string = secretKey instanceof Uint8Array ? bytesToHex(secretKey) : secretKey
  const key = secp256k1.getSharedSecret(privkey, "02" + pubkey)
  const normalizedKey = getNormalizedX(key)

  const iv = Uint8Array.from(randomBytes(16))
  const plaintext = utf8Encoder.encode(text)

  const ciphertext = cbc(normalizedKey, iv).encrypt(plaintext)

  const ctb64 = base64.encode(new Uint8Array(ciphertext))
  const ivb64 = base64.encode(new Uint8Array(iv.buffer))

  return `${ctb64}?iv=${ivb64}`
}

/**
 * Decrypt a NIP-04 encrypted message
 * @param secretKey - The recipient's private key (hex string or Uint8Array)
 * @param pubkey - The sender's public key (hex string, without 02 prefix)
 * @param data - The encrypted message in format "ciphertext?iv=ivBase64"
 * @returns The decrypted plaintext message
 */
export function decrypt(secretKey: string | Uint8Array, pubkey: string, data: string): string {
  const privkey: string = secretKey instanceof Uint8Array ? bytesToHex(secretKey) : secretKey
  const [ctb64, ivb64] = data.split("?iv=")
  if (!ctb64 || !ivb64) {
    throw new Error("Invalid encrypted data format")
  }

  const key = secp256k1.getSharedSecret(privkey, "02" + pubkey)
  const normalizedKey = getNormalizedX(key)

  const iv = base64.decode(ivb64)
  const ciphertext = base64.decode(ctb64)

  const plaintext = cbc(normalizedKey, iv).decrypt(ciphertext)

  return utf8Decoder.decode(plaintext)
}

/**
 * Get the normalized X coordinate from ECDH shared secret
 * Per NIP-04 spec, only the X coordinate (bytes 1-32) is used, not hashed
 */
function getNormalizedX(key: Uint8Array): Uint8Array {
  return key.slice(1, 33)
}
