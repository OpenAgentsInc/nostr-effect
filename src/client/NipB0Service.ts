/**
 * NipB0Service
 *
 * NIP-B0: Web Bookmarking (kind 39701)
 * Parameterized replaceable by d-tag (URL without scheme).
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { EventKind, Filter, Tag, type NostrEvent, type PrivateKey } from "../core/Schema.js"

export const BOOKMARK_KIND = 39701

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

const toDTag = (url: string): string => {
  const trimmed = url.trim()
  const withoutScheme = trimmed.replace(/^https?:\/\//i, "")
  return withoutScheme.endsWith("/") ? withoutScheme.slice(0, -1) : withoutScheme
}

export interface PublishBookmarkParams {
  readonly url: string
  readonly title?: string
  readonly publishedAt?: number // unix seconds
  readonly topics?: readonly string[] // t-tags
  readonly content?: string // description (optional)
  readonly extraTags?: readonly string[][]
  readonly createdAt?: number // unix seconds; for tests/determinism
}

export interface QueryParams {
  readonly authors?: readonly string[]
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface NipB0Service {
  readonly _tag: "NipB0Service"

  publishBookmark(params: PublishBookmarkParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  getByUrl(url: string, author?: string, timeoutMs?: number): Effect.Effect<NostrEvent | null, RelayError>
  listByTopic(topic: string, params?: QueryParams): Effect.Effect<readonly NostrEvent[], RelayError>
}

export const NipB0Service = Context.GenericTag<NipB0Service>("NipB0Service")

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const publishBookmark: NipB0Service["publishBookmark"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", toDTag(params.url)]]
      if (typeof params.publishedAt === "number") tags.push(["published_at", String(params.publishedAt)])
      if (params.title) tags.push(["title", params.title])
      if (params.topics) for (const t of params.topics) tags.push(["t", t])
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))

      const ev = yield* events.createEvent(
        {
          kind: decodeKind(BOOKMARK_KIND),
          content: params.content ?? "",
          tags: tags.map((t) => decodeTag(t)),
          created_at: (params.createdAt ?? undefined) as any,
        },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getByUrl: NipB0Service["getByUrl"] = (url, author, timeoutMs) =>
    Effect.gen(function* () {
      const base: any = { kinds: [decodeKind(BOOKMARK_KIND)], "#d": [toDTag(url)], limit: 1 }
      if (author) base.authors = [author]
      const filter = decodeFilter(base)
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listByTopic: NipB0Service["listByTopic"] = (topic, { authors, limit, timeoutMs } = {}) =>
    Effect.gen(function* () {
      const base: any = { kinds: [decodeKind(BOOKMARK_KIND)], "#t": [topic] }
      if (authors && authors.length > 0) base.authors = authors
      if (limit) base.limit = limit
      const filter = decodeFilter(base)
      const sub = yield* relay.subscribe([filter])
      const results: NostrEvent[] = []
      const collect = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(timeoutMs ?? 500).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
        if (Option.isSome(next)) results.push(next.value)
      })
      const n = limit ?? 1
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collect
      }
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "NipB0Service" as const,
    publishBookmark,
    getByUrl,
    listByTopic,
  }
})

export const NipB0ServiceLive = Layer.effect(NipB0Service, make)
