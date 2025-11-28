/**
 * NIP-16 Module
 *
 * Event treatment - replaceable and ephemeral events.
 * Includes NIP-33 for parameterized replaceable events.
 */
import { Effect } from "effect"
import { type NipModule, createModule } from "../NipModule.js"
import {
  isReplaceableKind,
  isEphemeralKind,
  isParameterizedReplaceableKind,
  getDTagValue,
} from "../../../../core/Schema.js"

// =============================================================================
// Module
// =============================================================================

/**
 * NIP-16/33 Module for replaceable and parameterized replaceable events
 *
 * Replaceable events (kinds 0, 3, 10000-19999):
 * - Only the latest event per pubkey+kind is kept
 *
 * Parameterized replaceable events (kinds 30000-39999):
 * - Only the latest event per pubkey+kind+d-tag is kept
 *
 * Ephemeral events (kinds 20000-29999):
 * - Not stored, only broadcast to subscribers
 */
export const Nip16Module: NipModule = createModule({
  id: "nip-16",
  nips: [16, 33],
  description: "Event treatment: replaceable, parameterized replaceable, and ephemeral events",
  kinds: [], // We check kind ranges in the hook

  preStoreHook: (event) =>
    Effect.sync(() => {
      // Ephemeral events - don't store, just broadcast
      if (isEphemeralKind(event.kind)) {
        // For now, we still store ephemeral events but they could be filtered
        // In a full implementation, we'd return a special "broadcast-only" action
        return { action: "store", event } as const
      }

      // Replaceable events - delete old, store new
      if (isReplaceableKind(event.kind)) {
        return {
          action: "replace",
          event,
          deleteFilter: {
            kinds: [event.kind] as readonly number[],
            authors: [event.pubkey] as readonly string[],
          },
        } as const
      }

      // Parameterized replaceable events - delete old with same d-tag
      if (isParameterizedReplaceableKind(event.kind)) {
        const dTag = getDTagValue(event) ?? "" // Default to empty string for d-tag
        return {
          action: "replace",
          event,
          deleteFilter: {
            kinds: [event.kind] as readonly number[],
            authors: [event.pubkey] as readonly string[],
            dTag,
          },
        } as const
      }

      // Regular events - just store
      return { action: "store", event } as const
    }),
})
