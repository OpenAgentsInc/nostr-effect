/**
 * Nip32Service
 *
 * NIP-32: Labeling (kind 1985)
 * Allows publishing labels for targets (events, pubkeys, relays, topics, addresses) using L/l tags.
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

export type LabelTarget =
  | { type: "e"; id: string; relay?: string }
  | { type: "p"; pubkey: string; relay?: string }
  | { type: "a"; addr: string; relay?: string }
  | { type: "r"; url: string }
  | { type: "t"; topic: string }

export interface PublishLabelOptions {
  /** Namespace(s) e.g., "license", "ISO-639-1", or special "#t" */
  readonly L?: readonly string[]
  /** Labels with optional mark (namespace reference) */
  readonly labels: readonly { value: string; mark?: string }[]
  /** One or more label targets */
  readonly targets: readonly LabelTarget[]
  /** Optional extended description */
  readonly content?: string
}

export interface QueryLabelsOptions {
  /** Filter by L namespace(s) */
  readonly namespaces?: readonly string[]
  /** Filter by target coordinate (one at a time) */
  readonly target?: LabelTarget
  /** Limit and timeout */
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface Nip32Service {
  readonly _tag: "Nip32Service"

  publishLabel(options: PublishLabelOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  queryLabels(options?: QueryLabelsOptions): Effect.Effect<readonly NostrEvent[], RelayError>
}

export const Nip32Service = Context.GenericTag<Nip32Service>("Nip32Service")

const targetToTag = (t: LabelTarget): string[] => {
  switch (t.type) {
    case "e":
      return ["e", t.id, ...(t.relay ? [t.relay] : [])]
    case "p":
      return ["p", t.pubkey, ...(t.relay ? [t.relay] : [])]
    case "a":
      return ["a", t.addr, ...(t.relay ? [t.relay] : [])]
    case "r":
      return ["r", t.url]
    case "t":
      return ["t", t.topic]
  }
}

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const publishLabel: Nip32Service["publishLabel"] = (options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      if (options.L) for (const ns of options.L) tags.push(["L", ns])
      for (const l of options.labels) tags.push(["l", l.value, ...(l.mark ? [l.mark] : [])])
      for (const t of options.targets) tags.push(targetToTag(t))
      const event = yield* eventService.createEvent(
        { kind: decodeKind(1985), content: options.content ?? "", tags: tags.map((x) => decodeTag(x)) },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const queryLabels: Nip32Service["queryLabels"] = ({ namespaces, target, limit, timeoutMs } = {}) =>
    Effect.gen(function* () {
      const f: any = { kinds: [decodeKind(1985)], limit }
      const tagFilters: Record<string, string[]> = {}
      if (namespaces && namespaces.length) tagFilters["L"] = namespaces as string[]
      if (target) {
        const tag = targetToTag(target)
        // map to filter keys: e.g., "#e": [id]
        const k = `#${tag[0]}`
        tagFilters[k] = [tag[1] as string]
      }
      Object.assign(f, tagFilters)
      const filter = decodeFilter(f)
      const sub = yield* relay.subscribe([filter])
      const results: NostrEvent[] = []
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
          results.push(next.value)
          count++
        }
      })
      yield* Effect.race(loop, Effect.sleep(budget))
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "Nip32Service" as const,
    publishLabel,
    queryLabels,
  }
})

export const Nip32ServiceLive = Layer.effect(Nip32Service, make)

