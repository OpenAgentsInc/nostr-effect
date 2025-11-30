/**
 * Nip7DService
 *
 * NIP-7D: Threads
 * - Thread (kind 11) with optional title tag
 * - Replies MUST use NIP-22 (kind 1111) comments pointing to the root
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { EventKind, Filter, Tag, type NostrEvent, type PrivateKey } from "../core/Schema.js"

const THREAD_KIND = 11
const COMMENT_KIND = 1111 // NIP-22

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export interface PublishThreadParams {
  readonly content: string
  readonly title?: string
  readonly extraTags?: readonly string[][]
  readonly createdAt?: number
}

export interface ReplyParams {
  readonly root: NostrEvent // must be kind 11
  readonly content: string
  readonly relayUrl?: string
  readonly extraTags?: readonly string[][]
  readonly createdAt?: number
}

export interface ListByAuthorParams {
  readonly author: string
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface Nip7DService {
  readonly _tag: "Nip7DService"

  publishThread(params: PublishThreadParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  replyToThread(params: ReplyParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  listThreadsByAuthor(params: ListByAuthorParams): Effect.Effect<readonly NostrEvent[], RelayError>
}

export const Nip7DService = Context.GenericTag<Nip7DService>("Nip7DService")

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const publishThread: Nip7DService["publishThread"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      if (params.title) tags.push(["title", params.title])
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))
      const ev = yield* events.createEvent(
        {
          kind: decodeKind(THREAD_KIND),
          content: params.content,
          tags: tags.map((t) => decodeTag(t)),
          created_at: (params.createdAt ?? undefined) as any,
        },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const replyToThread: Nip7DService["replyToThread"] = (params, privateKey) =>
    Effect.gen(function* () {
      const relayUrl = params.relayUrl ?? relay.url
      const root = params.root
      // Build NIP-22 tags referencing the root as both root and parent
      const tags: string[][] = []
      // Root pointer (E) with K kind
      tags.push(["E", root.id, relayUrl, root.pubkey])
      tags.push(["K", String(THREAD_KIND)])
      tags.push(["P", root.pubkey])
      // Parent pointer (e) with k kind
      tags.push(["e", root.id, relayUrl, root.pubkey])
      tags.push(["k", String(THREAD_KIND)])
      tags.push(["p", root.pubkey])
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))

      const ev = yield* events.createEvent(
        {
          kind: decodeKind(COMMENT_KIND),
          content: params.content,
          tags: tags.map((t) => decodeTag(t)),
          created_at: (params.createdAt ?? undefined) as any,
        },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listThreadsByAuthor: Nip7DService["listThreadsByAuthor"] = ({ author, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const base: any = { kinds: [decodeKind(THREAD_KIND)], authors: [author] }
      if (limit) base.limit = limit
      const filter = decodeFilter(base)
      const sub = yield* relay.subscribe([filter])
      const results: NostrEvent[] = []
      const collect = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(timeoutMs ?? 600).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
        if (Option.isSome(next)) results.push(next.value)
      })
      const n = limit ?? 1
      for (let i = 0; i < n; i++) yield* collect
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "Nip7DService" as const,
    publishThread,
    replyToThread,
    listThreadsByAuthor,
  }
})

export const Nip7DServiceLive = Layer.effect(Nip7DService, make)

