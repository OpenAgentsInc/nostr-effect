/**
 * NIP-37: Draft Wraps
 * Spec: ~/code/nips/37.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent, getPublicKey } from "./pure.js"
import { getConversationKey, encrypt, decrypt } from "./nip44.js"

export const DraftWrapKind = 31234
export const PrivateRelaysKind = 10013

export interface DraftWrapParams {
  readonly draft: Record<string, unknown>
  readonly draftKind: number
  readonly identifier?: string
  readonly expiration?: string | number
  readonly created_at?: number
}

/** Build a draft wrap template (kind 31234). Content is NIP-44 encrypted JSON of the draft event. */
export function buildDraftWrap(p: DraftWrapParams, authorSecretKey: Uint8Array): EventTemplate {
  const authorPub = getPublicKey(authorSecretKey)
  const ck = getConversationKey(authorSecretKey, authorPub)
  const plaintext = JSON.stringify(p.draft)
  const ciphertext = encrypt(plaintext, ck)

  const tags: string[][] = [["k", String(p.draftKind)]]
  if (p.identifier) tags.push(["d", p.identifier])
  if (p.expiration !== undefined) tags.push(["expiration", String(p.expiration)])

  return {
    kind: DraftWrapKind,
    content: ciphertext,
    tags,
    created_at: p.created_at ?? Math.floor(Date.now() / 1000),
  }
}

export function signDraftWrap(p: DraftWrapParams, authorSecretKey: Uint8Array): Event {
  return finalizeEvent(buildDraftWrap(p, authorSecretKey), authorSecretKey)
}

/** Mark a draft wrap as deleted by blanking content (same tags). */
export function buildDeletedDraft(identifier: string, draftKind: number, created_at?: number): EventTemplate {
  return {
    kind: DraftWrapKind,
    content: "",
    tags: [["d", identifier], ["k", String(draftKind)]],
    created_at: created_at ?? Math.floor(Date.now() / 1000),
  }
}

export interface PrivateRelaysParams {
  readonly relays: readonly string[]
  readonly created_at?: number
}

/** Build a Private Storage Relay list (kind 10013). Content is NIP-44 encrypted JSON array of ["relay", url] tuples. */
export function buildPrivateRelays(p: PrivateRelaysParams, authorSecretKey: Uint8Array): EventTemplate {
  const authorPub = getPublicKey(authorSecretKey)
  const ck = getConversationKey(authorSecretKey, authorPub)
  const tuples = p.relays.map((url) => ["relay", url])
  const content = encrypt(JSON.stringify(tuples), ck)
  return {
    kind: PrivateRelaysKind,
    content,
    tags: [],
    created_at: p.created_at ?? Math.floor(Date.now() / 1000),
  }
}

export function signPrivateRelays(p: PrivateRelaysParams, authorSecretKey: Uint8Array): Event {
  return finalizeEvent(buildPrivateRelays(p, authorSecretKey), authorSecretKey)
}

/** Helper to decrypt draft content (for testing/utilities) */
export function decryptForAuthor(content: string, authorSecretKey: Uint8Array): string {
  const authorPub = getPublicKey(authorSecretKey)
  const ck = getConversationKey(authorSecretKey, authorPub)
  return decrypt(content, ck)
}

