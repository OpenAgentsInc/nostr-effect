/**
 * Signer Interface
 *
 * Abstract signer interface and PlainKeySigner implementation.
 *
 * @example
 * ```typescript
 * import { PlainKeySigner } from 'nostr-effect/signer'
 *
 * const signer = new PlainKeySigner(secretKey)
 * const pubkey = await signer.getPublicKey()
 * const signedEvent = await signer.signEvent(eventTemplate)
 * ```
 */

import { finalizeEvent, getPublicKey } from "./pure.js"

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

/** Signer interface */
export interface Signer {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<VerifiedEvent>
}

/**
 * Simple signer using a plain secret key
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
}
