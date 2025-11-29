/**
 * NIP-17: Private Direct Messages
 * https://github.com/nostr-protocol/nips/blob/master/17.md
 *
 * Private direct messages using NIP-59 gift wrap
 */
import * as nip59 from "./Nip59.js"
import type { EventKind, UnixTimestamp, EventId, Signature, PublicKey } from "./Schema.js"

/** Kind 14: Private Direct Message */
export const PRIVATE_DIRECT_MESSAGE_KIND = 14 as EventKind

/** Recipient with optional relay URL */
export interface Recipient {
  publicKey: string
  relayUrl?: string
}

/** Reply reference */
export interface ReplyTo {
  eventId: string
  relayUrl?: string
}

/** Unsigned event template for creating events */
interface EventTemplate {
  created_at: UnixTimestamp
  kind: EventKind
  tags: string[][]
  content: string
}

function createEvent(
  recipients: Recipient | Recipient[],
  message: string,
  conversationTitle?: string,
  replyTo?: ReplyTo
): EventTemplate {
  const baseEvent: EventTemplate = {
    created_at: Math.ceil(Date.now() / 1000) as UnixTimestamp,
    kind: PRIVATE_DIRECT_MESSAGE_KIND,
    tags: [],
    content: message,
  }

  const recipientsArray = Array.isArray(recipients) ? recipients : [recipients]

  recipientsArray.forEach(({ publicKey, relayUrl }) => {
    baseEvent.tags.push(relayUrl ? ["p", publicKey, relayUrl] : ["p", publicKey])
  })

  if (replyTo) {
    baseEvent.tags.push(["e", replyTo.eventId, replyTo.relayUrl || "", "reply"])
  }

  if (conversationTitle) {
    baseEvent.tags.push(["subject", conversationTitle])
  }

  return baseEvent
}

/** Gift-wrapped event structure */
export interface GiftWrappedEvent {
  readonly id: EventId
  readonly pubkey: PublicKey
  readonly created_at: UnixTimestamp
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly sig: Signature
}

/** Unwrapped rumor structure */
export interface Rumor {
  readonly id: EventId
  readonly pubkey: PublicKey
  readonly created_at: UnixTimestamp
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
}

/**
 * Wrap a private direct message for a single recipient
 */
export function wrapEvent(
  senderPrivateKey: Uint8Array,
  recipient: Recipient,
  message: string,
  conversationTitle?: string,
  replyTo?: ReplyTo
): GiftWrappedEvent {
  const event = createEvent(recipient, message, conversationTitle, replyTo)
  return nip59.wrapEvent(event, senderPrivateKey, recipient.publicKey) as unknown as GiftWrappedEvent
}

/**
 * Wrap a private direct message for multiple recipients (including sender)
 */
export function wrapManyEvents(
  senderPrivateKey: Uint8Array,
  recipients: Recipient[],
  message: string,
  conversationTitle?: string,
  replyTo?: ReplyTo
): GiftWrappedEvent[] {
  if (!recipients || recipients.length === 0) {
    throw new Error("At least one recipient is required.")
  }

  // Wrap for sender and then for each recipient
  return [{ publicKey: getPublicKeyFromPrivate(senderPrivateKey) }, ...recipients].map((recipient) =>
    wrapEvent(senderPrivateKey, recipient, message, conversationTitle, replyTo)
  )
}

// Helper to get public key from private key
import { schnorr } from "@noble/curves/secp256k1"
import { bytesToHex } from "@noble/hashes/utils"

function getPublicKeyFromPrivate(privateKey: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(privateKey))
}

/**
 * Unwrap a private direct message
 */
export const unwrapEvent = nip59.unwrapEvent as (
  wrap: GiftWrappedEvent,
  recipientPrivateKey: Uint8Array
) => Rumor

/**
 * Unwrap multiple private direct messages
 */
export const unwrapManyEvents = nip59.unwrapManyEvents as (
  wrappedEvents: readonly GiftWrappedEvent[],
  recipientPrivateKey: Uint8Array
) => readonly Rumor[]
