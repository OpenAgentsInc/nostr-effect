/**
 * NIP-28 Module
 *
 * Public Chat - channel creation, messages, and client-side moderation.
 * This module primarily advertises NIP-28 support in relay info.
 * The actual event handling is done by standard event storage.
 *
 * Event kinds:
 * - 40: Channel creation
 * - 41: Channel metadata update
 * - 42: Channel message
 * - 43: Hide message (client-side moderation)
 * - 44: Mute user (client-side moderation)
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/28.md
 */
import { type NipModule, createModule } from "../NipModule.js"
import {
  CHANNEL_CREATE_KIND,
  CHANNEL_METADATA_KIND,
  CHANNEL_MESSAGE_KIND,
  CHANNEL_HIDE_MESSAGE_KIND,
  CHANNEL_MUTE_USER_KIND,
} from "../../../../core/Schema.js"

// =============================================================================
// Module
// =============================================================================

/**
 * NIP-28 Module for public chat support
 *
 * This module:
 * - Advertises NIP-28 support in relay info
 * - Handles kinds 40-44 (channel events)
 *
 * Note: NIP-28 is primarily client-side. The relay stores events normally.
 * Kind 41 (metadata) events don't need special replacement logic since
 * they reference the original kind 40 event via e-tag, not by kind alone.
 */
export const Nip28Module: NipModule = createModule({
  id: "nip-28",
  nips: [28],
  description: "Public Chat: channel creation, messages, and moderation",
  kinds: [
    CHANNEL_CREATE_KIND as number,
    CHANNEL_METADATA_KIND as number,
    CHANNEL_MESSAGE_KIND as number,
    CHANNEL_HIDE_MESSAGE_KIND as number,
    CHANNEL_MUTE_USER_KIND as number,
  ],
  // No special policies needed - standard event validation applies
  policies: [],
  // No special hooks needed - events are stored normally
})
