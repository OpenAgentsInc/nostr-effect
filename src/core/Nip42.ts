/**
 * NIP-42: Authentication of clients to relays
 * https://github.com/nostr-protocol/nips/blob/master/42.md
 *
 * Client-side auth event creation
 */
import type { EventKind, UnixTimestamp } from "./Schema.js"

/** Kind 22242: Client Authentication */
export const CLIENT_AUTH_KIND = 22242 as EventKind

/** Event template for signing */
export interface EventTemplate {
  kind: EventKind
  created_at: UnixTimestamp
  tags: string[][]
  content: string
}

/**
 * Creates an EventTemplate for an AUTH event to be signed
 * @param relayURL - The URL of the relay
 * @param challenge - The challenge string from the relay
 */
export function makeAuthEvent(relayURL: string, challenge: string): EventTemplate {
  return {
    kind: CLIENT_AUTH_KIND,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    tags: [
      ["relay", relayURL],
      ["challenge", challenge],
    ],
    content: "",
  }
}
