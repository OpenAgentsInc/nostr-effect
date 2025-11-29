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
import { bech32 } from "@scure/base"
import { hexToBytes, bytesToHex, concatBytes } from "@noble/hashes/utils"

// =============================================================================
// Constants
// =============================================================================

const BECH32_MAX_SIZE = 5000

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
// Pointer Types
// =============================================================================

/** Profile pointer - references a pubkey with optional relays */
export interface ProfilePointer {
  pubkey: string
  relays?: string[]
}

/** Event pointer - references an event with optional metadata */
export interface EventPointer {
  id: string
  relays?: string[]
  author?: string
  kind?: number
}

/** Address pointer - references an addressable event (naddr) */
export interface AddressPointer {
  identifier: string
  pubkey: string
  kind: number
  relays?: string[]
}

// =============================================================================
// Decoded Result Types
// =============================================================================

export type DecodedNevent = {
  type: "nevent"
  data: EventPointer
}

export type DecodedNprofile = {
  type: "nprofile"
  data: ProfilePointer
}

export type DecodedNaddr = {
  type: "naddr"
  data: AddressPointer
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
// TLV Helpers
// =============================================================================

type TLV = { [t: number]: Uint8Array[] }

function parseTLV(data: Uint8Array): TLV {
  const result: TLV = {}
  let rest = data
  while (rest.length > 0) {
    const t = rest[0]!
    const l = rest[1]!
    const v = rest.slice(2, 2 + l)
    rest = rest.slice(2 + l)
    if (v.length < l) throw new Error(`not enough data to read on TLV ${t}`)
    result[t] = result[t] || []
    result[t].push(v)
  }
  return result
}

function encodeTLV(tlv: TLV): Uint8Array {
  const entries: Uint8Array[] = []

  Object.entries(tlv)
    .reverse()
    .forEach(([t, vs]) => {
      vs.forEach((v) => {
        const entry = new Uint8Array(v.length + 2)
        entry.set([parseInt(t)], 0)
        entry.set([v.length], 1)
        entry.set(v, 2)
        entries.push(entry)
      })
    })

  return concatBytes(...entries)
}

function integerToUint8Array(number: number): Uint8Array {
  const uint8Array = new Uint8Array(4)
  uint8Array[0] = (number >> 24) & 0xff
  uint8Array[1] = (number >> 16) & 0xff
  uint8Array[2] = (number >> 8) & 0xff
  uint8Array[3] = number & 0xff
  return uint8Array
}

// =============================================================================
// Encoding Functions
// =============================================================================

function encodeBech32<Prefix extends string>(prefix: Prefix, data: Uint8Array): `${Prefix}1${string}` {
  const words = bech32.toWords(data)
  return bech32.encode(prefix, words, BECH32_MAX_SIZE) as `${Prefix}1${string}`
}

/**
 * Encode bytes to a bech32 string with the given prefix.
 */
export function encodeBytes<Prefix extends string>(prefix: Prefix, bytes: Uint8Array): `${Prefix}1${string}` {
  return encodeBech32(prefix, bytes)
}

/**
 * Encode a secret key (Uint8Array) to nsec format.
 *
 * @param key - 32-byte secret key
 * @returns bech32-encoded nsec string
 */
export function nsecEncode(key: Uint8Array): NSec {
  return encodeBech32("nsec", key)
}

/**
 * Encode a public key (hex string) to npub format.
 *
 * @param hex - 64-character hex public key
 * @returns bech32-encoded npub string
 */
export function npubEncode(hex: string): NPub {
  return encodeBech32("npub", hexToBytes(hex))
}

/**
 * Encode an event ID (hex string) to note format.
 *
 * @param hex - 64-character hex event ID
 * @returns bech32-encoded note string
 */
export function noteEncode(hex: string): Note {
  return encodeBech32("note", hexToBytes(hex))
}

/**
 * Encode a profile pointer to nprofile format.
 *
 * @param profile - Profile with pubkey and optional relays
 * @returns bech32-encoded nprofile string
 */
export function nprofileEncode(profile: ProfilePointer): NProfile {
  const data = encodeTLV({
    0: [hexToBytes(profile.pubkey)],
    1: (profile.relays || []).map((url) => new TextEncoder().encode(url)),
  })
  return encodeBech32("nprofile", data)
}

/**
 * Encode an event pointer to nevent format.
 *
 * @param event - Event with id, optional relays, author, and kind
 * @returns bech32-encoded nevent string
 */
export function neventEncode(event: EventPointer): NEvent {
  let kindArray: Uint8Array | undefined
  if (event.kind !== undefined) {
    kindArray = integerToUint8Array(event.kind)
  }

  const data = encodeTLV({
    0: [hexToBytes(event.id)],
    1: (event.relays || []).map((url) => new TextEncoder().encode(url)),
    2: event.author ? [hexToBytes(event.author)] : [],
    3: kindArray ? [kindArray] : [],
  })

  return encodeBech32("nevent", data)
}

/**
 * Encode an address pointer to naddr format.
 *
 * @param addr - Address with identifier, pubkey, kind, and optional relays
 * @returns bech32-encoded naddr string
 */
export function naddrEncode(addr: AddressPointer): NAddr {
  const kind = new ArrayBuffer(4)
  new DataView(kind).setUint32(0, addr.kind, false)

  const data = encodeTLV({
    0: [new TextEncoder().encode(addr.identifier)],
    1: (addr.relays || []).map((url) => new TextEncoder().encode(url)),
    2: [hexToBytes(addr.pubkey)],
    3: [new Uint8Array(kind)],
  })
  return encodeBech32("naddr", data)
}

// =============================================================================
// Decoding Functions
// =============================================================================

/**
 * Decode any NIP-19 bech32 string.
 *
 * @param nip19 - bech32-encoded Nostr entity
 * @returns Decoded result with type and data
 * @throws Error if the string is invalid
 */
export function decode(nip19: NEvent): DecodedNevent
export function decode(nip19: NProfile): DecodedNprofile
export function decode(nip19: NAddr): DecodedNaddr
export function decode(nip19: NSec): DecodedNsec
export function decode(nip19: NPub): DecodedNpub
export function decode(nip19: Note): DecodedNote
export function decode(code: string): DecodeResult
export function decode(code: string): DecodeResult {
  const { prefix, words } = bech32.decode(code as `${string}1${string}`, BECH32_MAX_SIZE)
  const data = new Uint8Array(bech32.fromWords(words))

  switch (prefix) {
    case "nprofile": {
      const tlv = parseTLV(data)
      if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for nprofile")
      if (tlv[0][0].length !== 32) throw new Error("TLV 0 should be 32 bytes")

      return {
        type: "nprofile",
        data: {
          pubkey: bytesToHex(tlv[0][0]),
          relays: tlv[1] ? tlv[1].map((d) => new TextDecoder().decode(d)) : [],
        },
      }
    }
    case "nevent": {
      const tlv = parseTLV(data)
      if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for nevent")
      if (tlv[0][0].length !== 32) throw new Error("TLV 0 should be 32 bytes")
      const tlv2 = tlv[2]
      const tlv3 = tlv[3]
      if (tlv2 && tlv2[0] && tlv2[0].length !== 32) throw new Error("TLV 2 should be 32 bytes")
      if (tlv3 && tlv3[0] && tlv3[0].length !== 4) throw new Error("TLV 3 should be 4 bytes")

      const result: EventPointer = {
        id: bytesToHex(tlv[0][0]),
        relays: tlv[1] ? tlv[1].map((d) => new TextDecoder().decode(d)) : [],
      }
      if (tlv2?.[0]) {
        result.author = bytesToHex(tlv2[0])
      }
      if (tlv3?.[0]) {
        result.kind = parseInt(bytesToHex(tlv3[0]), 16)
      }
      return { type: "nevent", data: result }
    }

    case "naddr": {
      const tlv = parseTLV(data)
      if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for naddr")
      if (!tlv[2]?.[0]) throw new Error("missing TLV 2 for naddr")
      if (tlv[2][0].length !== 32) throw new Error("TLV 2 should be 32 bytes")
      if (!tlv[3]?.[0]) throw new Error("missing TLV 3 for naddr")
      if (tlv[3][0].length !== 4) throw new Error("TLV 3 should be 4 bytes")

      return {
        type: "naddr",
        data: {
          identifier: new TextDecoder().decode(tlv[0][0]),
          pubkey: bytesToHex(tlv[2][0]),
          kind: parseInt(bytesToHex(tlv[3][0]), 16),
          relays: tlv[1] ? tlv[1].map((d) => new TextDecoder().decode(d)) : [],
        },
      }
    }

    case "nsec":
      return { type: prefix, data }

    case "npub":
    case "note":
      return { type: prefix, data: bytesToHex(data) }

    default:
      throw new Error(`unknown prefix ${prefix}`)
  }
}

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
export const encodeNaddr = naddrEncode
/** Alias for neventEncode */
export const encodeNevent = neventEncode
/** Alias for nprofileEncode */
export const encodeNprofile = nprofileEncode
/** Alias for noteEncode */
export const encodeNote = noteEncode
/** Alias for npubEncode */
export const encodeNpub = npubEncode
/** Alias for nsecEncode */
export const encodeNsec = nsecEncode
