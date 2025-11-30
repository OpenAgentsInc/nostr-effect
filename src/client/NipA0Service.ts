/**
 * NipA0Service
 *
 * NIP-A0: Voice Messages (kinds 1222 root, 1244 reply)
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { EventKind, Filter, Tag, type NostrEvent, type PrivateKey } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export const VOICE_ROOT_KIND = 1222
export const VOICE_REPLY_KIND = 1244

export interface VoiceImetaOptions {
  readonly url?: string
  readonly waveform?: readonly number[]
  readonly duration?: number
}

export interface PublishRootVoiceParams {
  readonly url: string
  readonly imeta?: VoiceImetaOptions
  readonly extraTags?: readonly string[][]
}

export interface PublishReplyVoiceParams {
  readonly url: string
  // Minimal NIP-22-like structure: supply root and parent pointers and kinds
  readonly root: { type: "e" | "a"; value: string; relay?: string; pubkey?: string }
  readonly parent: { type: "e" | "a"; value: string; relay?: string; pubkey?: string }
  readonly rootKind: number
  readonly parentKind: number
  readonly rootAuthor?: { pubkey: string; relay?: string }
  readonly parentAuthor?: { pubkey: string; relay?: string }
  readonly imeta?: VoiceImetaOptions
  readonly extraTags?: readonly string[][]
}

export interface QueryParams {
  readonly authors?: readonly string[]
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface NipA0Service {
  readonly _tag: "NipA0Service"

  publishRootVoice(params: PublishRootVoiceParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  publishReplyVoice(params: PublishReplyVoiceParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  listRecentRootVoices(params?: QueryParams): Effect.Effect<readonly NostrEvent[], RelayError>
  listRepliesTo(parentEventId: string, params?: QueryParams): Effect.Effect<readonly NostrEvent[], RelayError>
}

export const NipA0Service = Context.GenericTag<NipA0Service>("NipA0Service")

const pushPointer = (tags: string[][], type: string, value: string, relay?: string, pubkey?: string) => {
  const t: string[] = [type, value]
  if (relay) t.push(relay)
  if (pubkey) t.push(pubkey)
  tags.push(t)
}

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const voiceImetaTag = (opts?: VoiceImetaOptions): string[] | undefined => {
    if (!opts) return undefined
    const parts: string[] = ["imeta"]
    if (opts.url) parts.push(`url ${opts.url}`)
    if (opts.waveform && opts.waveform.length > 0) parts.push(`waveform ${opts.waveform.join(" ")}`)
    if (typeof opts.duration === "number") parts.push(`duration ${opts.duration}`)
    return parts
  }

  const publishRootVoice: NipA0Service["publishRootVoice"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      const imeta = voiceImetaTag(params.imeta)
      if (imeta) tags.push(imeta)
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))

      const ev = yield* events.createEvent(
        { kind: decodeKind(VOICE_ROOT_KIND), content: params.url, tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishReplyVoice: NipA0Service["publishReplyVoice"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      // Root pointer + K
      pushPointer(tags, params.root.type, params.root.value, params.root.relay, params.root.pubkey)
      tags.push(["K", String(params.rootKind)])
      if (params.rootAuthor) {
        const t: string[] = ["P", params.rootAuthor.pubkey]
        if (params.rootAuthor.relay) t.push(params.rootAuthor.relay)
        tags.push(t)
      }
      // Parent pointer + k
      pushPointer(tags, params.parent.type, params.parent.value, params.parent.relay, params.parent.pubkey)
      tags.push(["k", String(params.parentKind)])
      if (params.parentAuthor) {
        const t: string[] = ["p", params.parentAuthor.pubkey]
        if (params.parentAuthor.relay) t.push(params.parentAuthor.relay)
        tags.push(t)
      }
      const imeta = voiceImetaTag(params.imeta)
      if (imeta) tags.push(imeta)
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))

      const ev = yield* events.createEvent(
        { kind: decodeKind(VOICE_REPLY_KIND), content: params.url, tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listRecentRootVoices: NipA0Service["listRecentRootVoices"] = ({ authors, limit, timeoutMs } = {}) =>
    Effect.gen(function* () {
      const base: any = { kinds: [decodeKind(VOICE_ROOT_KIND)] }
      if (authors && authors.length > 0) base.authors = authors
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
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collect
      }
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listRepliesTo: NipA0Service["listRepliesTo"] = (parentEventId, { authors, limit, timeoutMs } = {}) =>
    Effect.gen(function* () {
      const base: any = { kinds: [decodeKind(VOICE_REPLY_KIND)], "#e": [parentEventId] }
      if (authors && authors.length > 0) base.authors = authors
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
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collect
      }
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "NipA0Service" as const,
    publishRootVoice,
    publishReplyVoice,
    listRecentRootVoices,
    listRepliesTo,
  }
})

export const NipA0ServiceLive = Layer.effect(NipA0Service, make)
