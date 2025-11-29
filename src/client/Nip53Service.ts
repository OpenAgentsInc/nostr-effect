/**
 * Nip53Service
 *
 * NIP-53: Live Activities
 * - Live Streaming Event (kind 30311): addressable via d-tag
 * - Live Chat Message (kind 1311): linked via a-tag to 30311
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import {
  EventKind,
  Filter,
  Tag,
  type NostrEvent,
  type PrivateKey,
  type PublicKey,
} from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export interface Participant {
  readonly pubkey: string
  readonly relay?: string
  readonly role?: string // Host | Speaker | Participant
  readonly proof?: string // hex-encoded signature
}

export interface PublishLiveEventOptions {
  readonly d: string
  readonly title?: string
  readonly summary?: string
  readonly image?: string
  readonly hashtags?: readonly string[]
  readonly streaming?: string
  readonly recording?: string
  readonly starts?: number
  readonly ends?: number
  readonly status?: "planned" | "live" | "ended"
  readonly current_participants?: number
  readonly total_participants?: number
  readonly participants?: readonly Participant[]
  readonly relays?: readonly string[]
  readonly pinned?: readonly string[] // event ids
  readonly content?: string
}

export interface PublishLiveChatOptions {
  readonly a: { pubkey: string; d: string; relay?: string } // references 30311
  readonly content: string
  readonly e?: { id: string; relay?: string }
}

export interface Nip53Service {
  readonly _tag: "Nip53Service"

  publishLiveEvent(options: PublishLiveEventOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  getLiveEvent(author: PublicKey, d: string): Effect.Effect<NostrEvent | null, RelayError>

  publishLiveChat(options: PublishLiveChatOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
}

export const Nip53Service = Context.GenericTag<Nip53Service>("Nip53Service")

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const publishLiveEvent: Nip53Service["publishLiveEvent"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", options.d]]
      if (options.title) tags.push(["title", options.title])
      if (options.summary) tags.push(["summary", options.summary])
      if (options.image) tags.push(["image", options.image])
      if (options.hashtags) for (const t of options.hashtags) tags.push(["t", t])
      if (options.streaming) tags.push(["streaming", options.streaming])
      if (options.recording) tags.push(["recording", options.recording])
      if (options.starts !== undefined) tags.push(["starts", String(options.starts)])
      if (options.ends !== undefined) tags.push(["ends", String(options.ends)])
      if (options.status) tags.push(["status", options.status])
      if (options.current_participants !== undefined)
        tags.push(["current_participants", String(options.current_participants)])
      if (options.total_participants !== undefined)
        tags.push(["total_participants", String(options.total_participants)])
      if (options.participants)
        for (const p of options.participants)
          tags.push(["p", p.pubkey, ...(p.relay ? [p.relay] : []), ...(p.role ? [p.role] : []), ...(p.proof ? [p.proof] : [])])
      if (options.relays && options.relays.length) tags.push(["relays", ...options.relays])
      if (options.pinned) for (const id of options.pinned) tags.push(["pinned", id])

      const event = yield* eventService.createEvent(
        { kind: decodeKind(30311), content: options.content ?? "", tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getLiveEvent: Nip53Service["getLiveEvent"] = (author, d) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(30311)], authors: [author], "#d": [d], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishLiveChat: Nip53Service["publishLiveChat"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      if (options.e) tags.push(["e", options.e.id, ...(options.e.relay ? [options.e.relay] : [])])
      tags.push(["a", `30311:${options.a.pubkey}:${options.a.d}`, ...(options.a.relay ? [options.a.relay] : [])])
      const event = yield* eventService.createEvent(
        { kind: decodeKind(1311), content: options.content, tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "Nip53Service" as const,
    publishLiveEvent,
    getLiveEvent,
    publishLiveChat,
  }
})

export const Nip53ServiceLive = Layer.effect(Nip53Service, make)

