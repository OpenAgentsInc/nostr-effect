/**
 * NIP-06: Key Derivation from Mnemonic Seed Phrase
 *
 * Derives Nostr keys from BIP-39 mnemonic seed phrases.
 * Uses BIP-32 HD key derivation with the Nostr-specific derivation path.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/06.md
 */
import { bytesToHex } from "@noble/hashes/utils"
import { wordlist } from "@scure/bip39/wordlists/english"
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39"
import { HDKey } from "@scure/bip32"

// =============================================================================
// Constants
// =============================================================================

/**
 * Nostr-specific BIP-32 derivation path
 * m/44'/1237' where 1237 is the Nostr coin type
 */
export const DERIVATION_PATH = "m/44'/1237'"

// =============================================================================
// Types
// =============================================================================

/** Account derived from seed words */
export interface DerivedAccount {
  /** 32-byte private key */
  readonly privateKey: Uint8Array
  /** 64-character hex public key */
  readonly publicKey: string
}

/** Extended keys from seed words */
export interface ExtendedKeys {
  /** Extended private key (base58) */
  readonly privateExtendedKey: string
  /** Extended public key (base58) */
  readonly publicExtendedKey: string
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Derive a private key from BIP-39 mnemonic seed words
 *
 * @param mnemonic - Space-separated mnemonic words (12, 15, 18, 21, or 24 words)
 * @param passphrase - Optional passphrase for additional security
 * @param accountIndex - Account index for multiple accounts (default: 0)
 * @returns 32-byte private key
 * @throws If private key cannot be derived
 */
export function privateKeyFromSeedWords(
  mnemonic: string,
  passphrase?: string,
  accountIndex = 0
): Uint8Array {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase))
  const privateKey = root.derive(`${DERIVATION_PATH}/${accountIndex}'/0/0`).privateKey

  if (!privateKey) {
    throw new Error("Could not derive private key")
  }

  return privateKey
}

/**
 * Derive a full account (private key + public key) from BIP-39 mnemonic
 *
 * @param mnemonic - Space-separated mnemonic words
 * @param passphrase - Optional passphrase for additional security
 * @param accountIndex - Account index for multiple accounts (default: 0)
 * @returns Account with private and public keys
 * @throws If keys cannot be derived
 */
export function accountFromSeedWords(
  mnemonic: string,
  passphrase?: string,
  accountIndex = 0
): DerivedAccount {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase))
  const seed = root.derive(`${DERIVATION_PATH}/${accountIndex}'/0/0`)

  const privateKey = seed.privateKey
  // PublicKey is 33 bytes (compressed), we need to strip the prefix byte
  const publicKey = seed.publicKey ? bytesToHex(seed.publicKey.slice(1)) : undefined

  if (!privateKey || !publicKey) {
    throw new Error("Could not derive key pair")
  }

  return { privateKey, publicKey }
}

/**
 * Get extended keys (xprv/xpub) from BIP-39 mnemonic
 * Useful for generating multiple accounts from a single seed
 *
 * @param mnemonic - Space-separated mnemonic words
 * @param passphrase - Optional passphrase for additional security
 * @param extendedAccountIndex - Extended account index (default: 0)
 * @returns Extended private and public keys in base58 format
 * @throws If extended keys cannot be derived
 */
export function extendedKeysFromSeedWords(
  mnemonic: string,
  passphrase?: string,
  extendedAccountIndex = 0
): ExtendedKeys {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase))
  const seed = root.derive(`${DERIVATION_PATH}/${extendedAccountIndex}'`)

  const privateExtendedKey = seed.privateExtendedKey
  const publicExtendedKey = seed.publicExtendedKey

  if (!privateExtendedKey || !publicExtendedKey) {
    throw new Error("Could not derive extended key pair")
  }

  return { privateExtendedKey, publicExtendedKey }
}

/**
 * Derive an account from an extended key (xprv or xpub)
 *
 * @param base58key - Extended key in base58 format (xprv... or xpub...)
 * @param accountIndex - Account index (default: 0)
 * @returns Account (private key only if xprv was provided)
 * @throws If keys cannot be derived
 */
export function accountFromExtendedKey(
  base58key: string,
  accountIndex = 0
): { privateKey?: Uint8Array; publicKey: string } {
  const extendedKey = HDKey.fromExtendedKey(base58key)
  const version = base58key.slice(0, 4)
  const child = extendedKey.deriveChild(0).deriveChild(accountIndex)

  const publicKey = child.publicKey ? bytesToHex(child.publicKey.slice(1)) : undefined
  if (!publicKey) {
    throw new Error("Could not derive public key")
  }

  if (version === "xprv") {
    const privateKey = child.privateKey
    if (!privateKey) {
      throw new Error("Could not derive private key")
    }
    return { privateKey, publicKey }
  }

  return { publicKey }
}

/**
 * Generate a new random BIP-39 mnemonic seed phrase
 *
 * @returns 12-word mnemonic phrase
 */
export function generateSeedWords(): string {
  return generateMnemonic(wordlist)
}

/**
 * Validate a BIP-39 mnemonic seed phrase
 *
 * @param words - Space-separated mnemonic words to validate
 * @returns true if valid, false otherwise
 */
export function validateWords(words: string): boolean {
  return validateMnemonic(words, wordlist)
}

/**
 * Get the hex-encoded private key string from a Uint8Array
 */
export function privateKeyToHex(privateKey: Uint8Array): string {
  return bytesToHex(privateKey)
}
