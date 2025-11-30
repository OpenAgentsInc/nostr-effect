/**
 * Nip77Service
 *
 * Client-side Negentropy (NIP-77) reconciliation helpers using Effect
 * and RelayService NEG session primitives.
 */
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type NegentropySessionHandle } from "./RelayService.js"
import { RelayError } from "../core/Errors.js"
import { Filter } from "../core/Schema.js"
import { encodeIdListMessage, decodeIdListMessage } from "../relay/core/negentropy/Codec.js"

const decodeFilter = Schema.decodeSync(Filter)

export interface NegentropyOpenResult extends NegentropySessionHandle {}

export interface ReconcileResult {
  readonly missingOnClient: readonly string[]
}

export interface Nip77Service {
  readonly _tag: "Nip77Service"

  /**
   * Open a Negentropy session and return a handle with message stream and helpers.
   */
  open(
    filter: Filter,
    localIds?: readonly string[],
    sessionId?: string
  ): Effect.Effect<NegentropyOpenResult, RelayError>

  /**
   * Run a single-step IdList reconciliation: returns IDs present on server
   * but not in the provided localIds.
   */
  reconcile(
    filter: Filter,
    localIds: readonly string[],
    timeoutMs?: number
  ): Effect.Effect<ReconcileResult, RelayError>
}

export const Nip77Service = Context.GenericTag<Nip77Service>("Nip77Service")

const make = Effect.gen(function* () {
  const relay = yield* RelayService

  const open: Nip77Service["open"] = (filter, localIds, sessionId) =>
    Effect.gen(function* () {
      const initialHex = encodeIdListMessage(localIds ?? [])
      const handle = yield* relay
        .negOpen(decodeFilter(filter), initialHex, sessionId)
        .pipe(
          Effect.mapError(
            (e) => new RelayError({ message: String(e), relay: relay.url })
          )
        )
      return handle
    })

  const reconcile: Nip77Service["reconcile"] = (filter, localIds, timeoutMs) =>
    Effect.gen(function* () {
      // Open and read the first NEG-MSG diff or timeout
      const sess = yield* open(filter, localIds)
      const first = yield* Effect.race(
        sess.messages.pipe(Stream.runHead),
        Effect.sleep(timeoutMs ?? 800).pipe(Effect.as(Option.none<string>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<string>())))
      yield* sess.close().pipe(Effect.ignore)

      const diffHex = Option.isSome(first) ? first.value : ""
      const ids = diffHex ? decodeIdListMessage(diffHex).ids : []
      return { missingOnClient: ids } as ReconcileResult
    }).pipe(
      Effect.mapError(
        (e) => new RelayError({ message: String(e), relay: relay.url })
      )
    )

  return {
    _tag: "Nip77Service" as const,
    open,
    reconcile,
  }
})

export const Nip77ServiceLive = Layer.effect(Nip77Service, make)

