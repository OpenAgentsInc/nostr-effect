/**
 * NIP-21: nostr: URI Scheme
 *
 * Provides parsing and validation for nostr: URIs.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/21.md
 */
import { decodeSync, type DecodeResult } from "./Nip19.js"

// =============================================================================
// Types
// =============================================================================

/** Regex for valid bech32 strings */
export const BECH32_REGEX = /[a-z]+1[a-z0-9]+/

/** Nostr URI regex, eg `nostr:npub1...` */
export const NOSTR_URI_REGEX = new RegExp(`nostr:(${BECH32_REGEX.source})`)

/** Full nostr URI match regex */
const NOSTR_URI_FULL_REGEX = new RegExp(`^${NOSTR_URI_REGEX.source}$`)

/** Typed nostr: URI string */
export type NostrURI = `nostr:${string}`

/** Parsed Nostr URI data */
export interface ParsedNostrURI {
  /** Full URI including the `nostr:` protocol */
  readonly uri: NostrURI
  /** The bech32-encoded data (eg `npub1...`) */
  readonly value: string
  /** Decoded bech32 string, according to NIP-19 */
  readonly decoded: DecodeResult
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Test whether the value is a valid Nostr URI
 */
export function test(value: unknown): value is NostrURI {
  return typeof value === "string" && NOSTR_URI_FULL_REGEX.test(value)
}

/**
 * Parse and decode a Nostr URI
 * @throws Error if the URI is invalid
 */
export function parse(uri: string): ParsedNostrURI {
  const match = uri.match(NOSTR_URI_FULL_REGEX)
  if (!match) {
    throw new Error(`Invalid Nostr URI: ${uri}`)
  }

  return {
    uri: match[0] as NostrURI,
    value: match[1]!,
    decoded: decodeSync(match[1]!),
  }
}

/**
 * Safely parse a Nostr URI, returning null on failure
 */
export function safeParse(uri: string): ParsedNostrURI | null {
  try {
    return parse(uri)
  } catch {
    return null
  }
}

/**
 * Extract the bech32 value from a nostr: URI
 */
export function extractBech32(uri: string): string | null {
  const match = uri.match(NOSTR_URI_REGEX)
  return match ? match[1]! : null
}
