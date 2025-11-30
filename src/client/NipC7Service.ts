/**
 * NipC7Service
 *
 * NIP-C7: Chats (kind 9) with quote-reply via q tag.
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { EventKind, Filter, Tag, type NostrEvent, type PrivateKey } from "../core/Schema.js"
import { ChatMessageC7 as CHAT_KIND } from "../wrappers/kinds.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export interface PublishChatParams {
  readonly content: string
  readonly extraTags?: readonly string[][]
  readonly createdAt?: number
}

export interface PublishReplyParams extends PublishChatParams {
  readonly parent: NostrEvent
  readonly relayUrl?: string
}

export interface QueryParams {
  readonly author: string
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface NipC7Service {
  readonly _tag: "NipC7Service"

  sendChat(params: PublishChatParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  replyChat(params: PublishReplyParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  listByAuthor(params: QueryParams): Effect.Effect<readonly NostrEvent[], RelayError>
}

export const NipC7Service = Context.GenericTag<NipC7Service>("NipC7Service")

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const sendChat: NipC7Service["sendChat"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))
      const ev = yield* events.createEvent(
        {
          kind: decodeKind(CHAT_KIND),
          content: params.content,
          tags: tags.map((t) => decodeTag(t)),
          created_at: (params.createdAt ?? undefined) as any,
        },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const replyChat: NipC7Service["replyChat"] = (params, privateKey) =>
    Effect.gen(function* () {
      const relayUrl = params.relayUrl ?? relay.url
      const tags: string[][] = [["q", params.parent.id, relayUrl, params.parent.pubkey]]
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))
      const ev = yield* events.createEvent(
        {
          kind: decodeKind(CHAT_KIND),
          content: params.content,
          tags: tags.map((t) => decodeTag(t)),
          created_at: (params.createdAt ?? undefined) as any,
        },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listByAuthor: NipC7Service["listByAuthor"] = ({ author, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const base: any = { kinds: [decodeKind(CHAT_KIND)], authors: [author] }
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
    _tag: "NipC7Service" as const,
    sendChat,
    replyChat,
    listByAuthor,
  }
})

export const NipC7ServiceLive = Layer.effect(NipC7Service, make)

