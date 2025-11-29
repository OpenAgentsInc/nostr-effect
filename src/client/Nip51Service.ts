/**
 * Nip51Service
 *
 * NIP-51: Lists (standard replaceable kinds 10000-19999 and parameterized 30000-39999)
 * - Public items are represented by event tags
 * - Private items are stored in .content as JSON, encrypted using NIP-44 with
 *   a conversation key derived from (author's private key, author's public key)
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { Nip44Service } from "../services/Nip44Service.js"
import { CryptoService } from "../services/CryptoService.js"
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

export interface PublishListOptions {
  readonly kind: number // e.g., 10003 bookmarks, 10000 mute, or 300xx parameterized
  readonly d?: string // required for 300xx kinds
  readonly publicTags?: readonly string[][]
  readonly privateItems?: readonly string[][]
}

export interface GetListOptions {
  readonly author: string
  readonly kind: number
  readonly d?: string // for 300xx
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface DecryptListOptions {
  readonly event: NostrEvent
  readonly authorPrivateKey: PrivateKey
}

export interface DecryptedList {
  readonly event: NostrEvent
  readonly publicTags: readonly string[][]
  readonly privateItems?: readonly string[][]
}

export interface Nip51Service {
  readonly _tag: "Nip51Service"

  publishList(options: PublishListOptions, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  getLatestList(options: GetListOptions): Effect.Effect<NostrEvent | null, RelayError>

  decryptPrivateItems(options: DecryptListOptions): Effect.Effect<readonly string[][] | null, RelayError>
}

export const Nip51Service = Context.GenericTag<Nip51Service>("Nip51Service")

const isParameterized = (kind: number): boolean => kind >= 30000 && kind < 40000

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  const nip44 = yield* Nip44Service
  const crypto = yield* CryptoService

  const publishList: Nip51Service["publishList"] = (options, privateKey) =>
    Effect.gen(function* () {
      const { kind, d, publicTags = [], privateItems } = options
      if (isParameterized(kind) && !d) {
        return yield* Effect.fail(new RelayError({ message: "d is required for 300xx kinds", relay: relay.url }))
      }

      let content = ""
      if (privateItems && privateItems.length > 0) {
        const authorPub = yield* crypto.getPublicKey(privateKey)
        const ck = yield* nip44.getConversationKey(privateKey, authorPub)
        const plaintext = JSON.stringify(privateItems)
        content = yield* nip44.encrypt(plaintext, ck)
      }

      const tags: string[][] = []
      if (isParameterized(kind)) tags.push(["d", d!])
      for (const t of publicTags) tags.push(t)

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(kind),
          content,
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getLatestList: Nip51Service["getLatestList"] = ({ author, kind, d, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const f: any = { kinds: [decodeKind(kind)], authors: [author], limit: limit ?? 1 }
      if (isParameterized(kind)) f["#d"] = [d]
      const filter = decodeFilter(f)
      const sub = yield* relay.subscribe([filter])

      const maybeEvent = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))

      yield* sub.unsubscribe()
      return Option.isSome(maybeEvent) ? maybeEvent.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const decryptPrivateItems: Nip51Service["decryptPrivateItems"] = ({ event, authorPrivateKey }) =>
    Effect.gen(function* () {
      if (!event.content || event.content.length === 0) return null
      // Derive conversation key against self (author)
      const authorPub = event.pubkey
      const ck = yield* nip44.getConversationKey(authorPrivateKey, authorPub)
      const plaintext = yield* nip44.decrypt(event.content as any, ck)
      try {
        const arr = JSON.parse(plaintext)
        if (Array.isArray(arr)) return arr as readonly string[][]
        return null
      } catch {
        return null
      }
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "Nip51Service" as const,
    publishList,
    getLatestList,
    decryptPrivateItems,
  }
})

export const Nip51ServiceLive = Layer.effect(Nip51Service, make)

