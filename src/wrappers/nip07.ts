/**
 * NIP-07: window.nostr capability for web browsers
 *
 * Type definitions for browser extension signers.
 *
 * @example
 * ```typescript
 * import type { WindowNostr } from 'nostr-effect/nip07'
 *
 * declare global {
 *   interface Window {
 *     nostr?: WindowNostr
 *   }
 * }
 *
 * if (window.nostr) {
 *   const pubkey = await window.nostr.getPublicKey()
 *   const signed = await window.nostr.signEvent(event)
 * }
 * ```
 */

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

/**
 * NIP-07 window.nostr interface
 * Provided by browser extensions like nos2x, Alby, etc.
 */
export interface WindowNostr {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<VerifiedEvent>
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}
