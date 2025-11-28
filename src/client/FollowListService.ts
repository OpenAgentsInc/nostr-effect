/**
 * FollowListService
 *
 * NIP-02 follow list management service.
 * Manages user's follow list as kind 3 replaceable events.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/02.md
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { CryptoService } from "../services/CryptoService.js"
import { RelayError } from "../core/Errors.js"
import {
  type NostrEvent,
  type PublicKey,
  type PrivateKey,
  EventKind,
  Filter,
  Tag,
  PublicKey as PublicKeySchema,
} from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)
const decodePublicKey = Schema.decodeSync(PublicKeySchema)

/** A single follow entry from a kind 3 event */
export interface Follow {
  /** The public key of the followed user */
  readonly pubkey: PublicKey
  /** Recommended relay URL for this user (optional) */
  readonly relay?: string
  /** Local petname/nickname for this user (optional) */
  readonly petname?: string
}

/** Result of a follow list query */
export interface FollowListResult {
  /** The list of follows */
  readonly follows: readonly Follow[]
  /** The original event, if found */
  readonly event?: NostrEvent
  /** When the follow list was last updated */
  readonly updatedAt?: number
}

// =============================================================================
// Service Interface
// =============================================================================

export interface FollowListService {
  readonly _tag: "FollowListService"

  /**
   * Get the follow list for a public key
   * Queries the relay for kind 3 events from the given author
   */
  getFollows(pubkey: PublicKey): Effect.Effect<FollowListResult, RelayError>

  /**
   * Set the complete follow list for the current user
   * Creates and publishes a new kind 3 event, replacing any existing one
   */
  setFollows(
    follows: readonly Follow[],
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /**
   * Add a follow to the current user's follow list
   * Fetches current list, adds the new follow, and publishes updated list
   */
  addFollow(
    follow: Follow,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /**
   * Remove a follow from the current user's follow list
   * Fetches current list, removes the follow, and publishes updated list
   */
  removeFollow(
    pubkeyToRemove: PublicKey,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /**
   * Check if a public key is in the follow list
   */
  isFollowing(
    ownerPubkey: PublicKey,
    targetPubkey: PublicKey
  ): Effect.Effect<boolean, RelayError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const FollowListService = Context.GenericTag<FollowListService>("FollowListService")

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse p-tags from a kind 3 event into Follow objects
 */
const parseFollowsFromEvent = (event: NostrEvent): readonly Follow[] => {
  const follows: Follow[] = []

  for (const tag of event.tags) {
    if (tag[0] === "p" && tag.length >= 2) {
      try {
        const pubkey = decodePublicKey(tag[1]!)
        const follow: Follow = { pubkey }

        // Add optional relay URL
        if (tag[2] && tag[2].length > 0) {
          (follow as { relay?: string }).relay = tag[2]
        }

        // Add optional petname
        if (tag[3] && tag[3].length > 0) {
          (follow as { petname?: string }).petname = tag[3]
        }

        follows.push(follow)
      } catch {
        // Skip invalid pubkeys
      }
    }
  }

  return follows
}

/**
 * Convert Follow objects to p-tags for a kind 3 event
 */
const followsToTags = (follows: readonly Follow[]): typeof Tag.Type[] => {
  return follows.map((follow) => {
    const tagArray: string[] = ["p", follow.pubkey]

    if (follow.relay !== undefined) {
      tagArray.push(follow.relay)
      if (follow.petname !== undefined) {
        tagArray.push(follow.petname)
      }
    } else if (follow.petname !== undefined) {
      // If petname but no relay, need empty relay slot
      tagArray.push("")
      tagArray.push(follow.petname)
    }

    return decodeTag(tagArray)
  })
}

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  const crypto = yield* CryptoService

  const getFollows: FollowListService["getFollows"] = (pubkey) =>
    Effect.gen(function* () {
      // Create filter for kind 3 from this author
      const filter = decodeFilter({
        kinds: [decodeKind(3)],
        authors: [pubkey],
        limit: 1,
      })

      // Subscribe to get events
      const sub = yield* relay.subscribe([filter])

      // Race between collecting one event and a timeout
      // For kind 3 replaceable events, we expect 0 or 1 events
      const maybeEventOption = yield* Effect.race(
        sub.events.pipe(
          Stream.runHead // Get just the first event (returns Option)
        ),
        Effect.sleep(500).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))

      yield* sub.unsubscribe()

      // If no event found, return empty list
      if (Option.isNone(maybeEventOption)) {
        return { follows: [] } as FollowListResult
      }

      const event = maybeEventOption.value
      const follows = parseFollowsFromEvent(event)

      return {
        follows,
        event,
        updatedAt: event.created_at,
      } as FollowListResult
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to get follows: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const setFollows: FollowListService["setFollows"] = (follows, privateKey) =>
    Effect.gen(function* () {
      // Create kind 3 event with p-tags
      const tags = followsToTags(follows)

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(3),
          content: "", // NIP-02 specifies content should be empty
          tags,
        },
        privateKey
      )

      // Publish to relay
      return yield* relay.publish(event)
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to set follows: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const addFollow: FollowListService["addFollow"] = (follow, privateKey) =>
    Effect.gen(function* () {
      // Get owner's public key
      const ownerPubkey = yield* crypto.getPublicKey(privateKey)

      // Get current follows
      const { follows: currentFollows } = yield* getFollows(ownerPubkey)

      // Check if already following
      if (currentFollows.some((f) => f.pubkey === follow.pubkey)) {
        // Already following, return success without change
        return { accepted: true, message: "already following" }
      }

      // Add new follow and publish
      const newFollows = [...currentFollows, follow]
      return yield* setFollows(newFollows, privateKey)
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to add follow: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const removeFollow: FollowListService["removeFollow"] = (pubkeyToRemove, privateKey) =>
    Effect.gen(function* () {
      // Get owner's public key
      const ownerPubkey = yield* crypto.getPublicKey(privateKey)

      // Get current follows
      const { follows: currentFollows } = yield* getFollows(ownerPubkey)

      // Remove the follow
      const newFollows = currentFollows.filter((f) => f.pubkey !== pubkeyToRemove)

      // If nothing changed, return success
      if (newFollows.length === currentFollows.length) {
        return { accepted: true, message: "not following" }
      }

      return yield* setFollows(newFollows, privateKey)
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to remove follow: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const isFollowing: FollowListService["isFollowing"] = (ownerPubkey, targetPubkey) =>
    Effect.gen(function* () {
      const { follows } = yield* getFollows(ownerPubkey)
      return follows.some((f) => f.pubkey === targetPubkey)
    })

  return {
    _tag: "FollowListService" as const,
    getFollows,
    setFollows,
    addFollow,
    removeFollow,
    isFollowing,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for FollowListService
 * Requires RelayService, EventService, and CryptoService
 */
export const FollowListServiceLive = Layer.effect(FollowListService, make)
