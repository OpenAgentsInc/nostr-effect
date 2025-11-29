/**
 * MintDiscoverabilityService
 *
 * NIP-87: Ecash Mint Discoverability (cashu/fedimint)
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/87.md
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

// =============================================================================
// Types
// =============================================================================

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export type MintNetwork = "mainnet" | "testnet" | "signet" | "regtest"

/** Cashu mint information (kind 38172) */
export interface CashuMintInfoInput {
  readonly d: string // mint pubkey (from /v1/info)
  readonly url: string // https://cashu.example.com
  readonly nuts?: readonly (string | number)[] // e.g., [1,2,3]
  readonly network?: MintNetwork
  readonly content?: string // optional metadata-like JSON
}

/** Fedimint mint information (kind 38173) */
export interface FedimintInfoInput {
  readonly d: string // federation id
  readonly invites: readonly string[] // invite codes (fed11...)
  readonly modules?: readonly string[] // e.g., ["lightning","wallet","mint"]
  readonly network?: MintNetwork
  readonly content?: string // optional metadata-like JSON
}

/** Pointer to a mint info event (for 'a' tags) */
export interface MintPointer {
  readonly kind: 38172 | 38173
  readonly pubkey: string
  readonly d: string
  readonly relay?: string
  /** Optional label (e.g., "cashu" | "fedimint") */
  readonly label?: string
}

/** Recommendation (kind 38000) */
export interface MintRecommendationInput {
  readonly kind: 38172 | 38173 // which kind is being recommended
  readonly d: string // identifier of the mint info event being recommended
  readonly u?: readonly string[] // invite codes / URLs
  readonly pointers?: readonly MintPointer[] // 'a' tag pointers
  readonly content?: string // optional review text
}

/** Parsed recommendation */
export interface MintRecommendation {
  readonly event: NostrEvent
  readonly recommendedKind: 38172 | 38173
  readonly d: string
  readonly urls: readonly string[]
  readonly pointers: readonly MintPointer[]
  readonly content: string
}

// =============================================================================
// Service Interface
// =============================================================================

export interface MintDiscoverabilityService {
  readonly _tag: "MintDiscoverabilityService"

  publishCashuMintInfo(
    input: CashuMintInfoInput,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  publishFedimintInfo(
    input: FedimintInfoInput,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  recommendMint(
    input: MintRecommendationInput,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>

  /** Fetch a single mint info event by kind + d-tag */
  getMintInfoByD(params: {
    kind: 38172 | 38173
    d: string
  }): Effect.Effect<NostrEvent | null, RelayError>

  /** Find mint recommendations (kind 38000) */
  findRecommendations(params: {
    authors?: readonly string[]
    filterByKind?: 38172 | 38173
    limit?: number
  }): Effect.Effect<readonly MintRecommendation[], RelayError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const MintDiscoverabilityService = Context.GenericTag<MintDiscoverabilityService>(
  "MintDiscoverabilityService"
)

// =============================================================================
// Helpers
// =============================================================================

const toCsv = (values: readonly (string | number)[] | undefined): string | undefined => {
  if (!values || values.length === 0) return undefined
  return values.map((v) => String(v)).join(",")
}

const buildATagValue = (ptr: MintPointer): string => `${ptr.kind}:${ptr.pubkey}:${ptr.d}`

const parseRecommendation = (event: NostrEvent): MintRecommendation | undefined => {
  try {
    const kTag = event.tags.find((t) => t[0] === "k")?.[1]
    const dTag = event.tags.find((t) => t[0] === "d")?.[1]
    if (!kTag || !dTag) return undefined

    const recommendedKind = Number(kTag) as 38172 | 38173
    if (recommendedKind !== 38172 && recommendedKind !== 38173) return undefined

    const urls = event.tags
      .filter((t) => t[0] === "u")
      .map((t) => t[1]!)
      .filter(Boolean)

    const pointers: MintPointer[] = []
    for (const t of event.tags) {
      if (t[0] !== "a") continue
      const [, aVal, relay, label] = t
      const parts = (aVal ?? "").split(":")
      if (parts.length < 3) continue
      const kindNum = Number(parts[0]!) as 38172 | 38173
      if (kindNum !== 38172 && kindNum !== 38173) continue
      const pubkey = parts[1]!
      const d = parts[2]!
      if (!pubkey || !d) continue
      const base: MintPointer = { kind: kindNum, pubkey, d }
      if (typeof relay === "string") (base as any).relay = relay
      if (typeof label === "string") (base as any).label = label
      pointers.push(base)
    }

    return {
      event,
      recommendedKind,
      d: dTag,
      urls,
      pointers,
      content: event.content,
    }
  } catch {
    return undefined
  }
}

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService

  const publishCashuMintInfo: MintDiscoverabilityService["publishCashuMintInfo"] = (
    input,
    privateKey
  ) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", input.d], ["u", input.url]]
      const nutsCsv = toCsv(input.nuts)
      if (nutsCsv) tags.push(["nuts", nutsCsv])
      if (input.network) tags.push(["n", input.network])

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(38172),
          content: input.content ?? "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(
      Effect.mapError(
        (error) => new RelayError({ message: String(error), relay: relay.url })
      )
    )

  const publishFedimintInfo: MintDiscoverabilityService["publishFedimintInfo"] = (
    input,
    privateKey
  ) =>
    Effect.gen(function* () {
      const tags: string[][] = [["d", input.d]]
      for (const inv of input.invites) tags.push(["u", inv])
      if (input.modules && input.modules.length > 0)
        tags.push(["modules", input.modules.join(",")])
      if (input.network) tags.push(["n", input.network])

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(38173),
          content: input.content ?? "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(
      Effect.mapError(
        (error) => new RelayError({ message: String(error), relay: relay.url })
      )
    )

  const recommendMint: MintDiscoverabilityService["recommendMint"] = (
    input,
    privateKey
  ) =>
    Effect.gen(function* () {
      const tags: string[][] = [
        ["k", String(input.kind)],
        ["d", input.d],
      ]

      if (input.u) for (const u of input.u) tags.push(["u", u])

      if (input.pointers) {
        for (const ptr of input.pointers) {
          const a = buildATagValue(ptr)
          const tag = ["a", a]
          if (ptr.relay) tag.push(ptr.relay)
          if (ptr.label) tag.push(ptr.label)
          tags.push(tag)
        }
      }

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(38000),
          content: input.content ?? "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )
      return yield* relay.publish(event)
    }).pipe(
      Effect.mapError(
        (error) => new RelayError({ message: String(error), relay: relay.url })
      )
    )

  const getMintInfoByD: MintDiscoverabilityService["getMintInfoByD"] = ({ kind, d }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(kind)], "#d": [d], limit: 1 })
      const sub = yield* relay.subscribe([filter])

      const maybeEvent = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(600).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))

      yield* sub.unsubscribe()
      return Option.isSome(maybeEvent) ? maybeEvent.value : null
    }).pipe(
      Effect.mapError(
        (error) => new RelayError({ message: String(error), relay: relay.url })
      )
    )

  const findRecommendations: MintDiscoverabilityService["findRecommendations"] = ({
    authors,
    filterByKind,
    limit,
  }) =>
    Effect.gen(function* () {
      const base: any = { kinds: [decodeKind(38000)] }
      if (authors && authors.length > 0) base.authors = authors
      if (filterByKind) base["#k"] = [String(filterByKind)]
      if (limit) base.limit = limit
      const filter = decodeFilter(base)

      const sub = yield* relay.subscribe([filter])

      // Collect the first few events or timeout quickly
      const results: MintRecommendation[] = []

      const collectOne = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(300).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))

        if (Option.isSome(next)) {
          const parsed = parseRecommendation(next.value)
          if (parsed) results.push(parsed)
        }
      })

      // Try to read up to `limit` items (or 1 if no limit)
      const count = limit && limit > 0 ? limit : 1
      for (let i = 0; i < count; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collectOne
      }

      yield* sub.unsubscribe()
      return results
    }).pipe(
      Effect.mapError(
        (error) => new RelayError({ message: String(error), relay: relay.url })
      )
    )

  return {
    _tag: "MintDiscoverabilityService" as const,
    publishCashuMintInfo,
    publishFedimintInfo,
    recommendMint,
    getMintInfoByD,
    findRecommendations,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

export const MintDiscoverabilityServiceLive = Layer.effect(MintDiscoverabilityService, make)
