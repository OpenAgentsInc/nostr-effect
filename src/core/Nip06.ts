/**
 * NIP-06: Key Derivation from Mnemonic Seed Phrase
 *
 * Derives Nostr keys from BIP-39 mnemonic seed phrases.
 * Uses BIP-32 HD key derivation with the Nostr-specific derivation path.
 *
 * OpenAgents / Pylon historical identity uses account 0 with an **empty** BIP-39
 * passphrase and the full path `m/44'/1237'/0'/0/0` (see OpenAgents issue #9092).
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/06.md
 */
import { bytesToHex } from "@noble/hashes/utils"
import { wordlist } from "@scure/bip39/wordlists/english"
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39"
import { HDKey } from "@scure/bip32"
import { schnorr } from "@noble/curves/secp256k1"

// =============================================================================
// Constants
// =============================================================================

/**
 * Nostr BIP-32 purpose + coin type (SLIP-44 coin type 1237).
 * Full account path is `${DERIVATION_PATH}/<account>'/0/0`.
 */
export const DERIVATION_PATH = "m/44'/1237'"

/**
 * Full hardened path for NIP-06 account 0 (canonical single-key clients).
 * Matches OpenAgents / Pylon `NIP06_DERIVATION_PATH`.
 */
export const NIP06_ACCOUNT_PATH = "m/44'/1237'/0'/0/0"

/** OpenAgents legacy unified profile: empty passphrase + account 0. */
export const OPENAGENTS_LEGACY_IDENTITY_PROFILE = "openagents.legacy_unified_nostr_spark.v1" as const

// =============================================================================
// Types
// =============================================================================

/** Account derived from seed words */
export interface DerivedAccount {
  /** 32-byte private key */
  readonly privateKey: Uint8Array
  /** 64-character hex public key (x-only, no 02/03 prefix) */
  readonly publicKey: string
}

/** Extended keys from seed words */
export interface ExtendedKeys {
  /** Extended private key (base58) */
  readonly privateExtendedKey: string
  /** Extended public key (base58) */
  readonly publicExtendedKey: string
}

export type MnemonicStrength = 128 | 256

// =============================================================================
// Functions
// =============================================================================

/**
 * Normalize mnemonic whitespace (trim + collapse internal spaces).
 */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().split(/\s+/).join(" ")
}

/**
 * Build the full BIP-32 path for a NIP-06 account index.
 */
export function accountPath(accountIndex = 0): string {
  return `${DERIVATION_PATH}/${accountIndex}'/0/0`
}

/**
 * Derive a private key from BIP-39 mnemonic seed words
 *
 * @param mnemonic - Space-separated mnemonic words (12, 15, 18, 21, or 24 words)
 * @param passphrase - BIP-39 passphrase (default empty string — OpenAgents legacy)
 * @param accountIndex - Account index for multiple accounts (default: 0)
 * @returns 32-byte private key
 * @throws If private key cannot be derived or mnemonic is invalid
 */
export function privateKeyFromSeedWords(
  mnemonic: string,
  passphrase: string = "",
  accountIndex = 0
): Uint8Array {
  const words = normalizeMnemonic(mnemonic)
  if (!validateMnemonic(words, wordlist)) {
    throw new Error("Invalid BIP-39 mnemonic")
  }
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(words, passphrase))
  const privateKey = root.derive(accountPath(accountIndex)).privateKey

  if (!privateKey) {
    throw new Error("Could not derive private key")
  }

  return privateKey
}

/**
 * Derive a full account (private key + public key) from BIP-39 mnemonic
 *
 * Public key is the 32-byte x-only Schnorr key (NIP-01), derived via secp256k1.
 *
 * @param mnemonic - Space-separated mnemonic words
 * @param passphrase - BIP-39 passphrase (default empty string)
 * @param accountIndex - Account index for multiple accounts (default: 0)
 * @returns Account with private and public keys
 */
export function accountFromSeedWords(
  mnemonic: string,
  passphrase: string = "",
  accountIndex = 0
): DerivedAccount {
  const privateKey = privateKeyFromSeedWords(mnemonic, passphrase, accountIndex)
  const publicKey = bytesToHex(schnorr.getPublicKey(privateKey))
  return { privateKey, publicKey }
}

/**
 * OpenAgents / Pylon historical identity: account 0, empty passphrase.
 * Path is always `m/44'/1237'/0'/0/0`.
 */
export function deriveOpenAgentsLegacyNostrAccount(mnemonic: string): DerivedAccount {
  return accountFromSeedWords(mnemonic, "", 0)
}

/**
 * Get extended keys (xprv/xpub) from BIP-39 mnemonic
 * Useful for generating multiple accounts from a single seed
 *
 * @param mnemonic - Space-separated mnemonic words
 * @param passphrase - BIP-39 passphrase (default empty string)
 * @param extendedAccountIndex - Extended account index (default: 0)
 * @returns Extended private and public keys in base58 format
 */
export function extendedKeysFromSeedWords(
  mnemonic: string,
  passphrase: string = "",
  extendedAccountIndex = 0
): ExtendedKeys {
  const words = normalizeMnemonic(mnemonic)
  if (!validateMnemonic(words, wordlist)) {
    throw new Error("Invalid BIP-39 mnemonic")
  }
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(words, passphrase))
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
 */
export function accountFromExtendedKey(
  base58key: string,
  accountIndex = 0
): { privateKey?: Uint8Array; publicKey: string } {
  const extendedKey = HDKey.fromExtendedKey(base58key)
  const version = base58key.slice(0, 4)
  const child = extendedKey.deriveChild(0).deriveChild(accountIndex)

  if (version === "xprv") {
    const privateKey = child.privateKey
    if (!privateKey) {
      throw new Error("Could not derive private key")
    }
    return { privateKey, publicKey: bytesToHex(schnorr.getPublicKey(privateKey)) }
  }

  const publicKeyCompressed = child.publicKey
  if (!publicKeyCompressed) {
    throw new Error("Could not derive public key")
  }
  // xpub path: compressed 33-byte key → drop prefix for x-only
  return { publicKey: bytesToHex(publicKeyCompressed.slice(1)) }
}

/**
 * Generate a new random BIP-39 mnemonic seed phrase
 *
 * @param strength - Entropy bits: 128 → 12 words (default), 256 → 24 words
 */
export function generateSeedWords(strength: MnemonicStrength = 128): string {
  return generateMnemonic(wordlist, strength)
}

/**
 * Validate a BIP-39 mnemonic seed phrase (English wordlist)
 */
export function validateWords(words: string): boolean {
  return validateMnemonic(normalizeMnemonic(words), wordlist)
}

/**
 * Get the hex-encoded private key string from a Uint8Array
 */
export function privateKeyToHex(privateKey: Uint8Array): string {
  return bytesToHex(privateKey)
}
