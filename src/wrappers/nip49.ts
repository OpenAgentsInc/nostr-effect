/**
 * NIP-49: Private Key Encryption
 *
 * Encrypt and decrypt private keys using password-based encryption (ncryptsec format).
 *
 * @example
 * ```typescript
 * import { encrypt, decrypt } from 'nostr-effect/nip49'
 *
 * // Encrypt a private key with a password
 * const ncryptsec = encrypt(privateKey, 'my-password')
 *
 * // Decrypt an ncryptsec
 * const privateKey = decrypt(ncryptsec, 'my-password')
 * ```
 */

// Re-export all from core implementation
export { encrypt, decrypt, type KeySecurityByte } from "../core/Nip49.js"
