/**
 * ChatService
 *
 * NIP-28 public chat service.
 * Manages public chat channels, messages, and client-side moderation.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/28.md
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import {
  type NostrEvent,
  type PublicKey,
  type PrivateKey,
  type EventId,
  EventKind,
  Filter,
  Tag,
  CHANNEL_CREATE_KIND,
  CHANNEL_METADATA_KIND,
  CHANNEL_MESSAGE_KIND,
  CHANNEL_HIDE_MESSAGE_KIND,
  CHANNEL_MUTE_USER_KIND,
} from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

/** Channel metadata as defined in NIP-28 */
export interface ChannelMetadata {
  /** Channel name */
  readonly name: string
  /** Channel description */
  readonly about: string
  /** URL of channel picture */
  readonly picture: string
  /** Recommended relays for channel events */
  readonly relays?: readonly string[]
}

/** Parameters for creating a channel */
export interface CreateChannelParams {
  /** Channel metadata (or JSON string) */
  readonly content: ChannelMetadata | string
  /** Optional additional tags */
  readonly tags?: readonly string[][]
}

/** Parameters for updating channel metadata */
export interface UpdateChannelMetadataParams {
  /** Event ID of the channel creation event (kind 40) */
  readonly channelCreateEventId: string
  /** Channel metadata (or JSON string) */
  readonly content: ChannelMetadata | string
  /** Optional relay URL hint for the channel */
  readonly relayUrl?: string
  /** Optional category tags */
  readonly categories?: readonly string[]
  /** Optional additional tags */
  readonly tags?: readonly string[][]
}

/** Parameters for sending a channel message */
export interface SendChannelMessageParams {
  /** Event ID of the channel creation event (kind 40) */
  readonly channelCreateEventId: string
  /** Relay URL for the channel */
  readonly relayUrl: string
  /** Message content */
  readonly content: string
  /** Optional: Reply to another message event ID */
  readonly replyToEventId?: string
  /** Optional: Pubkeys to mention in the reply */
  readonly mentionPubkeys?: readonly PublicKey[]
  /** Optional additional tags */
  readonly tags?: readonly string[][]
}

/** Parameters for hiding a message */
export interface HideMessageParams {
  /** Event ID of the channel message to hide (kind 42) */
  readonly channelMessageEventId: string
  /** Reason for hiding (or JSON string) */
  readonly content: { reason: string } | string
  /** Optional additional tags */
  readonly tags?: readonly string[][]
}

/** Parameters for muting a user */
export interface MuteUserParams {
  /** Public key of the user to mute */
  readonly pubkeyToMute: string
  /** Reason for muting (or JSON string) */
  readonly content: { reason: string } | string
  /** Optional additional tags */
  readonly tags?: readonly string[][]
}

/** Result of a channel query */
export interface ChannelResult {
  /** The channel metadata */
  readonly metadata?: ChannelMetadata
  /** The original creation event */
  readonly createEvent?: NostrEvent
  /** The latest metadata event (if any) */
  readonly metadataEvent?: NostrEvent
}

/** A channel message */
export interface ChannelMessage {
  /** The message event */
  readonly event: NostrEvent
  /** The channel this message belongs to */
  readonly channelId: EventId
  /** The message content */
  readonly content: string
  /** Reply-to event ID (if a reply) */
  readonly replyTo?: EventId
}

// =============================================================================
// Service Interface
// =============================================================================

export interface ChatService {
  readonly _tag: "ChatService"

  /**
   * Create a new public chat channel (kind 40)
   */
  createChannel(
    params: CreateChannelParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, RelayError>

  /**
   * Update channel metadata (kind 41)
   * Only the channel creator should update metadata
   */
  updateChannelMetadata(
    params: UpdateChannelMetadataParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, RelayError>

  /**
   * Send a message to a channel (kind 42)
   */
  sendMessage(
    params: SendChannelMessageParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, RelayError>

  /**
   * Hide a message - client-side moderation (kind 43)
   */
  hideMessage(
    params: HideMessageParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, RelayError>

  /**
   * Mute a user - client-side moderation (kind 44)
   */
  muteUser(
    params: MuteUserParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, RelayError>

  /**
   * Get channel information by creation event ID
   */
  getChannel(channelId: EventId): Effect.Effect<ChannelResult, RelayError>

  /**
   * Get messages from a channel
   */
  getMessages(
    channelId: EventId,
    limit?: number
  ): Effect.Effect<readonly ChannelMessage[], RelayError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const ChatService = Context.GenericTag<ChatService>("ChatService")

// =============================================================================
// Pure Helper Functions (exported for wrappers)
// =============================================================================

/**
 * Serialize content to JSON string if needed
 */
const serializeContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content
  }
  return JSON.stringify(content)
}

/**
 * Parse channel metadata from event content
 * Exported for use by wrappers
 */
export function parseChannelMetadata(content: string): ChannelMetadata | undefined {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed.name === "string" && typeof parsed.about === "string" && typeof parsed.picture === "string") {
      return parsed as ChannelMetadata
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Generic event with tags for parsing functions */
interface EventWithTags {
  readonly tags: readonly (readonly string[])[]
}

/**
 * Get the root channel ID from message event tags
 * Exported for use by wrappers
 */
export function getChannelIdFromMessage(event: EventWithTags): string | undefined {
  const rootTag = event.tags.find(
    (tag) => tag[0] === "e" && tag[3] === "root"
  )
  if (rootTag && rootTag[1]) {
    return rootTag[1]
  }
  // Fallback: first e tag
  const firstETag = event.tags.find((tag) => tag[0] === "e")
  if (firstETag && firstETag[1]) {
    return firstETag[1]
  }
  return undefined
}

/**
 * Get the reply-to event ID from message event tags
 * Exported for use by wrappers
 */
export function getReplyToFromMessage(event: EventWithTags): string | undefined {
  const replyTag = event.tags.find(
    (tag) => tag[0] === "e" && tag[3] === "reply"
  )
  if (replyTag && replyTag[1]) {
    return replyTag[1]
  }
  return undefined
}

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const createChannel: ChatService["createChannel"] = (params, privateKey) =>
    Effect.gen(function* () {
      const content = serializeContent(params.content)
      const tags = (params.tags ?? []).map((t) => decodeTag([...t]))

      const event = yield* eventService.createEvent(
        {
          kind: CHANNEL_CREATE_KIND,
          content,
          tags,
        },
        privateKey
      )

      yield* relay.publish(event)
      return event
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to create channel: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const updateChannelMetadata: ChatService["updateChannelMetadata"] = (params, privateKey) =>
    Effect.gen(function* () {
      const content = serializeContent(params.content)

      // Build tags: e tag referencing channel creation, optional category tags
      const tags: typeof Tag.Type[] = []

      // Add e tag with optional relay hint and "root" marker
      const eTag = ["e", params.channelCreateEventId]
      if (params.relayUrl) {
        eTag.push(params.relayUrl, "root")
      }
      tags.push(decodeTag(eTag))

      // Add category tags
      if (params.categories) {
        for (const category of params.categories) {
          tags.push(decodeTag(["t", category]))
        }
      }

      // Add additional tags
      if (params.tags) {
        for (const t of params.tags) {
          tags.push(decodeTag([...t]))
        }
      }

      const event = yield* eventService.createEvent(
        {
          kind: CHANNEL_METADATA_KIND,
          content,
          tags,
        },
        privateKey
      )

      yield* relay.publish(event)
      return event
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to update channel metadata: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const sendMessage: ChatService["sendMessage"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: typeof Tag.Type[] = []

      // Root e tag for the channel
      tags.push(decodeTag(["e", params.channelCreateEventId, params.relayUrl, "root"]))

      // Reply e tag if replying to a message
      if (params.replyToEventId) {
        tags.push(decodeTag(["e", params.replyToEventId, params.relayUrl, "reply"]))
      }

      // p tags for mentioned pubkeys
      if (params.mentionPubkeys) {
        for (const pubkey of params.mentionPubkeys) {
          tags.push(decodeTag(["p", pubkey, params.relayUrl]))
        }
      }

      // Additional tags
      if (params.tags) {
        for (const t of params.tags) {
          tags.push(decodeTag([...t]))
        }
      }

      const event = yield* eventService.createEvent(
        {
          kind: CHANNEL_MESSAGE_KIND,
          content: params.content,
          tags,
        },
        privateKey
      )

      yield* relay.publish(event)
      return event
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to send message: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const hideMessage: ChatService["hideMessage"] = (params, privateKey) =>
    Effect.gen(function* () {
      const content = serializeContent(params.content)

      const tags: typeof Tag.Type[] = [
        decodeTag(["e", params.channelMessageEventId]),
      ]

      if (params.tags) {
        for (const t of params.tags) {
          tags.push(decodeTag([...t]))
        }
      }

      const event = yield* eventService.createEvent(
        {
          kind: CHANNEL_HIDE_MESSAGE_KIND,
          content,
          tags,
        },
        privateKey
      )

      yield* relay.publish(event)
      return event
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to hide message: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const muteUser: ChatService["muteUser"] = (params, privateKey) =>
    Effect.gen(function* () {
      const content = serializeContent(params.content)

      const tags: typeof Tag.Type[] = [
        decodeTag(["p", params.pubkeyToMute]),
      ]

      if (params.tags) {
        for (const t of params.tags) {
          tags.push(decodeTag([...t]))
        }
      }

      const event = yield* eventService.createEvent(
        {
          kind: CHANNEL_MUTE_USER_KIND,
          content,
          tags,
        },
        privateKey
      )

      yield* relay.publish(event)
      return event
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to mute user: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const getChannel: ChatService["getChannel"] = (channelId) =>
    Effect.gen(function* () {
      // Query for channel creation event
      const createFilter = decodeFilter({
        ids: [channelId],
        kinds: [decodeKind(40)],
        limit: 1,
      })

      const createSub = yield* relay.subscribe([createFilter])
      const maybeCreateEvent = yield* Effect.race(
        createSub.events.pipe(Stream.runHead),
        Effect.sleep(500).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* createSub.unsubscribe()

      if (Option.isNone(maybeCreateEvent)) {
        return {} as ChannelResult
      }

      const createEvent = maybeCreateEvent.value
      const metadata = parseChannelMetadata(createEvent.content)

      // Query for latest metadata update
      const metadataFilter = decodeFilter({
        kinds: [decodeKind(41)],
        authors: [createEvent.pubkey],
        "#e": [channelId],
        limit: 1,
      })

      const metaSub = yield* relay.subscribe([metadataFilter])
      const maybeMetaEvent = yield* Effect.race(
        metaSub.events.pipe(Stream.runHead),
        Effect.sleep(500).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* metaSub.unsubscribe()

      const latestMetadata = Option.isSome(maybeMetaEvent)
        ? parseChannelMetadata(maybeMetaEvent.value.content) ?? metadata
        : metadata

      return {
        metadata: latestMetadata,
        createEvent,
        metadataEvent: Option.isSome(maybeMetaEvent) ? maybeMetaEvent.value : undefined,
      } as ChannelResult
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to get channel: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const getMessages: ChatService["getMessages"] = (channelId, limit = 50) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(42)],
        "#e": [channelId],
        limit,
      })

      const sub = yield* relay.subscribe([filter])

      const events: NostrEvent[] = []
      const collectEffect = sub.events.pipe(
        Stream.take(limit),
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event)
          })
        )
      )

      yield* Effect.race(
        collectEffect,
        Effect.sleep(1000)
      ).pipe(Effect.catchAll(() => Effect.void))

      yield* sub.unsubscribe()

      return events.map((event) => ({
        event,
        channelId: (getChannelIdFromMessage(event) ?? channelId) as EventId,
        content: event.content,
        replyTo: getReplyToFromMessage(event) as EventId | undefined,
      })) as readonly ChannelMessage[]
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to get messages: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  return {
    _tag: "ChatService" as const,
    createChannel,
    updateChannelMetadata,
    sendMessage,
    hideMessage,
    muteUser,
    getChannel,
    getMessages,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for ChatService
 * Requires RelayService and EventService
 */
export const ChatServiceLive = Layer.effect(ChatService, make)
