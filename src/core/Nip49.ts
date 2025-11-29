/**
 * NIP-49: Private Key Encryption
 * https://github.com/nostr-protocol/nips/blob/master/49.md
 *
 * Encrypted private key format (ncryptsec)
 */
import { scrypt } from "@noble/hashes/scrypt"
import { xchacha20poly1305 } from "@noble/ciphers/chacha"
import { concatBytes, randomBytes } from "@noble/hashes/utils"
import { bech32 } from "@scure/base"

const BECH32_MAX_SIZE = 5000

/** Key security byte options */
export type KeySecurityByte = 0x00 | 0x01 | 0x02

/**
 * Encrypt a private key with a password
 * @param sec - The 32-byte secret key
 * @param password - The password to encrypt with
 * @param logn - Log2 of the scrypt N parameter (default: 16)
 * @param ksb - Key security byte (default: 0x02)
 * @returns ncryptsec bech32-encoded string
 */
export function encrypt(
  sec: Uint8Array,
  password: string,
  logn: number = 16,
  ksb: KeySecurityByte = 0x02
): string {
  const salt = randomBytes(16)
  const n = 2 ** logn
  const key = scrypt(password.normalize("NFKC"), salt, { N: n, r: 8, p: 1, dkLen: 32 })
  const nonce = randomBytes(24)
  const aad = Uint8Array.from([ksb])
  const xc2p1 = xchacha20poly1305(key, nonce, aad)
  const ciphertext = xc2p1.encrypt(sec)
  const b = concatBytes(
    Uint8Array.from([0x02]),
    Uint8Array.from([logn]),
    salt,
    nonce,
    aad,
    ciphertext
  )
  return encodeBytes("ncryptsec", b)
}

/**
 * Decrypt an ncryptsec-encoded private key
 * @param ncryptsec - The ncryptsec bech32-encoded string
 * @param password - The password to decrypt with
 * @returns The 32-byte secret key
 */
export function decrypt(ncryptsec: string, password: string): Uint8Array {
  const decoded = bech32.decode(ncryptsec as `${string}1${string}`, BECH32_MAX_SIZE)
  if (decoded.prefix !== "ncryptsec") {
    throw new Error(`invalid prefix ${decoded.prefix}, expected 'ncryptsec'`)
  }
  const words = decoded.words
  const b = new Uint8Array(bech32.fromWords(words))

  const version = b[0]
  if (version !== 0x02) {
    throw new Error(`invalid version ${version}, expected 0x02`)
  }

  const logn = b[1]!
  const n = 2 ** logn

  const salt = b.slice(2, 2 + 16)
  const nonce = b.slice(2 + 16, 2 + 16 + 24)
  const ksb = b[2 + 16 + 24]!
  const aad = Uint8Array.from([ksb])
  const ciphertext = b.slice(2 + 16 + 24 + 1)

  const key = scrypt(password.normalize("NFKC"), salt, { N: n, r: 8, p: 1, dkLen: 32 })
  const xc2p1 = xchacha20poly1305(key, nonce, aad)
  const sec = xc2p1.decrypt(ciphertext)

  return sec
}

/**
 * Encode bytes to bech32
 */
function encodeBytes(prefix: string, data: Uint8Array): string {
  const words = bech32.toWords(data)
  return bech32.encode(prefix, words, BECH32_MAX_SIZE)
}
