/**
 * Pure functions for Nostr event creation and verification.
 *
 * This module provides nostr-tools-compatible functions that work without Effect.
 * It's a drop-in replacement for `nostr-tools/pure`.
 *
 * @example
 * ```typescript
 * import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-effect/pure'
 *
 * const sk = generateSecretKey()
 * const pk = getPublicKey(sk)
 * const event = finalizeEvent({
 *   kind: 1,
 *   created_at: Math.floor(Date.now() / 1000),
 *   tags: [],
 *   content: 'Hello, Nostr!'
 * }, sk)
 *
 * console.log(verifyEvent(event)) // true
 * ```
 */
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"

// =============================================================================
// Verified Symbol
// =============================================================================

/** Designates a verified event signature. Compatible with nostr-tools. */
export const verifiedSymbol = Symbol("verified")

// =============================================================================
// Types (nostr-tools compatible)
// =============================================================================

/** A Nostr event */
export interface Event {
  kind: number
  tags: string[][]
  content: string
  created_at: number
  pubkey: string
  id: string
  sig: string
  [verifiedSymbol]?: boolean
}

/** Alias for Event */
export type NostrEvent = Event

/** Template for creating an event (before signing) */
export type EventTemplate = Pick<Event, "kind" | "tags" | "content" | "created_at">

/** Unsigned event (has pubkey but no id/sig) */
export type UnsignedEvent = Pick<Event, "kind" | "tags" | "content" | "created_at" | "pubkey">

/** An event whose signature has been verified */
export interface VerifiedEvent extends Event {
  [verifiedSymbol]: true
}

// =============================================================================
// Validation
// =============================================================================

const isRecord = (obj: unknown): obj is Record<string, unknown> => obj instanceof Object

/** Validate that an object has the required event properties */
export function validateEvent<T>(event: T): event is T & UnsignedEvent {
  if (!isRecord(event)) return false
  if (typeof event.kind !== "number") return false
  if (typeof event.content !== "string") return false
  if (typeof event.created_at !== "number") return false
  if (typeof event.pubkey !== "string") return false
  if (!event.pubkey.match(/^[a-f0-9]{64}$/)) return false

  if (!Array.isArray(event.tags)) return false
  for (let i = 0; i < event.tags.length; i++) {
    const tag = event.tags[i]
    if (!Array.isArray(tag)) return false
    for (let j = 0; j < tag.length; j++) {
      if (typeof tag[j] !== "string") return false
    }
  }

  return true
}

// =============================================================================
// Serialization
// =============================================================================

/** Serialize an event for hashing (NIP-01) */
export function serializeEvent(evt: UnsignedEvent): string {
  if (!validateEvent(evt)) throw new Error("can't serialize event with wrong or missing properties")
  return JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content])
}

/** Compute the event ID (sha256 hash of serialized event) */
export function getEventHash(event: UnsignedEvent): string {
  const eventHash = sha256(new TextEncoder().encode(serializeEvent(event)))
  return bytesToHex(eventHash)
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Generate a random 32-byte secret key.
 *
 * @returns A new random secret key as Uint8Array
 */
export function generateSecretKey(): Uint8Array {
  return schnorr.utils.randomPrivateKey()
}

/**
 * Derive the public key from a secret key.
 *
 * @param secretKey - 32-byte secret key
 * @returns 64-character hex public key
 */
export function getPublicKey(secretKey: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(secretKey))
}

/**
 * Sign an event template and return a complete signed event.
 *
 * @param t - Event template with kind, tags, content, created_at
 * @param secretKey - 32-byte secret key
 * @returns Complete signed event with id, pubkey, sig
 */
export function finalizeEvent(t: EventTemplate, secretKey: Uint8Array): VerifiedEvent {
  const event = t as VerifiedEvent
  event.pubkey = bytesToHex(schnorr.getPublicKey(secretKey))
  event.id = getEventHash(event)
  event.sig = bytesToHex(schnorr.sign(event.id, secretKey))
  event[verifiedSymbol] = true
  return event
}

/**
 * Verify an event's signature.
 *
 * This checks that:
 * 1. The event ID matches sha256(serialized event)
 * 2. The signature is valid for the ID and pubkey
 *
 * @param event - Event to verify
 * @returns true if the event signature is valid
 */
export function verifyEvent(event: Event): event is VerifiedEvent {
  if (typeof event[verifiedSymbol] === "boolean") return event[verifiedSymbol]

  const hash = getEventHash(event)
  if (hash !== event.id) {
    event[verifiedSymbol] = false
    return false
  }

  try {
    const valid = schnorr.verify(event.sig, hash, event.pubkey)
    event[verifiedSymbol] = valid
    return valid
  } catch {
    event[verifiedSymbol] = false
    return false
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Sort events in reverse-chronological order by created_at,
 * then by id (lexicographically) in case of ties.
 * This mutates the array.
 */
export function sortEvents(events: Event[]): Event[] {
  return events.sort((a: Event, b: Event): number => {
    if (a.created_at !== b.created_at) {
      return b.created_at - a.created_at
    }
    return a.id.localeCompare(b.id)
  })
}
