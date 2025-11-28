/**
 * HandlerService
 *
 * NIP-89 application handler discovery and recommendation service.
 * Manages handler info (kind 31990) and recommendations (kind 31989).
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/89.md
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

/** Platform types for handler recommendations */
export type Platform = "web" | "ios" | "android" | "desktop" | string

/** A handler URL template with platform info */
export interface HandlerUrl {
  /** Platform (web, ios, android, desktop) */
  readonly platform: Platform
  /** URL template with <bech32> placeholder */
  readonly url: string
  /** NIP-19 entity type this URL handles (nevent, nprofile, etc.) */
  readonly nip19Entity?: string
}

/** Handler information (kind 31990) */
export interface HandlerInfo {
  /** Unique identifier for this handler */
  readonly identifier: string
  /** Event kinds this handler supports */
  readonly kinds: readonly number[]
  /** Handler URLs by platform */
  readonly urls: readonly HandlerUrl[]
  /** Optional metadata (name, about, picture, etc.) */
  readonly metadata?: {
    readonly name?: string
    readonly about?: string
    readonly picture?: string
    readonly nip05?: string
    readonly lud16?: string
  }
}

/** A recommendation for an app handler (kind 31989) */
export interface HandlerRecommendation {
  /** The event kind this recommendation is for */
  readonly eventKind: number
  /** Reference to handler (31990:pubkey:identifier) */
  readonly handlerAddress: string
  /** Relay hint for finding the handler */
  readonly relay?: string
  /** Platform this recommendation applies to */
  readonly platform?: Platform
}

/** Result of a handler query */
export interface HandlerQueryResult {
  /** The handler info events found */
  readonly handlers: readonly NostrEvent[]
  /** Parsed handler infos */
  readonly parsed: readonly HandlerInfo[]
}

/** Result of a recommendation query */
export interface RecommendationQueryResult {
  /** The recommendation events found */
  readonly recommendations: readonly NostrEvent[]
}

// =============================================================================
// Service Interface
// =============================================================================

export interface HandlerService {
  readonly _tag: "HandlerService"

  /**
   * Publish handler information for an application (kind 31990)
   * This announces what event kinds an app can handle
   */
  publishHandlerInfo(
    info: HandlerInfo,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /**
   * Publish a recommendation for a handler (kind 31989)
   * Users publish these to recommend apps to their followers
   */
  publishRecommendation(
    recommendation: HandlerRecommendation,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /**
   * Get handler info events for a specific event kind
   * Optionally filter by specific pubkeys (e.g., follows)
   */
  getHandlers(
    eventKind: number,
    authors?: readonly PublicKey[]
  ): Effect.Effect<HandlerQueryResult, RelayError>

  /**
   * Get recommendations for a specific event kind
   * Typically queried from user's follows
   */
  getRecommendations(
    eventKind: number,
    authors?: readonly PublicKey[]
  ): Effect.Effect<RecommendationQueryResult, RelayError>

  /**
   * Get a specific handler info by address (pubkey:identifier)
   */
  getHandlerByAddress(
    pubkey: PublicKey,
    identifier: string
  ): Effect.Effect<NostrEvent | undefined, RelayError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const HandlerService = Context.GenericTag<HandlerService>("HandlerService")

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse a kind 31990 handler info event
 */
const parseHandlerInfo = (event: NostrEvent): HandlerInfo | undefined => {
  let identifier = ""
  const kinds: number[] = []
  const urls: HandlerUrl[] = []

  for (const tag of event.tags) {
    if (tag[0] === "d" && tag[1]) {
      identifier = tag[1]
    } else if (tag[0] === "k" && tag[1]) {
      const kind = parseInt(tag[1], 10)
      if (!isNaN(kind)) {
        kinds.push(kind)
      }
    } else if (tag[0] && ["web", "ios", "android", "desktop"].includes(tag[0])) {
      const platform = tag[0] as Platform
      const url = tag[1]
      const nip19Entity = tag[2]
      if (url) {
        const handlerUrl: HandlerUrl = { platform, url }
        if (nip19Entity) {
          ;(handlerUrl as { nip19Entity?: string }).nip19Entity = nip19Entity
        }
        urls.push(handlerUrl)
      }
    }
  }

  if (!identifier) return undefined

  // Parse metadata from content if present
  let metadata: HandlerInfo["metadata"] | undefined
  if (event.content) {
    try {
      const parsed = JSON.parse(event.content)
      metadata = {
        name: parsed.name,
        about: parsed.about,
        picture: parsed.picture,
        nip05: parsed.nip05,
        lud16: parsed.lud16,
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  const result: HandlerInfo = { identifier, kinds, urls }
  if (metadata) {
    ;(result as { metadata?: HandlerInfo["metadata"] }).metadata = metadata
  }
  return result
}

/**
 * Build tags for a kind 31990 handler info event
 */
const handlerInfoToTags = (info: HandlerInfo): typeof Tag.Type[] => {
  const tags: string[][] = []

  // d tag (identifier)
  tags.push(["d", info.identifier])

  // k tags (supported kinds)
  for (const kind of info.kinds) {
    tags.push(["k", kind.toString()])
  }

  // Platform URL tags
  for (const url of info.urls) {
    if (url.nip19Entity) {
      tags.push([url.platform, url.url, url.nip19Entity])
    } else {
      tags.push([url.platform, url.url])
    }
  }

  return tags.map((t) => decodeTag(t))
}

/**
 * Build tags for a kind 31989 recommendation event
 */
const recommendationToTags = (rec: HandlerRecommendation): typeof Tag.Type[] => {
  const tags: string[][] = []

  // d tag (the event kind being recommended for)
  tags.push(["d", rec.eventKind.toString()])

  // a tag (reference to handler)
  const aTag = ["a", rec.handlerAddress]
  if (rec.relay) {
    aTag.push(rec.relay)
    if (rec.platform) {
      aTag.push(rec.platform)
    }
  } else if (rec.platform) {
    aTag.push("") // empty relay
    aTag.push(rec.platform)
  }
  tags.push(aTag)

  return tags.map((t) => decodeTag(t))
}

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  yield* CryptoService // Required dependency but not directly used

  const publishHandlerInfo: HandlerService["publishHandlerInfo"] = (info, privateKey) =>
    Effect.gen(function* () {
      const tags = handlerInfoToTags(info)

      // Content is optional metadata JSON
      const content = info.metadata ? JSON.stringify(info.metadata) : ""

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(31990),
          content,
          tags,
        },
        privateKey
      )

      return yield* relay.publish(event)
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to publish handler info: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const publishRecommendation: HandlerService["publishRecommendation"] = (
    recommendation,
    privateKey
  ) =>
    Effect.gen(function* () {
      const tags = recommendationToTags(recommendation)

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(31989),
          content: "",
          tags,
        },
        privateKey
      )

      return yield* relay.publish(event)
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to publish recommendation: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const getHandlers: HandlerService["getHandlers"] = (eventKind, authors) =>
    Effect.gen(function* () {
      const filter: Record<string, unknown> = {
        kinds: [decodeKind(31990)],
        "#k": [eventKind.toString()],
      }
      if (authors && authors.length > 0) {
        filter.authors = [...authors]
      }

      const sub = yield* relay.subscribe([decodeFilter(filter)])

      // Collect events with timeout
      const handlers: NostrEvent[] = []
      const collectEffect = sub.events.pipe(
        Stream.takeUntil(() => false), // Take until stream ends
        Stream.runForEach((event) =>
          Effect.sync(() => {
            handlers.push(event)
          })
        )
      )

      yield* Effect.race(collectEffect, Effect.sleep(1000))
      yield* sub.unsubscribe()

      // Parse handler infos
      const parsed: HandlerInfo[] = []
      for (const handler of handlers) {
        const info = parseHandlerInfo(handler)
        if (info) {
          parsed.push(info)
        }
      }

      return { handlers, parsed }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to get handlers: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const getRecommendations: HandlerService["getRecommendations"] = (eventKind, authors) =>
    Effect.gen(function* () {
      const filter: Record<string, unknown> = {
        kinds: [decodeKind(31989)],
        "#d": [eventKind.toString()],
      }
      if (authors && authors.length > 0) {
        filter.authors = [...authors]
      }

      const sub = yield* relay.subscribe([decodeFilter(filter)])

      // Collect events with timeout
      const recommendations: NostrEvent[] = []
      const collectEffect = sub.events.pipe(
        Stream.takeUntil(() => false),
        Stream.runForEach((event) =>
          Effect.sync(() => {
            recommendations.push(event)
          })
        )
      )

      yield* Effect.race(collectEffect, Effect.sleep(1000))
      yield* sub.unsubscribe()

      return { recommendations }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to get recommendations: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const getHandlerByAddress: HandlerService["getHandlerByAddress"] = (pubkey, identifier) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(31990)],
        authors: [pubkey],
        "#d": [identifier],
        limit: 1,
      })

      const sub = yield* relay.subscribe([filter])

      const maybeEventOption = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(500).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))

      yield* sub.unsubscribe()

      if (Option.isNone(maybeEventOption)) {
        return undefined
      }

      return maybeEventOption.value
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to get handler by address: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  return {
    _tag: "HandlerService" as const,
    publishHandlerInfo,
    publishRecommendation,
    getHandlers,
    getRecommendations,
    getHandlerByAddress,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for HandlerService
 * Requires RelayService, EventService, and CryptoService
 */
export const HandlerServiceLive = Layer.effect(HandlerService, make)
