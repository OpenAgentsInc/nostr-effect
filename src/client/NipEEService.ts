/**
 * NipEEService
 *
 * NIP-EE: MLS E2EE Messaging helpers
 * - KeyPackage event (kind 443)
 * - KeyPackage relays list (kind 10051)
 * - Welcome event (kind 444) wrapped via NIP-59 gift wrap (unsinged rumor)
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { EventKind, Filter, Tag, type NostrEvent, type PrivateKey } from "../core/Schema.js"
import { wrapEvent, type GiftWrappedEvent } from "../core/Nip59.js"
import { MLSKeyPackage, MLSWelcome, MLSKeyPackageRelays } from "../wrappers/kinds.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

// =============================================================================
// Params
// =============================================================================

export interface PublishKeyPackageParams {
  readonly keyPackageHex: string // hex-encoded serialized KeyPackageBundle
  readonly mlsProtocolVersion: string // e.g., "1.0"
  readonly ciphersuite: string // e.g., "0x0001"
  readonly extensions?: readonly string[] // e.g., ["0x0001", "0x0002"]
  readonly clientInfo?: readonly [name: string, handlerEventId: string, relayUrl?: string]
  readonly relays: readonly string[]
  readonly createdAt?: number
  readonly extraTags?: readonly string[][]
}

export interface PublishKeyPackageRelaysParams {
  readonly relays: readonly string[]
  readonly createdAt?: number
}

export interface CreateWelcomeParams {
  readonly welcomeSerialized: string // MLS Welcome object serialized (string)
  readonly keyPackageEventId: string // ID of KeyPackage Event used to add user
  readonly relays: readonly string[] // relays to query for Group Events
  readonly senderPrivateKey: Uint8Array // bytes for nip59 wrapping
  readonly recipientPublicKey: string // hex
  readonly createdAt?: number
}

export interface NipEEService {
  readonly _tag: "NipEEService"

  publishKeyPackage(params: PublishKeyPackageParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>
  publishKeyPackageRelays(params: PublishKeyPackageRelaysParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  createWelcomeWrap(params: CreateWelcomeParams): Effect.Effect<GiftWrappedEvent>
  publishWelcomeWrap(wrap: GiftWrappedEvent): Effect.Effect<PublishResult, RelayError>

  // Convenience: retrieve latest KeyPackage by author
  getLatestKeyPackage(author: string, timeoutMs?: number): Effect.Effect<NostrEvent | null, RelayError>
}

export const NipEEService = Context.GenericTag<NipEEService>("NipEEService")

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const publishKeyPackage: NipEEService["publishKeyPackage"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [
        ["mls_protocol_version", params.mlsProtocolVersion],
        ["ciphersuite", params.ciphersuite],
      ]
      if (params.extensions && params.extensions.length > 0) {
        tags.push(["extensions", ...params.extensions])
      }
      if (params.clientInfo) {
        const [name, handlerEventId, relayUrl] = params.clientInfo
        tags.push(relayUrl ? ["client", name, handlerEventId, relayUrl] : ["client", name, handlerEventId])
      }
      if (params.relays && params.relays.length > 0) {
        tags.push(["relays", ...params.relays])
      }
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))

      const ev = yield* events.createEvent(
        {
          kind: decodeKind(MLSKeyPackage),
          content: params.keyPackageHex,
          tags: tags.map((t) => decodeTag(t)),
          created_at: (params.createdAt ?? undefined) as any,
        },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishKeyPackageRelays: NipEEService["publishKeyPackageRelays"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = params.relays.map((u) => ["relay", u])
      const ev = yield* events.createEvent(
        {
          kind: decodeKind(MLSKeyPackageRelays),
          content: "",
          tags: tags.map((t) => decodeTag(t)),
          created_at: (params.createdAt ?? undefined) as any,
        },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const createWelcomeWrap: NipEEService["createWelcomeWrap"] = (params) =>
    Effect.gen(function* () {
      const rumor = {
        kind: decodeKind(MLSWelcome),
        content: params.welcomeSerialized,
        tags: [
          decodeTag(["e", params.keyPackageEventId]),
          decodeTag(["relays", ...params.relays]),
        ],
        created_at: (params.createdAt ?? undefined) as any,
      }
      const wrap = wrapEvent(rumor, params.senderPrivateKey, params.recipientPublicKey)
      return wrap
    })

  const publishWelcomeWrap: NipEEService["publishWelcomeWrap"] = (wrap) =>
    Effect.gen(function* () {
      // Cast GiftWrappedEvent to NostrEvent for publishing
      const ev = wrap as unknown as NostrEvent
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const getLatestKeyPackage: NipEEService["getLatestKeyPackage"] = (author, timeoutMs) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(MLSKeyPackage)], authors: [author], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "NipEEService" as const,
    publishKeyPackage,
    publishKeyPackageRelays,
    createWelcomeWrap,
    publishWelcomeWrap,
    getLatestKeyPackage,
  }
})

export const NipEEServiceLive = Layer.effect(NipEEService, make)
