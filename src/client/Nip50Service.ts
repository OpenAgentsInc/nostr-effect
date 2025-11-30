/**
 * Nip50Service
 *
 * NIP-50: Search capability (filter.search)
 * Provides convenience functions to query events by search string.
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { Filter, EventKind, type NostrEvent, PublicKey } from "../core/Schema.js"

const decodeFilter = Schema.decodeSync(Filter)
const decodeKind = Schema.decodeSync(EventKind)
const decodePub = Schema.decodeSync(PublicKey)

export interface SearchParams {
  readonly query: string
  readonly kinds?: readonly number[]
  readonly authors?: readonly string[]
  readonly since?: number
  readonly until?: number
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface Nip50Service {
  readonly _tag: "Nip50Service"

  search(params: SearchParams): Effect.Effect<readonly NostrEvent[], RelayError>
  getOne(params: Omit<SearchParams, "limit">): Effect.Effect<NostrEvent | null, RelayError>
}

export const Nip50Service = Context.GenericTag<Nip50Service>("Nip50Service")

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  // EventService not required here, but kept for parity/injection if needed later
  yield* EventService

  const search: Nip50Service["search"] = ({ query, kinds, authors, since, until, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const base: any = { search: query }
      if (kinds && kinds.length > 0) base.kinds = kinds.map((k) => decodeKind(k))
      if (authors && authors.length > 0) base.authors = authors.map((a) => decodePub(a))
      if (since !== undefined) base.since = since
      if (until !== undefined) base.until = until
      if (limit !== undefined) base.limit = limit
      const filter = decodeFilter(base)

      const sub = yield* relay.subscribe([filter])
      const results: NostrEvent[] = []

      const collectOne = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(timeoutMs ?? 500).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
        if (Option.isSome(next)) results.push(next.value)
      })

      const count = limit && limit > 0 ? limit : 1
      for (let i = 0; i < count; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collectOne
      }
      yield* sub.unsubscribe()
      return results
    }).pipe(
      Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url }))
    )

  const getOne: Nip50Service["getOne"] = (params) =>
    Effect.gen(function* () {
      const results = yield* search({ ...params, limit: 1 })
      return results[0] ?? null
    })

  return {
    _tag: "Nip50Service" as const,
    search,
    getOne,
  }
})

export const Nip50ServiceLive = Layer.effect(Nip50Service, make)

