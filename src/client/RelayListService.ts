/**
 * RelayListService
 *
 * NIP-65 relay list metadata management service.
 * Manages user's relay preferences as kind 10002 replaceable events.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/65.md
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
} from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

/** Relay usage mode */
export type RelayMode = "read" | "write" | "both"

/** A single relay entry from a kind 10002 event */
export interface RelayEntry {
  /** The relay URL */
  readonly url: string
  /** Usage mode: read, write, or both (default) */
  readonly mode: RelayMode
}

/** Result of a relay list query */
export interface RelayListResult {
  /** The list of relay entries */
  readonly relays: readonly RelayEntry[]
  /** The original event, if found */
  readonly event?: NostrEvent
  /** When the relay list was last updated */
  readonly updatedAt?: number
}

// =============================================================================
// Service Interface
// =============================================================================

export interface RelayListService {
  readonly _tag: "RelayListService"

  /**
   * Get the relay list for a public key
   * Queries the relay for kind 10002 events from the given author
   */
  getRelayList(pubkey: PublicKey): Effect.Effect<RelayListResult, RelayError>

  /**
   * Set the complete relay list for the current user
   * Creates and publishes a new kind 10002 event, replacing any existing one
   */
  setRelayList(
    relays: readonly RelayEntry[],
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /**
   * Add a relay to the current user's relay list
   * Fetches current list, adds the new relay, and publishes updated list
   */
  addRelay(
    relay: RelayEntry,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /**
   * Remove a relay from the current user's relay list
   * Fetches current list, removes the relay, and publishes updated list
   */
  removeRelay(
    urlToRemove: string,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /**
   * Get only read relays from the relay list
   */
  getReadRelays(pubkey: PublicKey): Effect.Effect<readonly string[], RelayError>

  /**
   * Get only write relays from the relay list
   */
  getWriteRelays(pubkey: PublicKey): Effect.Effect<readonly string[], RelayError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const RelayListService = Context.GenericTag<RelayListService>("RelayListService")

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse r-tags from a kind 10002 event into RelayEntry objects
 */
const parseRelaysFromEvent = (event: NostrEvent): readonly RelayEntry[] => {
  const relays: RelayEntry[] = []

  for (const tag of event.tags) {
    if (tag[0] === "r" && tag.length >= 2) {
      const url = tag[1]
      if (!url || url.length === 0) continue

      let mode: RelayMode = "both"
      if (tag[2] === "read") {
        mode = "read"
      } else if (tag[2] === "write") {
        mode = "write"
      }

      relays.push({ url, mode })
    }
  }

  return relays
}

/**
 * Convert RelayEntry objects to r-tags for a kind 10002 event
 */
const relaysToTags = (relays: readonly RelayEntry[]): typeof Tag.Type[] => {
  return relays.map((relay) => {
    const tagArray: string[] = ["r", relay.url]

    // Only add marker if not "both" (default)
    if (relay.mode !== "both") {
      tagArray.push(relay.mode)
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

  const getRelayList: RelayListService["getRelayList"] = (pubkey) =>
    Effect.gen(function* () {
      // Create filter for kind 10002 from this author
      const filter = decodeFilter({
        kinds: [decodeKind(10002)],
        authors: [pubkey],
        limit: 1,
      })

      // Subscribe to get events
      const sub = yield* relay.subscribe([filter])

      // Race between collecting one event and a timeout
      // For kind 10002 replaceable events, we expect 0 or 1 events
      const maybeEventOption = yield* Effect.race(
        sub.events.pipe(
          Stream.runHead // Get just the first event (returns Option)
        ),
        Effect.sleep(500).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))

      yield* sub.unsubscribe()

      // If no event found, return empty list
      if (Option.isNone(maybeEventOption)) {
        return { relays: [] } as RelayListResult
      }

      const event = maybeEventOption.value
      const relays = parseRelaysFromEvent(event)

      return {
        relays,
        event,
        updatedAt: event.created_at,
      } as RelayListResult
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to get relay list: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const setRelayList: RelayListService["setRelayList"] = (relays, privateKey) =>
    Effect.gen(function* () {
      // Create kind 10002 event with r-tags
      const tags = relaysToTags(relays)

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(10002),
          content: "", // NIP-65 specifies content should be empty
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
            message: `Failed to set relay list: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const addRelay: RelayListService["addRelay"] = (newRelay, privateKey) =>
    Effect.gen(function* () {
      // Get owner's public key
      const ownerPubkey = yield* crypto.getPublicKey(privateKey)

      // Get current relays
      const { relays: currentRelays } = yield* getRelayList(ownerPubkey)

      // Check if already exists (by URL)
      const existingIndex = currentRelays.findIndex((r) => r.url === newRelay.url)
      if (existingIndex !== -1) {
        // Update mode if different, otherwise return success
        const existing = currentRelays[existingIndex]!
        if (existing.mode === newRelay.mode) {
          return { accepted: true, message: "relay already exists" }
        }
        // Replace with new mode
        const updatedRelays = currentRelays.map((r, i) =>
          i === existingIndex ? newRelay : r
        )
        return yield* setRelayList(updatedRelays, privateKey)
      }

      // Add new relay and publish
      const newRelays = [...currentRelays, newRelay]
      return yield* setRelayList(newRelays, privateKey)
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to add relay: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const removeRelay: RelayListService["removeRelay"] = (urlToRemove, privateKey) =>
    Effect.gen(function* () {
      // Get owner's public key
      const ownerPubkey = yield* crypto.getPublicKey(privateKey)

      // Get current relays
      const { relays: currentRelays } = yield* getRelayList(ownerPubkey)

      // Remove the relay
      const newRelays = currentRelays.filter((r) => r.url !== urlToRemove)

      // If nothing changed, return success
      if (newRelays.length === currentRelays.length) {
        return { accepted: true, message: "relay not in list" }
      }

      return yield* setRelayList(newRelays, privateKey)
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to remove relay: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const getReadRelays: RelayListService["getReadRelays"] = (pubkey) =>
    Effect.gen(function* () {
      const { relays } = yield* getRelayList(pubkey)
      return relays
        .filter((r) => r.mode === "read" || r.mode === "both")
        .map((r) => r.url)
    })

  const getWriteRelays: RelayListService["getWriteRelays"] = (pubkey) =>
    Effect.gen(function* () {
      const { relays } = yield* getRelayList(pubkey)
      return relays
        .filter((r) => r.mode === "write" || r.mode === "both")
        .map((r) => r.url)
    })

  return {
    _tag: "RelayListService" as const,
    getRelayList,
    setRelayList,
    addRelay,
    removeRelay,
    getReadRelays,
    getWriteRelays,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for RelayListService
 * Requires RelayService, EventService, and CryptoService
 */
export const RelayListServiceLive = Layer.effect(RelayListService, make)
