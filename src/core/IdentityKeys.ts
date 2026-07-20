/**
 * IdentityKeys — NIP-06 mnemonic → public identity + {@link LocalSignerPort}
 *
 * For OpenAgents #9092 sovereign identity:
 * - Derive Nostr keys from BIP-39 (default empty passphrase, account 0)
 * - Expose public manifest (npub/pubkey) for boot UI / receipts
 * - Hand out a {@link LocalKeySigner} for sign/NIP-44/NIP-98 without leaking the mnemonic
 *
 * **Secrets:** mnemonic is not stored after construction unless you keep the string.
 * Private key lives only inside the signer. Never log mnemonic/nsec/seed.
 */
import {
  accountFromSeedWords,
  accountPath,
  deriveOpenAgentsLegacyNostrAccount,
  generateSeedWords,
  NIP06_ACCOUNT_PATH,
  OPENAGENTS_LEGACY_IDENTITY_PROFILE,
  validateWords,
  type MnemonicStrength,
} from "./Nip06.js"
import { nsecEncodeSync, npubEncodeSync } from "./Nip19.js"
import { LocalKeySigner, type LocalSignerPort, type PublicIdentityManifest } from "./LocalSigner.js"

// =============================================================================
// Types
// =============================================================================

export interface IdentityKeysOptions {
  /** BIP-39 passphrase; default `""` (OpenAgents legacy empty passphrase) */
  readonly passphrase?: string
  /** NIP-06 account index; default `0` */
  readonly accountIndex?: number
  /** Profile label for manifests; default OpenAgents legacy id when path matches */
  readonly profileId?: string
}

export interface GenerateIdentityOptions extends IdentityKeysOptions {
  /** 128 → 12 words (default), 256 → 24 words */
  readonly strength?: MnemonicStrength
}

export interface GeneratedIdentity {
  /** BIP-39 mnemonic — show once for backup; do not log in CI */
  readonly mnemonic: string
  readonly identity: IdentityKeys
}

// =============================================================================
// IdentityKeys
// =============================================================================

/**
 * Public identity + local signer factory derived from NIP-06.
 *
 * @example
 * ```ts
 * import { IdentityKeys } from "nostr-effect/identity"
 *
 * // Fixture only in tests — never log real mnemonics
 * const id = IdentityKeys.fromOpenAgentsLegacyMnemonic(
 *   "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
 * )
 * console.log(id.npub) // public
 * const signer = id.asSigner()
 * await signer.signEvent({ kind: 1, content: "hi", tags: [] })
 * ```
 */
export class IdentityKeys {
  readonly #signer: LocalKeySigner
  readonly #accountPath: string
  readonly #profileId: string
  readonly #accountIndex: number

  private constructor(
    privateKey: Uint8Array,
    meta: { accountPath: string; profileId: string; accountIndex: number }
  ) {
    this.#accountPath = meta.accountPath
    this.#profileId = meta.profileId
    this.#accountIndex = meta.accountIndex
    this.#signer = LocalKeySigner.fromPrivateKey(privateKey, {
      accountPath: meta.accountPath,
      profileId: meta.profileId,
    })
    // privateKey copy is owned by LocalKeySigner; zero caller's buffer if distinct
    privateKey.fill(0)
  }

  /**
   * Derive from mnemonic (NIP-06).
   * Default: empty passphrase, account 0 → path `m/44'/1237'/0'/0/0`.
   */
  static fromMnemonic(mnemonic: string, options: IdentityKeysOptions = {}): IdentityKeys {
    if (!validateWords(mnemonic)) {
      throw new Error("IdentityKeys: invalid BIP-39 mnemonic")
    }
    const passphrase = options.passphrase ?? ""
    const accountIndex = options.accountIndex ?? 0
    const path = accountPath(accountIndex)
    const profileId =
      options.profileId ??
      (accountIndex === 0 && passphrase === ""
        ? OPENAGENTS_LEGACY_IDENTITY_PROFILE
        : `nip06.account.${accountIndex}`)

    const { privateKey } = accountFromSeedWords(mnemonic, passphrase, accountIndex)
    return new IdentityKeys(privateKey, {
      accountPath: path,
      profileId,
      accountIndex,
    })
  }

  /**
   * OpenAgents historical identity: empty passphrase + account 0 only.
   * Path is always {@link NIP06_ACCOUNT_PATH}.
   */
  static fromOpenAgentsLegacyMnemonic(mnemonic: string): IdentityKeys {
    const { privateKey } = deriveOpenAgentsLegacyNostrAccount(mnemonic)
    return new IdentityKeys(privateKey, {
      accountPath: NIP06_ACCOUNT_PATH,
      profileId: OPENAGENTS_LEGACY_IDENTITY_PROFILE,
      accountIndex: 0,
    })
  }

  /**
   * Generate a new mnemonic and identity.
   * Returns the mnemonic once for backup UI — caller must store securely.
   */
  static generate(options: GenerateIdentityOptions = {}): GeneratedIdentity {
    const mnemonic = generateSeedWords(options.strength ?? 128)
    const identity = IdentityKeys.fromMnemonic(mnemonic, options)
    return { mnemonic, identity }
  }

  get publicKey(): string {
    return this.#signer.publicKey
  }

  get npub(): string {
    return this.#signer.npub
  }

  get accountPath(): string {
    return this.#accountPath
  }

  get profileId(): string {
    return this.#profileId
  }

  get accountIndex(): number {
    return this.#accountIndex
  }

  /**
   * Local signer port — preferred handle for apps.
   * Returns a narrow object with only {@link LocalSignerPort} methods (no key export).
   */
  asSigner(): LocalSignerPort {
    const s = this.#signer
    return {
      getPublicKey: () => s.getPublicKey(),
      signEvent: (event) => s.signEvent(event),
      nip44Encrypt: (recipientPubkey, plaintext) => s.nip44Encrypt(recipientPubkey, plaintext),
      nip44Decrypt: (senderPubkey, ciphertext) => s.nip44Decrypt(senderPubkey, ciphertext),
      createHttpAuthToken: (url, method, options) => s.createHttpAuthToken(url, method, options),
      toPublicManifest: () => s.toPublicManifest(),
    }
  }

  /**
   * Full {@link LocalKeySigner} when custody code needs `exportPrivateKeyBytes` / `dispose`.
   * Prefer {@link asSigner} for application logic.
   */
  asLocalKeySigner(): LocalKeySigner {
    return this.#signer
  }

  toPublicManifest(): PublicIdentityManifest {
    return this.#signer.toPublicManifest()
  }

  /**
   * Recovery / Keychain import only. **Do not log.**
   */
  exportPrivateKeyBytes(): Uint8Array {
    return this.#signer.exportPrivateKeyBytes()
  }

  /**
   * Recovery only. **Do not log.** Prefer platform secret store over nsec strings.
   */
  exportNsec(): string {
    return nsecEncodeSync(this.exportPrivateKeyBytes())
  }

  /** Zeroize signer key material. */
  dispose(): void {
    this.#signer.dispose()
  }

  toJSON(): PublicIdentityManifest {
    return this.toPublicManifest()
  }

  toString(): string {
    return `IdentityKeys(${this.npub})`
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString()
  }
}

// Re-export npub helper for convenience docs
export { npubEncodeSync }
