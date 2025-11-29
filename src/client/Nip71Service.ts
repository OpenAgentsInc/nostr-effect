/**
 * Nip71Service
 *
 * NIP-71: Video Events (kinds 21, 22)
 * - Normal video: kind 21
 * - Short video: kind 22
 *
 * Uses NIP-92 `imeta` tags as primary source of video variants.
 * Adds support for NIP-71 fields: title, published_at, text-track, content-warning,
 * alt, segment, t (hashtags), p (participants), r (links), plus imeta extensions
 * bitrate and duration.
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import {
  type NostrEvent,
  type PrivateKey,
  EventKind,
  Filter,
  Tag,
} from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export type VideoKind = 21 | 22

export interface ImetaVariant {
  readonly dim?: string
  readonly url?: string
  readonly x?: string
  readonly m?: string
  readonly images?: readonly string[]
  readonly fallbacks?: readonly string[]
  readonly service?: string
  readonly bitrate?: number
  readonly duration?: number
}

export interface SegmentTag {
  readonly start: string // HH:MM:SS.sss
  readonly end?: string
  readonly title?: string
  readonly thumbnailUrl?: string
}

export interface ParticipantTag {
  readonly pubkey: string
  readonly relay?: string
}

export interface PublishVideoOptions {
  readonly kind: VideoKind
  readonly content?: string
  readonly title: string
  readonly publishedAt?: number // unix seconds (stringified in tag)
  readonly alt?: string
  readonly contentWarning?: string
  readonly hashtags?: readonly string[]
  readonly links?: readonly string[]
  readonly participants?: readonly ParticipantTag[]
  readonly segments?: readonly SegmentTag[]
  readonly textTracks?: readonly { encodedKind6000: string; relays?: readonly string[] }[]
  readonly imeta: readonly ImetaVariant[]
}

export interface ParsedVideoEvent {
  readonly event: NostrEvent
  readonly kind: VideoKind
  readonly title?: string
  readonly publishedAt?: number
  readonly alt?: string
  readonly contentWarning?: string
  readonly hashtags: readonly string[]
  readonly links: readonly string[]
  readonly participants: readonly ParticipantTag[]
  readonly segments: readonly SegmentTag[]
  readonly textTracks: readonly { encodedKind6000: string; relays?: readonly string[] }[]
  readonly imeta: readonly ImetaVariant[]
}

export interface ListVideosOptions {
  readonly authors?: readonly string[]
  readonly kinds?: readonly VideoKind[] // default [21, 22]
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface Nip71Service {
  readonly _tag: "Nip71Service"

  publishVideo(options: PublishVideoOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  listVideos(options?: ListVideosOptions): Effect.Effect<readonly ParsedVideoEvent[], RelayError>
}

export const Nip71Service = Context.GenericTag<Nip71Service>("Nip71Service")

const buildImetaTag = (v: ImetaVariant): string[] => {
  const parts: string[] = ["imeta"]
  if (v.dim) parts.push(`dim ${v.dim}`)
  if (v.url) parts.push(`url ${v.url}`)
  if (v.x) parts.push(`x ${v.x}`)
  if (v.m) parts.push(`m ${v.m}`)
  if (v.images && v.images.length) for (const img of v.images) parts.push(`image ${img}`)
  if (v.fallbacks && v.fallbacks.length) for (const fb of v.fallbacks) parts.push(`fallback ${fb}`)
  if (v.service) parts.push(`service ${v.service}`)
  if (typeof v.bitrate === "number") parts.push(`bitrate ${v.bitrate}`)
  if (typeof v.duration === "number") parts.push(`duration ${v.duration}`)
  return parts
}

const parseImetaTag = (tag: readonly string[]): ImetaVariant | undefined => {
  if (tag[0] !== "imeta") return undefined
  const res: any = { images: [], fallbacks: [] }
  for (let i = 1; i < tag.length; i++) {
    const entry = tag[i] ?? ""
    const [key, ...rest] = entry.split(" ")
    const value = rest.join(" ")
    switch (key) {
      case "dim": res.dim = value; break
      case "url": res.url = value; break
      case "x": res.x = value; break
      case "m": res.m = value; break
      case "image": res.images.push(value); break
      case "fallback": res.fallbacks.push(value); break
      case "service": res.service = value; break
      case "bitrate": res.bitrate = Number(value); break
      case "duration": res.duration = Number(value); break
      default: break
    }
  }
  return res as ImetaVariant
}

const parseVideoEvent = (ev: NostrEvent): ParsedVideoEvent => {
  const kind = ev.kind as VideoKind
  const title = ev.tags.find((t) => t[0] === "title")?.[1]
  const publishedAtStr = ev.tags.find((t) => t[0] === "published_at")?.[1]
  const publishedAt = publishedAtStr ? Number(publishedAtStr) : undefined
  const alt = ev.tags.find((t) => t[0] === "alt")?.[1]
  const cw = ev.tags.find((t) => t[0] === "content-warning")?.[1]

  const hashtags = ev.tags.filter((t) => t[0] === "t").map((t) => t[1]!).filter(Boolean)
  const links = ev.tags.filter((t) => t[0] === "r").map((t) => t[1]!).filter(Boolean)

  const participants: ParticipantTag[] = ev.tags
    .filter((t) => t[0] === "p")
    .map((t) => {
      const base: any = { pubkey: t[1]! }
      if (t[2]) base.relay = t[2]
      return base as ParticipantTag
    })

  const segments: SegmentTag[] = ev.tags
    .filter((t) => t[0] === "segment")
    .map((t) => {
      const base: any = { start: t[1]! }
      if (t[2]) base.end = t[2]
      if (t[3]) base.title = t[3]
      if (t[4]) base.thumbnailUrl = t[4]
      return base as SegmentTag
    })

  const textTracks = ev.tags
    .filter((t) => t[0] === "text-track")
    .map((t) => {
      const base: { encodedKind6000: string; relays?: readonly string[] } = { encodedKind6000: t[1]! }
      if (t[2]) base.relays = t[2].split(",")
      return base
    })

  const imeta = ev.tags
    .filter((t) => t[0] === "imeta")
    .map((t) => parseImetaTag(t)!)

  const base: any = {
    event: ev,
    kind,
    hashtags,
    links,
    participants,
    segments,
    textTracks,
    imeta,
  }
  if (title !== undefined) base.title = title
  if (publishedAt !== undefined) base.publishedAt = publishedAt
  if (alt !== undefined) base.alt = alt
  if (cw !== undefined) base.contentWarning = cw
  return base as ParsedVideoEvent
}

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const publishVideo: Nip71Service["publishVideo"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      // required title
      tags.push(["title", options.title])
      if (typeof options.publishedAt === "number") tags.push(["published_at", String(options.publishedAt)])
      if (options.alt) tags.push(["alt", options.alt])
      if (options.contentWarning) tags.push(["content-warning", options.contentWarning])
      if (options.hashtags) for (const t of options.hashtags) tags.push(["t", t])
      if (options.links) for (const u of options.links) tags.push(["r", u])
      if (options.participants)
        for (const p of options.participants) tags.push(["p", p.pubkey, ...(p.relay ? [p.relay] : [])])
      if (options.segments)
        for (const s of options.segments) tags.push(["segment", s.start, ...(s.end ? [s.end] : []), ...(s.title ? [s.title] : []), ...(s.thumbnailUrl ? [s.thumbnailUrl] : [])])
      if (options.textTracks)
        for (const trk of options.textTracks)
          tags.push(["text-track", trk.encodedKind6000, ...(trk.relays && trk.relays.length ? [trk.relays.join(",")] : [])])
      for (const v of options.imeta) tags.push(buildImetaTag(v))

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(options.kind),
          content: options.content ?? "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listVideos: Nip71Service["listVideos"] = ({ authors, kinds, limit, timeoutMs } = {}) =>
    Effect.gen(function* () {
      const k = kinds && kinds.length ? kinds : ([21, 22] as const)
      const f: any = { kinds: k.map((x) => decodeKind(x)), limit }
      if (authors && authors.length) f.authors = authors
      const filter = decodeFilter(f)

      const sub = yield* relay.subscribe([filter])
      const results: ParsedVideoEvent[] = []
      const max = limit && limit > 0 ? limit : 5
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
          results.push(parseVideoEvent(next.value))
          count++
        }
      })
      yield* Effect.race(loop, Effect.sleep(budget))
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "Nip71Service" as const,
    publishVideo,
    listVideos,
  }
})

export const Nip71ServiceLive = Layer.effect(Nip71Service, make)
