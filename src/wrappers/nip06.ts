/**
 * NIP-06: Key Derivation from Mnemonic Seed Phrase
 *
 * Derives Nostr keys from BIP-39 mnemonic seed phrases.
 *
 * @example
 * ```typescript
 * import { generateSeedWords, privateKeyFromSeedWords, validateWords } from 'nostr-effect/nip06'
 *
 * // Generate new mnemonic
 * const mnemonic = generateSeedWords()
 *
 * // Derive private key
 * const privateKey = privateKeyFromSeedWords(mnemonic)
 *
 * // Validate mnemonic
 * const isValid = validateWords(mnemonic)
 * ```
 */

// Re-export all from core implementation
export {
  privateKeyFromSeedWords,
  accountFromSeedWords,
  extendedKeysFromSeedWords,
  accountFromExtendedKey,
  generateSeedWords,
  validateWords,
  privateKeyToHex,
  DERIVATION_PATH,
  type DerivedAccount,
  type ExtendedKeys,
} from "../core/Nip06.js"
