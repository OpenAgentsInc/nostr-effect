/**
 * NIP-28: Public Chat
 *
 * Create public chat channel events and messages.
 *
 * @example
 * ```typescript
 * import { channelCreateEvent, channelMessageEvent } from 'nostr-effect/nip28'
 *
 * // Create a channel
 * const channel = channelCreateEvent({
 *   content: { name: 'My Channel', about: 'Description', picture: '' },
 *   created_at: Math.floor(Date.now() / 1000)
 * }, privateKey)
 *
 * // Send a message
 * const message = channelMessageEvent({
 *   channel_create_event_id: channel.id,
 *   relay_url: 'wss://relay.example.com',
 *   content: 'Hello!',
 *   created_at: Math.floor(Date.now() / 1000)
 * }, privateKey)
 * ```
 */

import { finalizeEvent } from "./pure.js"
import {
  ChannelCreation,
  ChannelMetadata as KindChannelMetadata,
  ChannelMessage,
  ChannelHideMessage,
  ChannelMuteUser,
} from "./kinds.js"

/** Event type */
export interface Event {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Channel metadata */
export interface ChannelMetadata {
  name: string
  about: string
  picture: string
}

/** Template for creating a channel */
export interface ChannelCreateEventTemplate {
  /** JSON string containing ChannelMetadata as defined for Kind 40 and 41 in NIP-28. */
  content: string | ChannelMetadata
  created_at: number
  tags?: string[][]
}

/** Template for updating channel metadata */
export interface ChannelMetadataEventTemplate {
  channel_create_event_id: string
  /** JSON string containing ChannelMetadata as defined for Kind 40 and 41 in NIP-28. */
  content: string | ChannelMetadata
  created_at: number
  tags?: string[][]
}

/** Template for sending a channel message */
export interface ChannelMessageEventTemplate {
  channel_create_event_id: string
  reply_to_channel_message_event_id?: string
  relay_url: string
  content: string
  created_at: number
  tags?: string[][]
}

/** Template for hiding a channel message */
export interface ChannelHideMessageEventTemplate {
  channel_message_event_id: string
  content: string | { reason: string }
  created_at: number
  tags?: string[][]
}

/** Template for muting a user */
export interface ChannelMuteUserEventTemplate {
  content: string | { reason: string }
  created_at: number
  pubkey_to_mute: string
  tags?: string[][]
}

/**
 * Create a channel creation event (kind 40)
 */
export function channelCreateEvent(
  t: ChannelCreateEventTemplate,
  privateKey: Uint8Array
): Event | undefined {
  let content: string
  if (typeof t.content === "object") {
    content = JSON.stringify(t.content)
  } else if (typeof t.content === "string") {
    content = t.content
  } else {
    return undefined
  }

  return finalizeEvent(
    {
      kind: ChannelCreation,
      tags: [...(t.tags ?? [])],
      content: content,
      created_at: t.created_at,
    },
    privateKey
  ) as unknown as Event
}

/**
 * Create a channel metadata update event (kind 41)
 */
export function channelMetadataEvent(
  t: ChannelMetadataEventTemplate,
  privateKey: Uint8Array
): Event | undefined {
  let content: string
  if (typeof t.content === "object") {
    content = JSON.stringify(t.content)
  } else if (typeof t.content === "string") {
    content = t.content
  } else {
    return undefined
  }

  return finalizeEvent(
    {
      kind: KindChannelMetadata,
      tags: [["e", t.channel_create_event_id], ...(t.tags ?? [])],
      content: content,
      created_at: t.created_at,
    },
    privateKey
  ) as unknown as Event
}

/**
 * Create a channel message event (kind 42)
 */
export function channelMessageEvent(
  t: ChannelMessageEventTemplate,
  privateKey: Uint8Array
): Event {
  const tags: string[][] = [["e", t.channel_create_event_id, t.relay_url, "root"]]

  if (t.reply_to_channel_message_event_id) {
    tags.push(["e", t.reply_to_channel_message_event_id, t.relay_url, "reply"])
  }

  return finalizeEvent(
    {
      kind: ChannelMessage,
      tags: [...tags, ...(t.tags ?? [])],
      content: t.content,
      created_at: t.created_at,
    },
    privateKey
  ) as unknown as Event
}

/**
 * Create a channel hide message event (kind 43)
 */
export function channelHideMessageEvent(
  t: ChannelHideMessageEventTemplate,
  privateKey: Uint8Array
): Event | undefined {
  let content: string
  if (typeof t.content === "object") {
    content = JSON.stringify(t.content)
  } else if (typeof t.content === "string") {
    content = t.content
  } else {
    return undefined
  }

  return finalizeEvent(
    {
      kind: ChannelHideMessage,
      tags: [["e", t.channel_message_event_id], ...(t.tags ?? [])],
      content: content,
      created_at: t.created_at,
    },
    privateKey
  ) as unknown as Event
}

/**
 * Create a channel mute user event (kind 44)
 */
export function channelMuteUserEvent(
  t: ChannelMuteUserEventTemplate,
  privateKey: Uint8Array
): Event | undefined {
  let content: string
  if (typeof t.content === "object") {
    content = JSON.stringify(t.content)
  } else if (typeof t.content === "string") {
    content = t.content
  } else {
    return undefined
  }

  return finalizeEvent(
    {
      kind: ChannelMuteUser,
      tags: [["p", t.pubkey_to_mute], ...(t.tags ?? [])],
      content: content,
      created_at: t.created_at,
    },
    privateKey
  ) as unknown as Event
}
