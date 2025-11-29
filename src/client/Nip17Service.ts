/**
 * NIP-17: Private Direct Messages
 *
 * Encrypted chat using NIP-44 encryption and NIP-59 seals/gift wraps.
 * Provides deniable, metadata-protected private messaging.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/17.md
 */
import { Context, Effect, Layer, Stream, Chunk } from "effect"
import { Schema } from "@effect/schema"
import type { EventKind, PublicKey, PrivateKey, NostrEvent } from "../core/Schema.js"
import { Filter } from "../core/Schema.js"
import { unwrapEvent, wrapManyEvents, type Rumor, type GiftWrappedEvent, type UnsignedEvent } from "../core/Nip59.js"
import { ConnectionError, SubscriptionError } from "../core/Errors.js"
import { RelayPool } from "./RelayPool.js"

// =============================================================================
// Event Kinds
// =============================================================================

/** Kind 14: Chat message */
export const CHAT_MESSAGE_KIND = 14 as EventKind

/** Kind 15: File message */
export const FILE_MESSAGE_KIND = 15 as EventKind

/** Kind 10050: DM inbox relays */
export const DM_INBOX_RELAYS_KIND = 10050 as EventKind

// =============================================================================
// Types
// =============================================================================

/** Chat message tag types */
export interface ChatMessageTags {
  readonly receivers: readonly PublicKey[]
  readonly relayHint?: string
  readonly replyTo?: string
  readonly subject?: string
  readonly quotes?: readonly { readonly eventId: string; readonly relayUrl?: string; readonly pubkey?: string }[]
}

/** File message metadata */
export interface FileMetadata {
  readonly url: string
  readonly fileType: string
  readonly encryptionAlgorithm: "aes-gcm"
  readonly decryptionKey: string
  readonly decryptionNonce: string
  readonly hash: string
  readonly originalHash?: string
  readonly size?: number
  readonly dimensions?: string
  readonly blurhash?: string
  readonly thumbnail?: string
  readonly fallback?: readonly string[]
}

/** File message tags */
export interface FileMessageTags extends Omit<ChatMessageTags, "quotes"> {
  readonly file: FileMetadata
}

/** DM inbox relay list */
export interface DMInboxRelays {
  readonly relays: readonly string[]
}

// =============================================================================
// Service Interface
// =============================================================================

export interface Nip17Service {
  readonly _tag: "Nip17Service"

  /**
   * Create a chat message (kind 14)
   */
  createChatMessage(
    content: string,
    receivers: readonly PublicKey[],
    options?: {
      readonly subject?: string
      readonly replyTo?: string
      readonly quotes?: readonly { readonly eventId: string; readonly relayUrl?: string; readonly pubkey?: string }[]
      readonly relayHint?: string
    }
  ): Effect.Effect<UnsignedEvent>

  /**
   * Create a file message (kind 15)
   */
  createFileMessage(
    file: FileMetadata,
    receivers: readonly PublicKey[],
    options?: {
      readonly subject?: string
      readonly replyTo?: string
      readonly relayHint?: string
    }
  ): Effect.Effect<UnsignedEvent>

  /**
   * Send an encrypted DM to recipients
   * Wraps the message using NIP-59 and publishes to recipient relays
   */
  sendEncryptedDM(
    message: UnsignedEvent,
    senderPrivateKey: PrivateKey,
    receiverPublicKeys: readonly PublicKey[],
    recipientRelays?: readonly string[]
  ): Effect.Effect<void, ConnectionError>

  /**
   * Receive and unwrap an encrypted DM
   */
  receiveEncryptedDM(wrap: GiftWrappedEvent, recipientPrivateKey: PrivateKey): Effect.Effect<Rumor, ConnectionError>

  /**
   * Create a DM inbox relays event (kind 10050)
   */
  createDMInboxRelays(relays: readonly string[]): Effect.Effect<UnsignedEvent>

  /**
   * Fetch a user's DM inbox relays
   */
  fetchDMInboxRelays(publicKey: PublicKey): Effect.Effect<readonly string[], ConnectionError | SubscriptionError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const Nip17Service = Context.GenericTag<Nip17Service>("Nip17Service")

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const pool = yield* RelayPool

  const createChatMessage: Nip17Service["createChatMessage"] = (content, receivers, options) =>
    Effect.sync(() => {
      const tags: (readonly string[])[] = []

      // Add p tags for receivers
      for (const receiver of receivers) {
        tags.push(["p", receiver, options?.relayHint ?? ""])
      }

      // Add reply tag if present
      if (options?.replyTo) {
        tags.push(["e", options.replyTo, options.relayHint ?? ""])
      }

      // Add subject tag if present
      if (options?.subject) {
        tags.push(["subject", options.subject])
      }

      // Add quote tags if present
      if (options?.quotes) {
        for (const quote of options.quotes) {
          const qTag = ["q", quote.eventId]
          if (quote.relayUrl) qTag.push(quote.relayUrl)
          if (quote.pubkey) qTag.push(quote.pubkey)
          tags.push(qTag)
        }
      }

      return {
        kind: CHAT_MESSAGE_KIND,
        content,
        tags,
      }
    })

  const createFileMessage: Nip17Service["createFileMessage"] = (file, receivers, options) =>
    Effect.sync(() => {
      const tags: (readonly string[])[] = []

      // Add p tags for receivers
      for (const receiver of receivers) {
        tags.push(["p", receiver, options?.relayHint ?? ""])
      }

      // Add reply tag if present
      if (options?.replyTo) {
        tags.push(["e", options.replyTo, options.relayHint ?? "", "reply"])
      }

      // Add subject tag if present
      if (options?.subject) {
        tags.push(["subject", options.subject])
      }

      // Add file metadata tags
      tags.push(["file-type", file.fileType])
      tags.push(["encryption-algorithm", file.encryptionAlgorithm])
      tags.push(["decryption-key", file.decryptionKey])
      tags.push(["decryption-nonce", file.decryptionNonce])
      tags.push(["x", file.hash])

      if (file.originalHash) {
        tags.push(["ox", file.originalHash])
      }

      if (file.size) {
        tags.push(["size", file.size.toString()])
      }

      if (file.dimensions) {
        tags.push(["dim", file.dimensions])
      }

      if (file.blurhash) {
        tags.push(["blurhash", file.blurhash])
      }

      if (file.thumbnail) {
        tags.push(["thumb", file.thumbnail])
      }

      if (file.fallback) {
        for (const fallbackUrl of file.fallback) {
          tags.push(["fallback", fallbackUrl])
        }
      }

      return {
        kind: FILE_MESSAGE_KIND,
        content: file.url,
        tags,
      }
    })

  const sendEncryptedDM: Nip17Service["sendEncryptedDM"] = (message, senderPrivateKey, receiverPublicKeys, recipientRelays) =>
    Effect.gen(function* () {
      // Convert sender private key to bytes
      const senderKeyBytes = Uint8Array.from(Buffer.from(senderPrivateKey, "hex"))

      // Wrap the message for all recipients (including sender for history)
      const wrappedEvents = wrapManyEvents(message, senderKeyBytes, receiverPublicKeys)

      // If no specific relays provided, use connected relays
      const relaysToUse = recipientRelays && recipientRelays.length > 0
        ? recipientRelays
        : yield* pool.getConnectedRelays()

      if (relaysToUse.length === 0) {
        yield* Effect.fail(
          new ConnectionError({
            message: "No relays available for publishing. Connect to relays first or provide recipient relays.",
            url: "nip17",
          })
        )
      }

      // Publish each wrapped event to the pool
      for (const wrapped of wrappedEvents) {
        // Convert GiftWrappedEvent to NostrEvent for publishing
        const event: NostrEvent = wrapped as unknown as NostrEvent
        yield* pool.publish(event)
      }
    })

  const receiveEncryptedDM: Nip17Service["receiveEncryptedDM"] = (wrap, recipientPrivateKey) =>
    Effect.try({
      try: () => {
        const recipientKeyBytes = Uint8Array.from(Buffer.from(recipientPrivateKey, "hex"))
        return unwrapEvent(wrap, recipientKeyBytes)
      },
      catch: (error) =>
        new ConnectionError({
          message: `Failed to unwrap DM: ${error instanceof Error ? error.message : String(error)}`,
          url: "nip17",
        }),
    })

  const createDMInboxRelays: Nip17Service["createDMInboxRelays"] = (relays) =>
    Effect.sync(() => {
      const tags: (readonly string[])[] = relays.map((relay) => ["relay", relay])

      return {
        kind: DM_INBOX_RELAYS_KIND,
        content: "",
        tags,
      }
    })

  const fetchDMInboxRelays: Nip17Service["fetchDMInboxRelays"] = (publicKey) =>
    Effect.gen(function* () {
      // Subscribe to kind 10050 events for the given public key
      const decodeFilter = Schema.decodeSync(Filter)
      const filter = decodeFilter({
        kinds: [DM_INBOX_RELAYS_KIND],
        authors: [publicKey],
        limit: 1,
      })

      const sub = yield* pool.subscribe([filter])

      // Collect the first event (most recent)
      const chunk = yield* Stream.runCollect(
        sub.events.pipe(Stream.take(1), Stream.timeout("5 seconds"))
      ).pipe(Effect.catchAll(() => Effect.succeed(Chunk.empty()))) // Handle timeout

      yield* sub.unsubscribe()

      // Convert Chunk to array
      const events = Chunk.toReadonlyArray(chunk)

      // Extract relay URLs from the event tags
      const relays: string[] = []
      for (const event of events) {
        for (const tag of event.tags) {
          if (tag[0] === "relay" && tag[1]) {
            relays.push(tag[1])
          }
        }
      }

      return relays
    })

  return {
    _tag: "Nip17Service" as const,
    createChatMessage,
    createFileMessage,
    sendEncryptedDM,
    receiveEncryptedDM,
    createDMInboxRelays,
    fetchDMInboxRelays,
  }
})

// =============================================================================
// Layer
// =============================================================================

export const Nip17ServiceLive = Layer.effect(Nip17Service, make)
