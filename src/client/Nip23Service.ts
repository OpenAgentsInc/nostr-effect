/**
 * Nip23Service
 *
 * NIP-23: Long-form Content
 * Addressable event kind 30023 (with optional draft 30024), keyed by d-tag.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/23.md
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { EventKind, Filter, Tag, type NostrEvent, type PrivateKey, type PublicKey } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export interface PublishArticleOptions {
  readonly d: string
  readonly content: string
  readonly title?: string
  readonly summary?: string
  readonly image?: string
  readonly tags?: readonly string[][]
}

export interface GetArticleOptions {
  readonly author: PublicKey
  readonly d: string
}

export interface ListArticlesOptions {
  readonly author: PublicKey
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface Nip23Service {
  readonly _tag: "Nip23Service"

  publishArticle(options: PublishArticleOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  getArticle(options: GetArticleOptions): Effect.Effect<NostrEvent | null, RelayError>

  listArticles(options: ListArticlesOptions): Effect.Effect<readonly NostrEvent[], RelayError>
}

export const Nip23Service = Context.GenericTag<Nip23Service>("Nip23Service")

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const publishArticle: Nip23Service["publishArticle"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", options.d]]
      if (options.title) tags.push(["title", options.title])
      if (options.summary) tags.push(["summary", options.summary])
      if (options.image) tags.push(["image", options.image])
      if (options.tags) tags.push(...options.tags)

      const event = yield* eventService.createEvent(
        { kind: decodeKind(30023), content: options.content, tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getArticle: Nip23Service["getArticle"] = ({ author, d }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(30023)], authors: [author], "#d": [d], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listArticles: Nip23Service["listArticles"] = ({ author, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(30023)], authors: [author], limit })
      const sub = yield* relay.subscribe([filter])
      const acc: NostrEvent[] = []

      const max = limit && limit > 0 ? limit : 10
      const budget = timeoutMs && timeoutMs > 0 ? timeoutMs : 800

      const loop = Effect.gen(function* () {
        let count = 0
        while (count < max) {
          // eslint-disable-next-line no-await-in-loop
          const next = yield* Effect.race(
            sub.events.pipe(Stream.runHead),
            Effect.sleep(60).pipe(Effect.as(Option.none<NostrEvent>()))
          ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
          if (Option.isNone(next)) break
          acc.push(next.value)
          count++
        }
      })

      yield* Effect.race(loop, Effect.sleep(budget))
      yield* sub.unsubscribe()
      return acc
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "Nip23Service" as const,
    publishArticle,
    getArticle,
    listArticles,
  }
})

export const Nip23ServiceLive = Layer.effect(Nip23Service, make)

