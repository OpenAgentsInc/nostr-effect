/**
 * Nip88Service
 *
 * NIP-88: Polls
 * - Poll event: kind 1068
 * - Response event: kind 1018
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

export type PollType = "singlechoice" | "multiplechoice"

export interface PollOption {
  readonly id: string
  readonly label: string
}

export interface PublishPollOptions {
  readonly label: string
  readonly options: readonly PollOption[]
  readonly polltype?: PollType
  readonly endsAt?: number // unix seconds; stringified in tag
  readonly relays?: readonly string[]
}

export interface PublishResponseOptions {
  readonly pollEventId: string
  readonly selectedOptionIds: readonly string[]
}

export interface ListResponsesOptions {
  readonly pollEventId: string
  readonly authors?: readonly string[]
  readonly until?: number
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface CountResultsOptions {
  readonly pollEvent: NostrEvent
  readonly responses: readonly NostrEvent[]
}

export interface PollResult {
  readonly counts: ReadonlyMap<string, number>
}

export interface Nip88Service {
  readonly _tag: "Nip88Service"

  publishPoll(options: PublishPollOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  publishResponse(options: PublishResponseOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  listResponses(options: ListResponsesOptions): Effect.Effect<readonly NostrEvent[], RelayError>

  countResults(options: CountResultsOptions): Effect.Effect<PollResult, never>
}

export const Nip88Service = Context.GenericTag<Nip88Service>("Nip88Service")

const getPollType = (pollEvent: NostrEvent): PollType => {
  const t = pollEvent.tags.find((t) => t[0] === "polltype")?.[1]
  return (t === "multiplechoice" ? "multiplechoice" : "singlechoice") as PollType
}

const getEndsAt = (pollEvent: NostrEvent): number | undefined => {
  const v = pollEvent.tags.find((t) => t[0] === "endsAt")?.[1]
  return v ? Number(v) : undefined
}

const responseOptionIds = (response: NostrEvent): readonly string[] =>
  response.tags.filter((t) => t[0] === "response").map((t) => t[1]!).filter(Boolean)

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const publishPoll: Nip88Service["publishPoll"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      for (const opt of options.options) tags.push(["option", opt.id, opt.label])
      if (options.relays) for (const r of options.relays) tags.push(["relay", r])
      if (options.polltype) tags.push(["polltype", options.polltype])
      if (typeof options.endsAt === "number") tags.push(["endsAt", String(options.endsAt)])

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(1068),
          content: options.label,
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishResponse: Nip88Service["publishResponse"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      tags.push(["e", options.pollEventId])
      for (const id of options.selectedOptionIds) tags.push(["response", id])
      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(1018),
          content: "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listResponses: Nip88Service["listResponses"] = ({ pollEventId, authors, until, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const f: any = { kinds: [decodeKind(1018)], "#e": [pollEventId], limit }
      if (authors && authors.length) f.authors = authors
      if (typeof until === "number") f.until = until
      const filter = decodeFilter(f)

      const sub = yield* relay.subscribe([filter])
      const results: NostrEvent[] = []
      const max = limit && limit > 0 ? limit : 10
      const budget = timeoutMs && timeoutMs > 0 ? timeoutMs : 1000
      const loop = Effect.gen(function* () {
        let count = 0
        while (count < max) {
          // eslint-disable-next-line no-await-in-loop
          const next = yield* Effect.race(
            sub.events.pipe(Stream.runHead),
            Effect.sleep(80).pipe(Effect.as(Option.none<NostrEvent>()))
          ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
          if (Option.isNone(next)) break
          results.push(next.value)
          count++
        }
      })
      yield* Effect.race(loop, Effect.sleep(budget))
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const countResults: Nip88Service["countResults"] = ({ pollEvent, responses }) =>
    Effect.gen(function* () {
      const polltype = getPollType(pollEvent)
      const until = getEndsAt(pollEvent)

      // Pick latest response per pubkey within bounds
      const map = new Map<string, NostrEvent>()
      for (const r of responses) {
        if (until && r.created_at > until) continue
        const prev = map.get(r.pubkey)
        if (!prev || r.created_at > prev.created_at) map.set(r.pubkey, r)
      }

      const counts = new Map<string, number>()
      const inc = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1)

      for (const r of map.values()) {
        const ids = responseOptionIds(r)
        if (ids.length === 0) continue
        if (polltype === "singlechoice") {
          inc(ids[0]!)
        } else {
          // multiplechoice: consider first occurrence of each id
          const seen = new Set<string>()
          for (const id of ids) if (!seen.has(id)) { inc(id); seen.add(id) }
        }
      }

      return { counts } satisfies PollResult
    })

  return {
    _tag: "Nip88Service" as const,
    publishPoll,
    publishResponse,
    listResponses,
    countResults,
  }
})

export const Nip88ServiceLive = Layer.effect(Nip88Service, make)

