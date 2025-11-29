/**
 * NIP-19: bech32-encoded entities
 *
 * Encodes and decodes Nostr entities in human-readable bech32 format.
 * @see https://github.com/nostr-protocol/nips/blob/master/19.md
 */
import { Effect } from "effect"
import { bech32 } from "@scure/base"
import { hexToBytes, bytesToHex } from "@noble/hashes/utils"
import { EncodingError, DecodingError } from "./Errors.js"
import type { PublicKey, PrivateKey, EventId, EventKind } from "./Schema.js"

// =============================================================================
// Constants
// =============================================================================

const BECH32_MAX_SIZE = 5000

// TLV Types per NIP-19
const TLV_SPECIAL = 0 // pubkey for nprofile/nevent, d-tag for naddr
const TLV_RELAY = 1 // relay URL
const TLV_AUTHOR = 2 // pubkey
const TLV_KIND = 3 // event kind

// Type helper for bech32 decode which expects template literal
type Bech32String = `${string}1${string}`

// =============================================================================
// Types
// =============================================================================

/** Decoded nprofile: pubkey with optional relay hints */
export interface Nprofile {
  readonly pubkey: PublicKey
  readonly relays: ReadonlyArray<string>
}

/** Decoded nevent: event reference with optional metadata */
export interface Nevent {
  readonly id: EventId
  readonly relays: ReadonlyArray<string>
  readonly author?: PublicKey
  readonly kind?: EventKind
}

/** Decoded naddr: parameterized replaceable event coordinate */
export interface Naddr {
  readonly identifier: string
  readonly pubkey: PublicKey
  readonly kind: EventKind
  readonly relays: ReadonlyArray<string>
}

/** Union type for all decoded bech32 entities */
export type Nip19Data =
  | { type: "npub"; data: PublicKey }
  | { type: "nsec"; data: PrivateKey }
  | { type: "note"; data: EventId }
  | { type: "nprofile"; data: Nprofile }
  | { type: "nevent"; data: Nevent }
  | { type: "naddr"; data: Naddr }

/** Alias for Nip19Data for compatibility with other NIP modules */
export type DecodeResult = Nip19Data

// =============================================================================
// Pointer Types (for NIP-10, NIP-21, NIP-27, etc.)
// =============================================================================

/** Profile pointer - references a pubkey with optional relays */
export interface ProfilePointer {
  readonly pubkey: string
  readonly relays?: ReadonlyArray<string>
}

/** Event pointer - references an event with optional metadata */
export interface EventPointer {
  readonly id: string
  readonly relays?: ReadonlyArray<string>
  readonly author?: string
  readonly kind?: number
}

/** Address pointer - references an addressable event (naddr) */
export interface AddressPointer {
  readonly identifier: string
  readonly pubkey: string
  readonly kind: number
  readonly relays?: ReadonlyArray<string>
}

// =============================================================================
// Bare Encodings
// =============================================================================

/**
 * Encode a public key to npub format
 */
export const encodeNpub = (pubkey: PublicKey): Effect.Effect<string, EncodingError> =>
  Effect.try({
    try: () => {
      const bytes = hexToBytes(pubkey)
      if (bytes.length !== 32) {
        throw new Error(`Invalid pubkey length: expected 32 bytes, got ${bytes.length}`)
      }
      return bech32.encode("npub", bech32.toWords(bytes), BECH32_MAX_SIZE)
    },
    catch: (error) =>
      new EncodingError({
        message: `Failed to encode npub: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

/**
 * Encode a private key to nsec format
 */
export const encodeNsec = (privkey: PrivateKey): Effect.Effect<string, EncodingError> =>
  Effect.try({
    try: () => {
      const bytes = hexToBytes(privkey)
      if (bytes.length !== 32) {
        throw new Error(`Invalid private key length: expected 32 bytes, got ${bytes.length}`)
      }
      return bech32.encode("nsec", bech32.toWords(bytes), BECH32_MAX_SIZE)
    },
    catch: (error) =>
      new EncodingError({
        message: `Failed to encode nsec: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

/**
 * Encode an event ID to note format
 */
export const encodeNote = (eventId: EventId): Effect.Effect<string, EncodingError> =>
  Effect.try({
    try: () => {
      const bytes = hexToBytes(eventId)
      if (bytes.length !== 32) {
        throw new Error(`Invalid event ID length: expected 32 bytes, got ${bytes.length}`)
      }
      return bech32.encode("note", bech32.toWords(bytes), BECH32_MAX_SIZE)
    },
    catch: (error) =>
      new EncodingError({
        message: `Failed to encode note: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

// =============================================================================
// Bare Decodings
// =============================================================================

/**
 * Decode an npub to a public key
 */
export const decodeNpub = (npub: string): Effect.Effect<PublicKey, DecodingError> =>
  Effect.try({
    try: () => {
      const { prefix, words } = bech32.decode(npub as Bech32String, BECH32_MAX_SIZE)
      if (prefix !== "npub") {
        throw new Error(`Invalid prefix: expected 'npub', got '${prefix}'`)
      }
      const bytes = bech32.fromWords(words)
      if (bytes.length !== 32) {
        throw new Error(`Invalid decoded length: expected 32 bytes, got ${bytes.length}`)
      }
      return bytesToHex(bytes) as PublicKey
    },
    catch: (error) =>
      new DecodingError({
        message: `Failed to decode npub: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

/**
 * Decode an nsec to a private key
 */
export const decodeNsec = (nsec: string): Effect.Effect<PrivateKey, DecodingError> =>
  Effect.try({
    try: () => {
      const { prefix, words } = bech32.decode(nsec as Bech32String, BECH32_MAX_SIZE)
      if (prefix !== "nsec") {
        throw new Error(`Invalid prefix: expected 'nsec', got '${prefix}'`)
      }
      const bytes = bech32.fromWords(words)
      if (bytes.length !== 32) {
        throw new Error(`Invalid decoded length: expected 32 bytes, got ${bytes.length}`)
      }
      return bytesToHex(bytes) as PrivateKey
    },
    catch: (error) =>
      new DecodingError({
        message: `Failed to decode nsec: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

/**
 * Decode a note to an event ID
 */
export const decodeNote = (note: string): Effect.Effect<EventId, DecodingError> =>
  Effect.try({
    try: () => {
      const { prefix, words } = bech32.decode(note as Bech32String, BECH32_MAX_SIZE)
      if (prefix !== "note") {
        throw new Error(`Invalid prefix: expected 'note', got '${prefix}'`)
      }
      const bytes = bech32.fromWords(words)
      if (bytes.length !== 32) {
        throw new Error(`Invalid decoded length: expected 32 bytes, got ${bytes.length}`)
      }
      return bytesToHex(bytes) as EventId
    },
    catch: (error) =>
      new DecodingError({
        message: `Failed to decode note: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

// =============================================================================
// TLV Helpers
// =============================================================================

/**
 * Encode data to TLV format
 */
const encodeTLV = (entries: Array<{ type: number; value: Uint8Array }>): Uint8Array => {
  const chunks: Uint8Array[] = []
  for (const { type, value } of entries) {
    chunks.push(new Uint8Array([type, value.length]))
    chunks.push(value)
  }
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/**
 * Decode TLV format to entries
 */
const decodeTLV = (
  data: Uint8Array
): Array<{ type: number; value: Uint8Array }> => {
  const entries: Array<{ type: number; value: Uint8Array }> = []
  let offset = 0
  while (offset < data.length) {
    if (offset + 2 > data.length) {
      throw new Error("Truncated TLV data")
    }
    const type = data[offset]!
    const length = data[offset + 1]!
    offset += 2
    if (offset + length > data.length) {
      throw new Error(`TLV value exceeds data length at offset ${offset}`)
    }
    const value = data.slice(offset, offset + length)
    entries.push({ type, value })
    offset += length
  }
  return entries
}

// =============================================================================
// TLV Encodings
// =============================================================================

/**
 * Encode a profile to nprofile format
 */
export const encodeNprofile = (profile: Nprofile): Effect.Effect<string, EncodingError> =>
  Effect.try({
    try: () => {
      const entries: Array<{ type: number; value: Uint8Array }> = []

      // Type 0: pubkey (required)
      const pubkeyBytes = hexToBytes(profile.pubkey)
      if (pubkeyBytes.length !== 32) {
        throw new Error(`Invalid pubkey length: expected 32 bytes, got ${pubkeyBytes.length}`)
      }
      entries.push({ type: TLV_SPECIAL, value: pubkeyBytes })

      // Type 1: relays (optional, repeatable)
      for (const relay of profile.relays) {
        entries.push({ type: TLV_RELAY, value: new TextEncoder().encode(relay) })
      }

      const tlv = encodeTLV(entries)
      return bech32.encode("nprofile", bech32.toWords(tlv), BECH32_MAX_SIZE)
    },
    catch: (error) =>
      new EncodingError({
        message: `Failed to encode nprofile: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

/**
 * Encode an event reference to nevent format
 */
export const encodeNevent = (nevent: Nevent): Effect.Effect<string, EncodingError> =>
  Effect.try({
    try: () => {
      const entries: Array<{ type: number; value: Uint8Array }> = []

      // Type 0: event id (required)
      const idBytes = hexToBytes(nevent.id)
      if (idBytes.length !== 32) {
        throw new Error(`Invalid event ID length: expected 32 bytes, got ${idBytes.length}`)
      }
      entries.push({ type: TLV_SPECIAL, value: idBytes })

      // Type 1: relays (optional, repeatable)
      for (const relay of nevent.relays) {
        entries.push({ type: TLV_RELAY, value: new TextEncoder().encode(relay) })
      }

      // Type 2: author (optional)
      if (nevent.author) {
        const authorBytes = hexToBytes(nevent.author)
        if (authorBytes.length !== 32) {
          throw new Error(`Invalid author pubkey length: expected 32 bytes, got ${authorBytes.length}`)
        }
        entries.push({ type: TLV_AUTHOR, value: authorBytes })
      }

      // Type 3: kind (optional, big-endian u32)
      if (nevent.kind !== undefined) {
        const kindBytes = new Uint8Array(4)
        const view = new DataView(kindBytes.buffer)
        view.setUint32(0, nevent.kind, false) // big-endian
        entries.push({ type: TLV_KIND, value: kindBytes })
      }

      const tlv = encodeTLV(entries)
      return bech32.encode("nevent", bech32.toWords(tlv), BECH32_MAX_SIZE)
    },
    catch: (error) =>
      new EncodingError({
        message: `Failed to encode nevent: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

/**
 * Encode an addressable event coordinate to naddr format
 */
export const encodeNaddr = (naddr: Naddr): Effect.Effect<string, EncodingError> =>
  Effect.try({
    try: () => {
      const entries: Array<{ type: number; value: Uint8Array }> = []

      // Type 0: d-tag identifier (required)
      entries.push({ type: TLV_SPECIAL, value: new TextEncoder().encode(naddr.identifier) })

      // Type 1: relays (optional, repeatable)
      for (const relay of naddr.relays) {
        entries.push({ type: TLV_RELAY, value: new TextEncoder().encode(relay) })
      }

      // Type 2: author pubkey (required for naddr)
      const pubkeyBytes = hexToBytes(naddr.pubkey)
      if (pubkeyBytes.length !== 32) {
        throw new Error(`Invalid pubkey length: expected 32 bytes, got ${pubkeyBytes.length}`)
      }
      entries.push({ type: TLV_AUTHOR, value: pubkeyBytes })

      // Type 3: kind (required for naddr, big-endian u32)
      const kindBytes = new Uint8Array(4)
      const view = new DataView(kindBytes.buffer)
      view.setUint32(0, naddr.kind, false) // big-endian
      entries.push({ type: TLV_KIND, value: kindBytes })

      const tlv = encodeTLV(entries)
      return bech32.encode("naddr", bech32.toWords(tlv), BECH32_MAX_SIZE)
    },
    catch: (error) =>
      new EncodingError({
        message: `Failed to encode naddr: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

// =============================================================================
// TLV Decodings
// =============================================================================

/**
 * Decode an nprofile to a profile
 */
export const decodeNprofile = (nprofile: string): Effect.Effect<Nprofile, DecodingError> =>
  Effect.try({
    try: () => {
      const { prefix, words } = bech32.decode(nprofile as Bech32String, BECH32_MAX_SIZE)
      if (prefix !== "nprofile") {
        throw new Error(`Invalid prefix: expected 'nprofile', got '${prefix}'`)
      }

      const data = bech32.fromWords(words)
      const entries = decodeTLV(data)

      let pubkey: PublicKey | undefined
      const relays: string[] = []

      for (const { type, value } of entries) {
        switch (type) {
          case TLV_SPECIAL:
            if (value.length !== 32) {
              throw new Error(`Invalid pubkey length: expected 32 bytes, got ${value.length}`)
            }
            pubkey = bytesToHex(value) as PublicKey
            break
          case TLV_RELAY:
            relays.push(new TextDecoder().decode(value))
            break
        }
      }

      if (!pubkey) {
        throw new Error("Missing pubkey in nprofile")
      }

      return { pubkey, relays }
    },
    catch: (error) =>
      new DecodingError({
        message: `Failed to decode nprofile: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

/**
 * Decode a nevent to an event reference
 */
export const decodeNevent = (nevent: string): Effect.Effect<Nevent, DecodingError> =>
  Effect.try({
    try: () => {
      const { prefix, words } = bech32.decode(nevent as Bech32String, BECH32_MAX_SIZE)
      if (prefix !== "nevent") {
        throw new Error(`Invalid prefix: expected 'nevent', got '${prefix}'`)
      }

      const data = bech32.fromWords(words)
      const entries = decodeTLV(data)

      let id: EventId | undefined
      const relays: string[] = []
      let author: PublicKey | undefined
      let kind: EventKind | undefined

      for (const { type, value } of entries) {
        switch (type) {
          case TLV_SPECIAL:
            if (value.length !== 32) {
              throw new Error(`Invalid event ID length: expected 32 bytes, got ${value.length}`)
            }
            id = bytesToHex(value) as EventId
            break
          case TLV_RELAY:
            relays.push(new TextDecoder().decode(value))
            break
          case TLV_AUTHOR:
            if (value.length !== 32) {
              throw new Error(`Invalid author pubkey length: expected 32 bytes, got ${value.length}`)
            }
            author = bytesToHex(value) as PublicKey
            break
          case TLV_KIND: {
            if (value.length !== 4) {
              throw new Error(`Invalid kind length: expected 4 bytes, got ${value.length}`)
            }
            const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
            kind = view.getUint32(0, false) as EventKind // big-endian
            break
          }
        }
      }

      if (!id) {
        throw new Error("Missing event ID in nevent")
      }

      // Build result with optional properties only if present
      const result: Nevent = { id, relays }
      if (author !== undefined) {
        (result as { author: PublicKey }).author = author
      }
      if (kind !== undefined) {
        (result as { kind: EventKind }).kind = kind
      }
      return result
    },
    catch: (error) =>
      new DecodingError({
        message: `Failed to decode nevent: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

/**
 * Decode an naddr to an addressable event coordinate
 */
export const decodeNaddr = (naddr: string): Effect.Effect<Naddr, DecodingError> =>
  Effect.try({
    try: () => {
      const { prefix, words } = bech32.decode(naddr as Bech32String, BECH32_MAX_SIZE)
      if (prefix !== "naddr") {
        throw new Error(`Invalid prefix: expected 'naddr', got '${prefix}'`)
      }

      const data = bech32.fromWords(words)
      const entries = decodeTLV(data)

      let identifier: string | undefined
      const relays: string[] = []
      let pubkey: PublicKey | undefined
      let kind: EventKind | undefined

      for (const { type, value } of entries) {
        switch (type) {
          case TLV_SPECIAL:
            identifier = new TextDecoder().decode(value)
            break
          case TLV_RELAY:
            relays.push(new TextDecoder().decode(value))
            break
          case TLV_AUTHOR:
            if (value.length !== 32) {
              throw new Error(`Invalid pubkey length: expected 32 bytes, got ${value.length}`)
            }
            pubkey = bytesToHex(value) as PublicKey
            break
          case TLV_KIND: {
            if (value.length !== 4) {
              throw new Error(`Invalid kind length: expected 4 bytes, got ${value.length}`)
            }
            const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
            kind = view.getUint32(0, false) as EventKind // big-endian
            break
          }
        }
      }

      if (identifier === undefined) {
        throw new Error("Missing identifier in naddr")
      }
      if (!pubkey) {
        throw new Error("Missing pubkey in naddr")
      }
      if (kind === undefined) {
        throw new Error("Missing kind in naddr")
      }

      return { identifier, pubkey, kind, relays }
    },
    catch: (error) =>
      new DecodingError({
        message: `Failed to decode naddr: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

// =============================================================================
// Auto-detect Decode
// =============================================================================

/**
 * Decode any NIP-19 bech32 string, auto-detecting the type
 */
export const decode = (bech32String: string): Effect.Effect<Nip19Data, DecodingError> =>
  Effect.gen(function* () {
    // First, extract the prefix
    const prefix = yield* Effect.try({
      try: () => {
        const { prefix } = bech32.decode(bech32String as Bech32String, BECH32_MAX_SIZE)
        return prefix
      },
      catch: (error) =>
        new DecodingError({
          message: `Invalid bech32 string: ${error instanceof Error ? error.message : String(error)}`,
        }),
    })

    // Decode based on prefix
    switch (prefix) {
      case "npub": {
        const data = yield* decodeNpub(bech32String)
        return { type: "npub" as const, data }
      }
      case "nsec": {
        const data = yield* decodeNsec(bech32String)
        return { type: "nsec" as const, data }
      }
      case "note": {
        const data = yield* decodeNote(bech32String)
        return { type: "note" as const, data }
      }
      case "nprofile": {
        const data = yield* decodeNprofile(bech32String)
        return { type: "nprofile" as const, data }
      }
      case "nevent": {
        const data = yield* decodeNevent(bech32String)
        return { type: "nevent" as const, data }
      }
      case "naddr": {
        const data = yield* decodeNaddr(bech32String)
        return { type: "naddr" as const, data }
      }
      default:
        return yield* Effect.fail(
          new DecodingError({
            message: `Unknown NIP-19 prefix: '${prefix}'`,
          })
        )
    }
  })

// =============================================================================
// Synchronous Decode (for content parsing)
// =============================================================================

/**
 * Synchronously decode any NIP-19 bech32 string
 * Throws on error - use in try/catch blocks
 * Useful for content parsing where Effects cannot be used
 */
export const decodeSync = (bech32String: string): DecodeResult => {
  const { prefix, words } = bech32.decode(bech32String as Bech32String, BECH32_MAX_SIZE)
  const data = bech32.fromWords(words)

  switch (prefix) {
    case "npub": {
      if (data.length !== 32) {
        throw new Error(`Invalid pubkey length: expected 32 bytes, got ${data.length}`)
      }
      return { type: "npub", data: bytesToHex(data) as PublicKey }
    }
    case "nsec": {
      if (data.length !== 32) {
        throw new Error(`Invalid private key length: expected 32 bytes, got ${data.length}`)
      }
      return { type: "nsec", data: bytesToHex(data) as PrivateKey }
    }
    case "note": {
      if (data.length !== 32) {
        throw new Error(`Invalid event ID length: expected 32 bytes, got ${data.length}`)
      }
      return { type: "note", data: bytesToHex(data) as EventId }
    }
    case "nprofile": {
      const entries = decodeTLV(data)
      let pubkey: PublicKey | undefined
      const relays: string[] = []

      for (const { type, value } of entries) {
        if (type === TLV_SPECIAL) {
          if (value.length !== 32) {
            throw new Error(`Invalid pubkey length: expected 32 bytes, got ${value.length}`)
          }
          pubkey = bytesToHex(value) as PublicKey
        } else if (type === TLV_RELAY) {
          relays.push(new TextDecoder().decode(value))
        }
      }

      if (!pubkey) {
        throw new Error("Missing pubkey in nprofile")
      }

      return { type: "nprofile", data: { pubkey, relays } }
    }
    case "nevent": {
      const entries = decodeTLV(data)
      let id: EventId | undefined
      const relays: string[] = []
      let author: PublicKey | undefined
      let kind: EventKind | undefined

      for (const { type, value } of entries) {
        if (type === TLV_SPECIAL) {
          if (value.length !== 32) {
            throw new Error(`Invalid event ID length: expected 32 bytes, got ${value.length}`)
          }
          id = bytesToHex(value) as EventId
        } else if (type === TLV_RELAY) {
          relays.push(new TextDecoder().decode(value))
        } else if (type === TLV_AUTHOR) {
          if (value.length !== 32) {
            throw new Error(`Invalid author pubkey length: expected 32 bytes, got ${value.length}`)
          }
          author = bytesToHex(value) as PublicKey
        } else if (type === TLV_KIND) {
          if (value.length !== 4) {
            throw new Error(`Invalid kind length: expected 4 bytes, got ${value.length}`)
          }
          const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
          kind = view.getUint32(0, false) as EventKind
        }
      }

      if (!id) {
        throw new Error("Missing event ID in nevent")
      }

      const result: Nevent = { id, relays }
      if (author !== undefined) {
        (result as { author: PublicKey }).author = author
      }
      if (kind !== undefined) {
        (result as { kind: EventKind }).kind = kind
      }
      return { type: "nevent", data: result }
    }
    case "naddr": {
      const entries = decodeTLV(data)
      let identifier: string | undefined
      const relays: string[] = []
      let pubkey: PublicKey | undefined
      let kind: EventKind | undefined

      for (const { type, value } of entries) {
        if (type === TLV_SPECIAL) {
          identifier = new TextDecoder().decode(value)
        } else if (type === TLV_RELAY) {
          relays.push(new TextDecoder().decode(value))
        } else if (type === TLV_AUTHOR) {
          if (value.length !== 32) {
            throw new Error(`Invalid pubkey length: expected 32 bytes, got ${value.length}`)
          }
          pubkey = bytesToHex(value) as PublicKey
        } else if (type === TLV_KIND) {
          if (value.length !== 4) {
            throw new Error(`Invalid kind length: expected 4 bytes, got ${value.length}`)
          }
          const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
          kind = view.getUint32(0, false) as EventKind
        }
      }

      if (identifier === undefined) {
        throw new Error("Missing identifier in naddr")
      }
      if (!pubkey) {
        throw new Error("Missing pubkey in naddr")
      }
      if (kind === undefined) {
        throw new Error("Missing kind in naddr")
      }

      return { type: "naddr", data: { identifier, pubkey, kind, relays } }
    }
    default:
      throw new Error(`Unknown NIP-19 prefix: '${prefix}'`)
  }
}
