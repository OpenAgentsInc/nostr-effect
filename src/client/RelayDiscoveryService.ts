/**
 * RelayDiscoveryService
 *
 * NIP-66: Relay Discovery and Liveness Monitoring
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/66.md
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

// =============================================================================
// Types
// =============================================================================

/** Network type for NIP-66 */
export type RelayNetwork = "clearnet" | "tor" | "i2p" | "loki"

/** Relay discovery metrics */
export interface DiscoveryMetrics {
  readonly rtt_open?: number
  readonly rtt_read?: number
  readonly rtt_write?: number
}

/** Additional discovery tags */
export interface DiscoveryTags {
  readonly network?: RelayNetwork
  readonly relayType?: string // PascalCase, e.g. "PrivateInbox"
  readonly nips?: readonly number[] // repeated N tags
  readonly requirements?: readonly string[] // repeated R tags, e.g. ["auth", "!payment"]
  readonly topics?: readonly string[] // repeated t tags
  readonly kinds?: readonly string[] // accepted/!unaccepted kinds in k tags
  readonly geohash?: string // g tag
  readonly languages?: readonly string[] // l tags: [code, "ISO-639-1"] repeated (we keep first value)
}

export interface PublishDiscoveryInput {
  /** d-tag: normalized relay URL (or pubkey fallback) */
  readonly relayId: string
  readonly nip11Content?: string
  readonly metrics?: DiscoveryMetrics
  readonly tags?: DiscoveryTags
}

export interface PublishMonitorInput {
  readonly frequencySeconds: number
  readonly timeouts?: readonly [string, string][] // [check, ms]
  readonly checks?: readonly string[] // ws, nip11, ssl, dns, geo, ...
  readonly geohash?: string
}

export interface RelayDiscoveryRecord {
  readonly event: NostrEvent
  readonly relayId: string
  readonly metrics: DiscoveryMetrics
  readonly tags: DiscoveryTags
  readonly content?: string
}

// =============================================================================
// Service Interface
// =============================================================================

export interface RelayDiscoveryService {
  readonly _tag: "RelayDiscoveryService"

  publishDiscovery(input: PublishDiscoveryInput, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  publishMonitorAnnouncement(input: PublishMonitorInput, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  getLatestForRelay(relayId: string): Effect.Effect<NostrEvent | null, RelayError>

  findRelays(params?: {
    byNetwork?: RelayNetwork
    byNip?: number
    byTopic?: string
    limit?: number
    timeoutMs?: number
  }): Effect.Effect<readonly RelayDiscoveryRecord[], RelayError>
}

export const RelayDiscoveryService = Context.GenericTag<RelayDiscoveryService>("RelayDiscoveryService")

// =============================================================================
// Helpers
// =============================================================================

const buildDiscoveryTags = (input: PublishDiscoveryInput): typeof Tag.Type[] => {
  const t: string[][] = [["d", input.relayId]]
  const { metrics, tags } = input

  if (metrics?.rtt_open !== undefined) t.push(["rtt-open", String(metrics.rtt_open)])
  if (metrics?.rtt_read !== undefined) t.push(["rtt-read", String(metrics.rtt_read)])
  if (metrics?.rtt_write !== undefined) t.push(["rtt-write", String(metrics.rtt_write)])

  if (tags?.network) t.push(["n", tags.network])
  if (tags?.relayType) t.push(["T", tags.relayType])
  if (tags?.nips) for (const n of tags.nips) t.push(["N", String(n)])
  if (tags?.requirements) for (const r of tags.requirements) t.push(["R", r])
  if (tags?.topics) for (const topic of tags.topics) t.push(["t", topic])
  if (tags?.kinds) for (const k of tags.kinds) t.push(["k", k])
  if (tags?.geohash) t.push(["g", tags.geohash])
  if (tags?.languages) for (const lang of tags.languages) t.push(["l", lang, "ISO-639-1"])

  return t.map((x) => decodeTag(x))
}

const parseDiscovery = (event: NostrEvent): RelayDiscoveryRecord | undefined => {
  try {
    const relayId = event.tags.find((x) => x[0] === "d")?.[1]
    if (!relayId) return undefined
    const getAll = (k: string) => event.tags.filter((t) => t[0] === k)
    const getOne = (k: string) => event.tags.find((t) => t[0] === k)?.[1]
    const toNum = (s?: string) => (s !== undefined ? Number(s) : undefined)
    const rto = toNum(getOne("rtt-open"))
    const rtr = toNum(getOne("rtt-read"))
    const rtw = toNum(getOne("rtt-write"))
    const metrics: DiscoveryMetrics = {
      ...(rto !== undefined ? { rtt_open: rto } : {}),
      ...(rtr !== undefined ? { rtt_read: rtr } : {}),
      ...(rtw !== undefined ? { rtt_write: rtw } : {}),
    }

    const nVal = getOne("n") as RelayNetwork | undefined
    const TVal = getOne("T")
    const nips = getAll("N").map((x) => Number(x[1]))
    const reqs = getAll("R").map((x) => x[1]!).filter(Boolean)
    const topics = getAll("t").map((x) => x[1]!).filter(Boolean)
    const kinds = getAll("k").map((x) => x[1]!).filter(Boolean)
    const g = getOne("g")
    const langs = getAll("l").map((x) => x[1]!).filter(Boolean)

    const tags: DiscoveryTags = {
      ...(nVal ? { network: nVal } : {}),
      ...(TVal ? { relayType: TVal } : {}),
      ...(nips.length ? { nips } : {}),
      ...(reqs.length ? { requirements: reqs } : {}),
      ...(topics.length ? { topics } : {}),
      ...(kinds.length ? { kinds } : {}),
      ...(g ? { geohash: g } : {}),
      ...(langs.length ? { languages: langs } : {}),
    }

    return { event, relayId, metrics, tags, content: event.content }
  } catch {
    return undefined
  }
}

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const publishDiscovery: RelayDiscoveryService["publishDiscovery"] = (input, privateKey) =>
    Effect.gen(function* () {
      const tags = buildDiscoveryTags(input)
      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(30166),
          content: input.nip11Content ?? "",
          tags,
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishMonitorAnnouncement: RelayDiscoveryService["publishMonitorAnnouncement"] = (
    input,
    privateKey
  ) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      // timeouts are pairs [check, ms]
      if (input.timeouts) for (const [check, ms] of input.timeouts) tags.push(["timeout", check, String(ms)])
      tags.push(["frequency", String(input.frequencySeconds)])
      if (input.checks) for (const c of input.checks) tags.push(["c", c])
      if (input.geohash) tags.push(["g", input.geohash])

      const event = yield* eventService.createEvent(
        { kind: decodeKind(10166), content: "", tags: tags.map((x) => decodeTag(x)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getLatestForRelay: RelayDiscoveryService["getLatestForRelay"] = (relayId) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(30166)], "#d": [relayId], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const findRelays: RelayDiscoveryService["findRelays"] = ({ byNetwork, byNip, byTopic, limit, timeoutMs } = {}) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(30166)], limit })
      const sub = yield* relay.subscribe([filter])

      const max = limit && limit > 0 ? limit : 10
      const budget = timeoutMs && timeoutMs > 0 ? timeoutMs : 800
      const results: RelayDiscoveryRecord[] = []

      const loop = Effect.gen(function* () {
        let count = 0
        while (count < max) {
          // eslint-disable-next-line no-await-in-loop
          const next = yield* Effect.race(
            sub.events.pipe(Stream.runHead),
            Effect.sleep(60).pipe(Effect.as(Option.none<NostrEvent>()))
          ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
          if (Option.isNone(next)) break

          const parsed = parseDiscovery(next.value)
          if (parsed) {
            if (byNetwork && parsed.tags.network !== byNetwork) {
              count++
              continue
            }
            if (byNip && !(parsed.tags.nips ?? []).includes(byNip)) {
              count++
              continue
            }
            if (byTopic && !(parsed.tags.topics ?? []).includes(byTopic)) {
              count++
              continue
            }
            results.push(parsed)
          }
          count++
        }
      })

      yield* Effect.race(loop, Effect.sleep(budget))
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "RelayDiscoveryService" as const,
    publishDiscovery,
    publishMonitorAnnouncement,
    getLatestForRelay,
    findRelays,
  }
})

export const RelayDiscoveryServiceLive = Layer.effect(RelayDiscoveryService, make)
