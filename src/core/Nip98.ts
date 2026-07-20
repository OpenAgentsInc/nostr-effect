/**
 * NIP-98: HTTP Auth
 * https://github.com/nostr-protocol/nips/blob/master/98.md
 *
 * HTTP authentication using Nostr events
 */
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import { schnorr } from "@noble/curves/secp256k1"
import type { EventKind, UnixTimestamp, NostrEvent } from "./Schema.js"
import { verifyEvent } from "../wrappers/pure.js"

/** Kind 27235: HTTP Auth */
export const HTTP_AUTH_KIND = 27235 as EventKind

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

const _authorizationScheme = "Nostr "

/** Event template for signing */
export interface EventTemplate {
  kind: EventKind
  tags: string[][]
  created_at: UnixTimestamp
  content: string
}

/** Signer function type */
export type SignerFunction = (event: EventTemplate) => Promise<NostrEvent> | NostrEvent

/**
 * Generate token for NIP-98 flow
 */
export async function getToken(
  loginUrl: string,
  httpMethod: string,
  sign: SignerFunction,
  includeAuthorizationScheme: boolean = false,
  payload?: unknown
): Promise<string> {
  const event: EventTemplate = {
    kind: HTTP_AUTH_KIND,
    tags: [
      ["u", loginUrl],
      ["method", httpMethod],
    ],
    created_at: Math.round(Date.now() / 1000) as UnixTimestamp,
    content: "",
  }

  if (payload) {
    event.tags.push(["payload", hashPayload(payload)])
  }

  const signedEvent = await sign(event)
  const authorizationScheme = includeAuthorizationScheme ? _authorizationScheme : ""

  return authorizationScheme + btoa(JSON.stringify(signedEvent))
}

/**
 * Validate token for NIP-98 flow
 */
export async function validateToken(token: string, url: string, method: string): Promise<boolean> {
  const event = await unpackEventFromToken(token)
  return await validateEventFull(event, url, method)
}

/**
 * Unpack an event from a token
 */
export async function unpackEventFromToken(token: string): Promise<NostrEvent> {
  if (!token) {
    throw new Error("Missing token")
  }

  token = token.replace(_authorizationScheme, "")

  const eventB64 = utf8Decoder.decode(Uint8Array.from(atob(token), (c) => c.charCodeAt(0)))
  if (!eventB64 || eventB64.length === 0 || !eventB64.startsWith("{")) {
    throw new Error("Invalid token")
  }

  const event = JSON.parse(eventB64) as NostrEvent

  return event
}

/**
 * Validates the timestamp of an event (within last 60 seconds)
 */
export function validateEventTimestamp(event: NostrEvent): boolean {
  if (!event.created_at) {
    return false
  }
  return Math.round(Date.now() / 1000) - event.created_at < 60
}

/**
 * Validates the kind of an event
 */
export function validateEventKind(event: NostrEvent): boolean {
  return event.kind === HTTP_AUTH_KIND
}

/**
 * Validates if the URL matches the URL tag of the event
 */
export function validateEventUrlTag(event: NostrEvent, url: string): boolean {
  const urlTag = event.tags.find((t) => t[0] === "u")
  if (!urlTag) {
    return false
  }
  return urlTag.length > 0 && urlTag[1] === url
}

/**
 * Validates if the method matches the method tag of the event
 */
export function validateEventMethodTag(event: NostrEvent, method: string): boolean {
  const methodTag = event.tags.find((t) => t[0] === "method")
  if (!methodTag) {
    return false
  }
  return methodTag.length > 0 && methodTag[1]?.toLowerCase() === method.toLowerCase()
}

/**
 * Hash arbitrary payload bytes (preferred for HTTP bodies).
 */
export function hashPayloadBytes(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}

/**
 * Calculates the hash of a payload for the NIP-98 `payload` tag.
 *
 * - `Uint8Array` / `ArrayBuffer`: hash raw bytes (HTTP body)
 * - `string`: hash UTF-8 bytes of the string (raw body text)
 * - other: hash `JSON.stringify(payload)` (convenience; prefer raw body when possible)
 */
export function hashPayload(payload: unknown): string {
  if (payload instanceof Uint8Array) {
    return hashPayloadBytes(payload)
  }
  if (payload instanceof ArrayBuffer) {
    return hashPayloadBytes(new Uint8Array(payload))
  }
  if (typeof payload === "string") {
    return hashPayloadBytes(utf8Encoder.encode(payload))
  }
  return hashPayloadBytes(utf8Encoder.encode(JSON.stringify(payload)))
}

/**
 * Validates the event payload tag against the provided payload
 */
export function validateEventPayloadTag(event: NostrEvent, payload: unknown): boolean {
  const payloadTag = event.tags.find((t) => t[0] === "payload")
  if (!payloadTag) {
    return false
  }
  const payloadHash = hashPayload(payload)
  return payloadTag.length > 0 && payloadTag[1] === payloadHash
}

/**
 * Verify kind/id/signature of a NIP-98 event (sync).
 */
export function verifyHttpAuthEvent(event: NostrEvent): boolean {
  if (!validateEventKind(event)) return false
  if (!event.id || !event.pubkey || !event.sig) return false
  try {
    // pure.verifyEvent mutates a verifiedSymbol; cast via unknown for brand compatibility
    return verifyEvent(event as unknown as Parameters<typeof verifyEvent>[0])
  } catch {
    try {
      return schnorr.verify(event.sig, event.id, event.pubkey)
    } catch {
      return false
    }
  }
}

/**
 * Full validation of a Nostr event for NIP-98 flow.
 * Verifies signature, kind, timestamp window, URL, method, and optional payload hash.
 *
 * @param body - Prefer raw request body as `Uint8Array` or `string` for payload checks
 * @param options.maxSkewSeconds - Allowed age of created_at (default 60)
 */
export async function validateEventFull(
  event: NostrEvent,
  url: string,
  method: string,
  body?: unknown,
  options?: { maxSkewSeconds?: number }
): Promise<boolean> {
  if (!verifyHttpAuthEvent(event)) {
    throw new Error("Invalid nostr event, signature invalid")
  }

  if (!validateEventKind(event)) {
    throw new Error("Invalid nostr event, kind invalid")
  }

  const maxSkew = options?.maxSkewSeconds ?? 60
  if (!event.created_at || Math.round(Date.now() / 1000) - event.created_at >= maxSkew) {
    throw new Error("Invalid nostr event, created_at timestamp invalid")
  }

  if (!validateEventUrlTag(event, url)) {
    throw new Error("Invalid nostr event, url tag invalid")
  }

  if (!validateEventMethodTag(event, method)) {
    throw new Error("Invalid nostr event, method tag invalid")
  }

  if (body !== undefined && body !== null) {
    const emptyObject =
      typeof body === "object" &&
      !(body instanceof Uint8Array) &&
      !(body instanceof ArrayBuffer) &&
      Object.keys(body as object).length === 0
    if (!emptyObject && !validateEventPayloadTag(event, body)) {
      throw new Error("Invalid nostr event, payload tag does not match request body hash")
    }
  }

  return true
}

// Alias for nostr-tools compatibility
export { validateEventFull as validateEvent }
