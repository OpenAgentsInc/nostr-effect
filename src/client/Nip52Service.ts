/**
 * Nip52Service
 *
 * NIP-52: Calendar Events (date/time), Calendars, and RSVP
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/52.md
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

// =============================================================================
// Types
// =============================================================================

export interface CommonEventTags {
  readonly title: string
  readonly summary?: string
  readonly image?: string
  readonly locations?: readonly string[]
  readonly geohash?: string
  readonly participants?: readonly [pubkey: string, relay?: string, role?: string][]
  readonly hashtags?: readonly string[]
  readonly refs?: readonly string[]
  readonly calendarRefs?: readonly { kind: 31924; pubkey: string; d: string; relay?: string }[]
}

export interface PublishDateEventOptions extends CommonEventTags {
  readonly d: string
  readonly content?: string
  readonly start: string // YYYY-MM-DD
  readonly end?: string // YYYY-MM-DD
}

export interface PublishTimeEventOptions extends CommonEventTags {
  readonly d: string
  readonly content?: string
  readonly start: number // unix seconds
  readonly end?: number // unix seconds
  readonly start_tzid?: string
  readonly end_tzid?: string
}

export interface PublishCalendarOptions {
  readonly d: string
  readonly title: string
  readonly content?: string
  readonly includes?: readonly { kind: 31922 | 31923; pubkey: string; d: string; relay?: string }[]
}

export type RsvpStatus = "accepted" | "declined" | "tentative"
export type RsvpFreeBusy = "free" | "busy"

export interface PublishRsvpOptions {
  readonly a: { kind: 31922 | 31923; pubkey: string; d: string; relay?: string }
  readonly e?: { id: string; relay?: string }
  readonly d: string
  readonly status: RsvpStatus
  readonly fb?: RsvpFreeBusy
  readonly p?: { pubkey: string; relay?: string }
  readonly content?: string
}

export interface Nip52Service {
  readonly _tag: "Nip52Service"

  publishDateEvent(options: PublishDateEventOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  publishTimeEvent(options: PublishTimeEventOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  publishCalendar(options: PublishCalendarOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  publishRsvp(options: PublishRsvpOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  getByD(kind: 31922 | 31923 | 31924 | 31925, author: PublicKey, d: string): Effect.Effect<NostrEvent | null, RelayError>
}

export const Nip52Service = Context.GenericTag<Nip52Service>("Nip52Service")

// =============================================================================
// Helpers
// =============================================================================

const commonTags = (c: CommonEventTags | undefined): string[][] => {
  if (!c) return []
  const out: string[][] = []
  out.push(["title", c.title])
  if (c.summary) out.push(["summary", c.summary])
  if (c.image) out.push(["image", c.image])
  if (c.locations) for (const loc of c.locations) out.push(["location", loc])
  if (c.geohash) out.push(["g", c.geohash])
  if (c.participants)
    for (const [p, relay, role] of c.participants) out.push(["p", p, ...(relay ? [relay] : []), ...(role ? [role] : [])])
  if (c.hashtags) for (const t of c.hashtags) out.push(["t", t])
  if (c.refs) for (const r of c.refs) out.push(["r", r])
  if (c.calendarRefs)
    for (const a of c.calendarRefs)
      out.push(["a", `${a.kind}:${a.pubkey}:${a.d}`, ...(a.relay ? [a.relay] : [])])
  return out
}

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const publishDateEvent: Nip52Service["publishDateEvent"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", options.d], ["start", options.start]]
      if (options.end) tags.push(["end", options.end])
      tags.push(...commonTags(options))
      const event = yield* eventService.createEvent(
        { kind: decodeKind(31922), content: options.content ?? "", tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishTimeEvent: Nip52Service["publishTimeEvent"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", options.d], ["start", String(options.start)]]
      if (options.end !== undefined) tags.push(["end", String(options.end)])
      if (options.start_tzid) tags.push(["start_tzid", options.start_tzid])
      if (options.end_tzid) tags.push(["end_tzid", options.end_tzid])
      tags.push(...commonTags(options))
      const event = yield* eventService.createEvent(
        { kind: decodeKind(31923), content: options.content ?? "", tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishCalendar: Nip52Service["publishCalendar"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", options.d], ["title", options.title]]
      if (options.includes)
        for (const a of options.includes) tags.push(["a", `${a.kind}:${a.pubkey}:${a.d}`, ...(a.relay ? [a.relay] : [])])
      const event = yield* eventService.createEvent(
        { kind: decodeKind(31924), content: options.content ?? "", tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishRsvp: Nip52Service["publishRsvp"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      if (options.e) tags.push(["e", options.e.id, ...(options.e.relay ? [options.e.relay] : [])])
      tags.push(["a", `${options.a.kind}:${options.a.pubkey}:${options.a.d}`, ...(options.a.relay ? [options.a.relay] : [])])
      tags.push(["d", options.d])
      tags.push(["status", options.status])
      if (options.fb) tags.push(["fb", options.fb])
      if (options.p) tags.push(["p", options.p.pubkey, ...(options.p.relay ? [options.p.relay] : [])])
      const event = yield* eventService.createEvent(
        { kind: decodeKind(31925), content: options.content ?? "", tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getByD: Nip52Service["getByD"] = (kind, author, d) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(kind)], authors: [author], "#d": [d], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "Nip52Service" as const,
    publishDateEvent,
    publishTimeEvent,
    publishCalendar,
    publishRsvp,
    getByD,
  }
})

export const Nip52ServiceLive = Layer.effect(Nip52Service, make)

