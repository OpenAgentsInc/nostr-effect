/**
 * Signer Interface
 *
 * Minimal {@link Signer} plus full {@link LocalSignerPort} (NIP-44, NIP-98).
 * Prefer `nostr-effect/identity` for mnemonic-based OpenAgents #9092 flows.
 *
 * @example
 * ```typescript
 * import { PlainKeySigner, LocalKeySigner } from 'nostr-effect/signer'
 *
 * const signer = LocalKeySigner.fromPrivateKey(secretKey)
 * const pubkey = await signer.getPublicKey()
 * const signedEvent = await signer.signEvent({ kind: 1, content: "hi", tags: [] })
 * ```
 */

import { finalizeEvent, getPublicKey } from "./pure.js"
import {
  LocalKeySigner,
  type LocalSignerPort,
  type PublicIdentityManifest,
  type SignEventTemplate,
} from "../core/LocalSigner.js"

export { LocalKeySigner }
export type { LocalSignerPort, PublicIdentityManifest, SignEventTemplate }

/** Unsigned event template */
export interface EventTemplate {
  kind: number
  created_at?: number
  content: string
  tags: string[][]
}

/** Verified/signed event */
export interface VerifiedEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Minimal signer interface (getPublicKey + signEvent) */
export interface Signer {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<VerifiedEvent>
}

/**
 * Simple signer using a plain secret key (minimal {@link Signer} only).
 * Prefer {@link LocalKeySigner} when NIP-44 / NIP-98 are needed.
 */
export class PlainKeySigner implements Signer {
  private secretKey: Uint8Array

  constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey
  }

  async getPublicKey(): Promise<string> {
    return getPublicKey(this.secretKey)
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    const template = {
      ...event,
      created_at: event.created_at ?? Math.floor(Date.now() / 1000),
    }
    return finalizeEvent(template, this.secretKey) as VerifiedEvent
  }

  /** Upgrade to full local port (NIP-44, NIP-98) sharing the same key material. */
  toLocalKeySigner(): LocalKeySigner {
    return LocalKeySigner.fromPrivateKey(this.secretKey)
  }
}
