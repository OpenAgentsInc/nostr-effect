/**
 * Nip38Service
 *
 * NIP-38: User Statuses (kind 30315 addressable via d-tag)
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { type NostrEvent, type PrivateKey, EventKind, Filter, Tag } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export interface PublishStatusInput {
  readonly type: string // d-tag value (e.g., "general" | "music")
  readonly content: string // empty string to clear
  readonly r?: readonly string[]
  readonly p?: readonly string[]
  readonly e?: readonly string[]
  readonly a?: readonly string[]
  readonly expiration?: number // unix seconds
}

export interface GetStatusInput {
  readonly author: string
  readonly type: string
  readonly timeoutMs?: number
}

export interface Nip38Service {
  readonly _tag: "Nip38Service"

  publishStatus(input: PublishStatusInput, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  getStatus(input: GetStatusInput): Effect.Effect<NostrEvent | null, RelayError>
  clearStatus(type: string, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
}

export const Nip38Service = Context.GenericTag<Nip38Service>("Nip38Service")

const KIND_STATUS = 30315

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const publishStatus: Nip38Service["publishStatus"] = (input, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", input.type]]
      if (input.expiration) tags.push(["expiration", String(input.expiration)])
      if (input.r) for (const u of input.r) tags.push(["r", u])
      if (input.p) for (const pk of input.p) tags.push(["p", pk])
      if (input.e) for (const id of input.e) tags.push(["e", id])
      if (input.a) for (const addr of input.a) tags.push(["a", addr])

      const ev = yield* events.createEvent(
        { kind: decodeKind(KIND_STATUS), content: input.content, tags: tags.map((t) => decodeTag(t)) },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getStatus: Nip38Service["getStatus"] = ({ author, type, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(KIND_STATUS)], authors: [author], "#d": [type], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const clearStatus: Nip38Service["clearStatus"] = (type, privateKey) =>
    publishStatus({ type, content: "" }, privateKey)

  return {
    _tag: "Nip38Service" as const,
    publishStatus,
    getStatus,
    clearStatus,
  }
})

export const Nip38ServiceLive = Layer.effect(Nip38Service, make)

