/**
 * NIP-19: bech32-encoded entities
 *
 * This module provides nostr-tools-compatible functions for encoding/decoding
 * Nostr entities in bech32 format. It's a drop-in replacement for `nostr-tools/nip19`.
 *
 * @example
 * ```typescript
 * import * as nip19 from 'nostr-effect/nip19'
 *
 * // Encode
 * const npub = nip19.npubEncode('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d')
 * console.log(npub) // 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6'
 *
 * // Decode
 * const { type, data } = nip19.decode(npub)
 * console.log(type) // 'npub'
 * console.log(data) // '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
 * ```
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/19.md
 */

import { hexToBytes } from "@noble/hashes/utils"
import {
  npubEncodeSync,
  nsecEncodeSync,
  noteEncodeSync,
  nprofileEncodeSync,
  neventEncodeSync,
  naddrEncodeSync,
  decodeSync as coreDecodeSync,
} from "../core/Nip19.js"

// Re-export types from core
export type { ProfilePointer, EventPointer, AddressPointer } from "../core/Nip19.js"

// Re-export sync functions with nostr-tools compatible names
export {
  npubEncodeSync as npubEncode,
  nsecEncodeSync as nsecEncode,
  noteEncodeSync as noteEncode,
  nprofileEncodeSync as nprofileEncode,
  neventEncodeSync as neventEncode,
  naddrEncodeSync as naddrEncode,
  encodeBytesSync as encodeBytes,
} from "../core/Nip19.js"

// =============================================================================
// Constants
// =============================================================================

/**
 * Bech32 regex pattern for matching NIP-19 strings.
 * @see https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki#bech32
 */
export const BECH32_REGEX = /[\x21-\x7E]{1,83}1[023456789acdefghjklmnpqrstuvwxyz]{6,}/

// =============================================================================
// Type Guards
// =============================================================================

export type NProfile = `nprofile1${string}`
export type NEvent = `nevent1${string}`
export type NAddr = `naddr1${string}`
export type NSec = `nsec1${string}`
export type NPub = `npub1${string}`
export type Note = `note1${string}`
export type Ncryptsec = `ncryptsec1${string}`

export const NostrTypeGuard = {
  isNProfile: (value?: string | null): value is NProfile => /^nprofile1[a-z\d]+$/.test(value || ""),
  isNEvent: (value?: string | null): value is NEvent => /^nevent1[a-z\d]+$/.test(value || ""),
  isNAddr: (value?: string | null): value is NAddr => /^naddr1[a-z\d]+$/.test(value || ""),
  isNSec: (value?: string | null): value is NSec => /^nsec1[a-z\d]{58}$/.test(value || ""),
  isNPub: (value?: string | null): value is NPub => /^npub1[a-z\d]{58}$/.test(value || ""),
  isNote: (value?: string | null): value is Note => /^note1[a-z\d]+$/.test(value || ""),
  isNcryptsec: (value?: string | null): value is Ncryptsec => /^ncryptsec1[a-z\d]+$/.test(value || ""),
}

// =============================================================================
// Decoded Result Types (for type overloads)
// =============================================================================

export type DecodedNevent = {
  type: "nevent"
  data: import("../core/Nip19.js").EventPointer & { relays: string[] }
}

export type DecodedNprofile = {
  type: "nprofile"
  data: import("../core/Nip19.js").ProfilePointer & { relays: string[] }
}

export type DecodedNaddr = {
  type: "naddr"
  data: import("../core/Nip19.js").AddressPointer & { relays: string[] }
}

export type DecodedNsec = {
  type: "nsec"
  data: Uint8Array
}

export type DecodedNpub = {
  type: "npub"
  data: string
}

export type DecodedNote = {
  type: "note"
  data: string
}

export type DecodeResult = DecodedNevent | DecodedNprofile | DecodedNaddr | DecodedNpub | DecodedNsec | DecodedNote

// =============================================================================
// Decode Function (wrapper-specific for nostr-tools compatibility)
// =============================================================================

/**
 * Decode any NIP-19 bech32 string.
 * Returns nsec as Uint8Array for nostr-tools compatibility.
 *
 * @param nip19 - bech32-encoded Nostr entity
 * @returns Decoded result with type and data
 * @throws Error if the string is invalid
 */
export function decode(nip19: string): DecodeResult {
  const result = coreDecodeSync(nip19)

  // Convert nsec hex string back to Uint8Array for nostr-tools compatibility
  if (result.type === "nsec") {
    return {
      type: "nsec",
      data: hexToBytes(result.data as string),
    }
  }

  // For other types, just cast to the unbranded wrapper types
  return result as unknown as DecodeResult
}

// =============================================================================
// Additional nostr: URI Helper
// =============================================================================

/**
 * Decode a nostr: URI, stripping the "nostr:" prefix if present.
 *
 * @param nip19code - nostr: URI or bare bech32 string
 * @returns Decoded result or { type: 'invalid', data: null } on error
 */
export function decodeNostrURI(nip19code: string): DecodeResult | { type: "invalid"; data: null } {
  try {
    if (nip19code.startsWith("nostr:")) nip19code = nip19code.substring(6)
    return decode(nip19code)
  } catch {
    return { type: "invalid", data: null }
  }
}

// =============================================================================
// Convenience Aliases
// =============================================================================

/** Alias for naddrEncode */
export const encodeNaddr = naddrEncodeSync
/** Alias for neventEncode */
export const encodeNevent = neventEncodeSync
/** Alias for nprofileEncode */
export const encodeNprofile = nprofileEncodeSync
/** Alias for noteEncode */
export const encodeNote = noteEncodeSync
/** Alias for npubEncode */
export const encodeNpub = npubEncodeSync
/** Alias for nsecEncode */
export const encodeNsec = nsecEncodeSync
