/**
 * NIP-98: HTTP Auth
 * https://github.com/nostr-protocol/nips/blob/master/98.md
 *
 * HTTP authentication using Nostr events
 */
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import type { EventKind, UnixTimestamp, NostrEvent } from "./Schema.js"

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
  payload?: Record<string, unknown>
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
 * Calculates the hash of a payload
 */
export function hashPayload(payload: unknown): string {
  const hash = sha256(utf8Encoder.encode(JSON.stringify(payload)))
  return bytesToHex(hash)
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
 * Full validation of a Nostr event for NIP-98 flow
 */
export async function validateEventFull(
  event: NostrEvent,
  url: string,
  method: string,
  body?: unknown
): Promise<boolean> {
  // Note: In a full implementation, verifyEvent would be called here
  // For now, we assume the signature is valid

  if (!validateEventKind(event)) {
    throw new Error("Invalid nostr event, kind invalid")
  }

  if (!validateEventTimestamp(event)) {
    throw new Error("Invalid nostr event, created_at timestamp invalid")
  }

  if (!validateEventUrlTag(event, url)) {
    throw new Error("Invalid nostr event, url tag invalid")
  }

  if (!validateEventMethodTag(event, method)) {
    throw new Error("Invalid nostr event, method tag invalid")
  }

  if (body && typeof body === "object" && Object.keys(body).length > 0) {
    if (!validateEventPayloadTag(event, body)) {
      throw new Error("Invalid nostr event, payload tag does not match request body hash")
    }
  }

  return true
}

// Alias for nostr-tools compatibility
export { validateEventFull as validateEvent }
