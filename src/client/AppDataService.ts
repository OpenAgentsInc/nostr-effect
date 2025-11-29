/**
 * AppDataService
 *
 * NIP-78: Arbitrary custom app data (kind 30078, addressable via d-tag)
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/78.md
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import {
  type NostrEvent,
  type PrivateKey,
  type PublicKey,
  EventKind,
  Filter,
  Tag,
} from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

// =============================================================================
// Service Interface
// =============================================================================

export interface PutOptions {
  readonly key: string
  readonly content: string
  readonly tags?: readonly string[][] | undefined
}

export interface PutJSONOptions {
  readonly key: string
  readonly value: unknown
  /** Optional additional tags */
  readonly tags?: readonly string[][]
}

export interface GetOptions {
  readonly pubkey: PublicKey
  readonly key: string
}

export interface ListKeysOptions {
  readonly pubkey: PublicKey
  readonly prefix?: string
  /** Max keys to return (best-effort) */
  readonly limit?: number
  /** Subscription timeout (ms) */
  readonly timeoutMs?: number
}

export interface AppDataService {
  readonly _tag: "AppDataService"

  /** Put key/value as kind 30078 with d=key. Replaces previous value for same key. */
  put(options: PutOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  /** Convenience JSON put: stringifies value to content. */
  putJSON(options: PutJSONOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  /** Get latest event for key (d-tag) for an author. */
  get(options: GetOptions): Effect.Effect<NostrEvent | null, RelayError>

  /**
   * List keys for an author. Best-effort (bounded time), returns unique d-tag values.
   * If prefix is provided, only keys starting with prefix are returned.
   */
  listKeys(options: ListKeysOptions): Effect.Effect<readonly string[], RelayError>
}

export const AppDataService = Context.GenericTag<AppDataService>("AppDataService")

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const put: AppDataService["put"] = ({ key, content, tags }, privateKey) =>
    Effect.gen(function* () {
      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(30078),
          content,
          tags: [["d", key], ...(tags ?? [])].map((t) => decodeTag(t)),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(
      Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url }))
    )

  const putJSON: AppDataService["putJSON"] = ({ key, value, tags }, privateKey) =>
    put(
      {
        key,
        content: JSON.stringify(value),
        tags,
      },
      privateKey
    )

  const get: AppDataService["get"] = ({ pubkey, key }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(30078)],
        authors: [pubkey],
        "#d": [key],
        limit: 1,
      })
      const sub = yield* relay.subscribe([filter])
      const maybeEvent = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybeEvent) ? maybeEvent.value : null
    }).pipe(
      Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url }))
    )

  const listKeys: AppDataService["listKeys"] = ({ pubkey, prefix, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(30078)], authors: [pubkey] })
      const sub = yield* relay.subscribe([filter])
      const keys = new Set<string>()

      const max = limit && limit > 0 ? limit : 100
      const totalTimeout = timeoutMs && timeoutMs > 0 ? timeoutMs : 800

      const collectLoop = Effect.gen(function* () {
        let count = 0
        while (count < max) {
          // eslint-disable-next-line no-await-in-loop
          const next = yield* Effect.race(
            sub.events.pipe(Stream.runHead),
            Effect.sleep(50).pipe(Effect.as(Option.none<NostrEvent>()))
          ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
          if (Option.isNone(next)) break
          const event = next.value
          const d = event.tags.find((t) => t[0] === "d")?.[1]
          if (d && (!prefix || d.startsWith(prefix))) keys.add(d)
          count++
        }
      })

      yield* Effect.race(collectLoop, Effect.sleep(totalTimeout))
      yield* sub.unsubscribe()
      return Array.from(keys.values())
    }).pipe(
      Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url }))
    )

  return {
    _tag: "AppDataService" as const,
    put,
    putJSON,
    get,
    listKeys,
  }
})

export const AppDataServiceLive = Layer.effect(AppDataService, make)
