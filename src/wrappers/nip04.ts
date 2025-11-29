/**
 * NIP-04: Encrypted Direct Message (Legacy)
 *
 * DEPRECATED: Use NIP-17/NIP-44 for private direct messages instead.
 * This is provided for backwards compatibility only.
 *
 * @example
 * ```typescript
 * import { encrypt, decrypt } from 'nostr-effect/nip04'
 *
 * // Encrypt a message from Alice to Bob
 * const ciphertext = encrypt(aliceSecretKey, bobPubkey, 'Hello Bob!')
 *
 * // Decrypt the message as Bob
 * const plaintext = decrypt(bobSecretKey, alicePubkey, ciphertext)
 * ```
 */

export { encrypt, decrypt } from "../core/Nip04.js"
