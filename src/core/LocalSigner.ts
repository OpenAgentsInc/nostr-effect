/**
 * LocalSignerPort — identity-safe signing surface for OpenAgents #9092
 *
 * Normal callers get public key, sign, NIP-44, and optional NIP-98 tokens.
 * They do **not** get the mnemonic, nsec, or raw private key through this port.
 *
 * Secret material stays inside the implementing class. OpenAgents
 * `packages/sovereign-identity` should depend on this shape, not on raw keys.
 */
import { finalizeEvent, getPublicKey, type EventTemplate as PureEventTemplate, type VerifiedEvent } from "../wrappers/pure.js"
import { encrypt as nip44EncryptRaw, decrypt as nip44DecryptRaw, getConversationKey } from "../wrappers/nip44.js"
import { getToken } from "./Nip98.js"
import { npubEncodeSync } from "./Nip19.js"

// =============================================================================
// Types
// =============================================================================

/** Unsigned event template (created_at optional — filled at sign time) */
export interface SignEventTemplate {
  readonly kind: number
  readonly content: string
  readonly tags: readonly (readonly string[])[]
  readonly created_at?: number
}

/** Public-only identity fields safe for manifests / logs */
export interface PublicIdentityManifest {
  /** Hex x-only public key (64 chars) */
  readonly pubkey: string
  /** bech32 npub */
  readonly npub: string
  /** BIP-32 path used when derived via NIP-06, if known */
  readonly accountPath?: string
  /** Derivation profile id (e.g. openagents.legacy_unified_nostr_spark.v1) */
  readonly profileId?: string
}

/**
 * Local signer port — the only ops normal IDR callers need.
 *
 * Implementations MUST NOT expose mnemonic/nsec/seed through these methods.
 */
export interface LocalSignerPort {
  /** Hex public key */
  getPublicKey(): Promise<string>
  /** NIP-01 sign */
  signEvent(event: SignEventTemplate): Promise<VerifiedEvent>
  /** NIP-44 encrypt to recipient hex pubkey */
  nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string>
  /** NIP-44 decrypt from sender hex pubkey */
  nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string>
  /**
   * NIP-98 HTTP auth token (base64 event, optional `Nostr ` prefix).
   * Prefer raw body as `Uint8Array` or string when hashing `payload`.
   */
  createHttpAuthToken(
    url: string,
    method: string,
    options?: {
      includeAuthorizationScheme?: boolean
      body?: unknown
    }
  ): Promise<string>
  /** Public-only manifest (safe to log / persist) */
  toPublicManifest(): PublicIdentityManifest
}

// =============================================================================
// LocalKeySigner
// =============================================================================

/**
 * LocalKeySigner holds a 32-byte Nostr private key and implements {@link LocalSignerPort}.
 *
 * Construct from a key you already control (e.g. after NIP-06 derive). Prefer
 * {@link IdentityKeys} when starting from a mnemonic.
 *
 * @example
 * ```ts
 * const signer = LocalKeySigner.fromPrivateKey(sk)
 * const pk = await signer.getPublicKey()
 * const ev = await signer.signEvent({ kind: 1, content: "hi", tags: [] })
 * ```
 */
export class LocalKeySigner implements LocalSignerPort {
  readonly #secretKey: Uint8Array
  readonly #pubkey: string
  readonly #accountPath?: string
  readonly #profileId?: string
  #disposed = false

  private constructor(
    secretKey: Uint8Array,
    meta?: { accountPath?: string; profileId?: string }
  ) {
    if (secretKey.length !== 32) {
      throw new Error(`LocalKeySigner: expected 32-byte secret key, got ${secretKey.length}`)
    }
    // Own a copy so callers can zero their buffer independently
    this.#secretKey = new Uint8Array(secretKey)
    this.#pubkey = getPublicKey(this.#secretKey)
    if (meta?.accountPath !== undefined) this.#accountPath = meta.accountPath
    if (meta?.profileId !== undefined) this.#profileId = meta.profileId
  }

  static fromPrivateKey(
    secretKey: Uint8Array,
    meta?: { accountPath?: string; profileId?: string }
  ): LocalKeySigner {
    return new LocalKeySigner(secretKey, meta)
  }

  private assertLive(): void {
    if (this.#disposed) {
      throw new Error("LocalKeySigner: disposed")
    }
  }

  async getPublicKey(): Promise<string> {
    this.assertLive()
    return this.#pubkey
  }

  /** Sync public key (no I/O) */
  get publicKey(): string {
    this.assertLive()
    return this.#pubkey
  }

  get npub(): string {
    return npubEncodeSync(this.publicKey)
  }

  async signEvent(event: SignEventTemplate): Promise<VerifiedEvent> {
    this.assertLive()
    const template: PureEventTemplate = {
      kind: event.kind,
      content: event.content,
      tags: event.tags.map((t) => [...t]),
      created_at: event.created_at ?? Math.floor(Date.now() / 1000),
    }
    return finalizeEvent(template, this.#secretKey)
  }

  async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
    this.assertLive()
    const ck = getConversationKey(this.#secretKey, recipientPubkey)
    return nip44EncryptRaw(plaintext, ck)
  }

  async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    this.assertLive()
    const ck = getConversationKey(this.#secretKey, senderPubkey)
    return nip44DecryptRaw(ciphertext, ck)
  }

  async createHttpAuthToken(
    url: string,
    method: string,
    options?: { includeAuthorizationScheme?: boolean; body?: unknown }
  ): Promise<string> {
    this.assertLive()
    return getToken(
      url,
      method,
      (template) => {
        const signed = finalizeEvent(
          {
            kind: Number(template.kind),
            content: template.content,
            tags: template.tags.map((t) => [...t]),
            created_at: Number(template.created_at),
          },
          this.#secretKey
        )
        // NIP-98 expects branded NostrEvent; pure VerifiedEvent is structurally compatible at runtime
        return signed as unknown as import("./Schema.js").NostrEvent
      },
      options?.includeAuthorizationScheme ?? false,
      options?.body
    )
  }

  toPublicManifest(): PublicIdentityManifest {
    this.assertLive()
    const manifest: PublicIdentityManifest = {
      pubkey: this.#pubkey,
      npub: npubEncodeSync(this.#pubkey),
    }
    if (this.#accountPath !== undefined) {
      ;(manifest as { accountPath?: string }).accountPath = this.#accountPath
    }
    if (this.#profileId !== undefined) {
      ;(manifest as { profileId?: string }).profileId = this.#profileId
    }
    return manifest
  }

  /**
   * Escape hatch: copy of private key bytes for custody import only.
   * Do not log. Prefer platform secret store over holding this in app memory.
   */
  exportPrivateKeyBytes(): Uint8Array {
    this.assertLive()
    return new Uint8Array(this.#secretKey)
  }

  /** Zeroizes held key material. Further use throws. */
  dispose(): void {
    this.#secretKey.fill(0)
    this.#disposed = true
  }

  /** Public-only JSON (never secrets). */
  toJSON(): PublicIdentityManifest {
    return this.toPublicManifest()
  }

  /** Avoid accidental secret stringification */
  toString(): string {
    return `LocalKeySigner(${this.#disposed ? "disposed" : this.npub})`
  }

  // Block util.inspect dumping of private fields in Node
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString()
  }
}
