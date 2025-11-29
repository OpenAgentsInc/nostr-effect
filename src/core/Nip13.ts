/**
 * NIP-13: Proof of Work
 * https://github.com/nostr-protocol/nips/blob/master/13.md
 *
 * Proof of Work for Nostr events. Uses leading zero bits in event ID
 * as difficulty measure.
 */
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import type { EventId, PublicKey, UnixTimestamp, EventKind } from "./Schema.js"

/**
 * Event template for mining (without id/sig)
 */
export interface UnsignedEvent {
  readonly pubkey: PublicKey
  readonly created_at: UnixTimestamp
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
}

/**
 * Event with id but no signature (result of mining)
 */
export interface MinedEvent extends UnsignedEvent {
  readonly id: EventId
}

const utf8Encoder = new TextEncoder()

/**
 * Get POW difficulty from a Nostr hex ID.
 * Counts leading zero bits.
 */
export function getPow(hex: string): number {
  let count = 0

  for (let i = 0; i < 64; i += 8) {
    const nibble = parseInt(hex.substring(i, i + 8), 16)
    if (nibble === 0) {
      count += 32
    } else {
      count += Math.clz32(nibble)
      break
    }
  }

  return count
}

/**
 * Fast event hash without full serialization overhead
 */
export function fastEventHash(evt: UnsignedEvent): string {
  return bytesToHex(
    sha256(
      utf8Encoder.encode(
        JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content])
      )
    )
  )
}

/**
 * Mine an event with the desired POW difficulty.
 * This function is synchronous and CPU-intensive.
 * Should be run in a worker for large difficulty values.
 *
 * @param unsigned - The unsigned event template
 * @param difficulty - Target number of leading zero bits
 * @returns Event with id meeting difficulty requirement
 */
export function minePow(unsigned: UnsignedEvent, difficulty: number): MinedEvent {
  let count = 0

  // Create mutable copy for mining
  const mutableTags = unsigned.tags.map((t) => [...t])
  const tag = ["nonce", count.toString(), difficulty.toString()]
  mutableTags.push(tag)

  const event = {
    pubkey: unsigned.pubkey,
    kind: unsigned.kind,
    content: unsigned.content,
    created_at: unsigned.created_at,
    tags: mutableTags,
  }

  let id: string

  while (true) {
    const now = Math.floor(Date.now() / 1000) as UnixTimestamp

    if (now !== event.created_at) {
      count = 0
      event.created_at = now
    }

    tag[1] = (++count).toString()

    id = fastEventHash(event as UnsignedEvent)

    if (getPow(id) >= difficulty) {
      break
    }
  }

  return {
    pubkey: event.pubkey as PublicKey,
    created_at: event.created_at as UnixTimestamp,
    kind: event.kind as EventKind,
    tags: event.tags as readonly (readonly string[])[],
    content: event.content,
    id: id as EventId,
  }
}

/**
 * Verify that an event meets a minimum POW difficulty
 */
export function verifyPow(eventId: string, minDifficulty: number): boolean {
  return getPow(eventId) >= minDifficulty
}

/**
 * Extract the claimed difficulty from a nonce tag
 */
export function getClaimedDifficulty(tags: readonly (readonly string[])[]): number | undefined {
  const nonceTag = tags.find((t) => t[0] === "nonce")
  if (!nonceTag || nonceTag.length < 3) return undefined
  const diffStr = nonceTag[2]
  if (!diffStr) return undefined
  const difficulty = parseInt(diffStr, 10)
  return isNaN(difficulty) ? undefined : difficulty
}
