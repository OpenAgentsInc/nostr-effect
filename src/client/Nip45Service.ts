/**
 * Nip45Service
 *
 * NIP-45: Event Counts
 * Provides a typed API for requesting counts using RelayService.count.
 */
import { Context, Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import { RelayService } from "./RelayService.js"
import { RelayError, TimeoutError, ConnectionError } from "../core/Errors.js"
import { Filter } from "../core/Schema.js"

const decodeFilter = Schema.decodeSync(Filter)

export interface Nip45Service {
  readonly _tag: "Nip45Service"

  count(filters: readonly unknown[], timeoutMs?: number): Effect.Effect<{ count: number; approximate?: boolean }, RelayError | TimeoutError | ConnectionError>
}

export const Nip45Service = Context.GenericTag<Nip45Service>("Nip45Service")

const make = Effect.gen(function* () {
  const relay = yield* RelayService

  const count: Nip45Service["count"] = (filters, timeoutMs) =>
    relay.count(filters.map((f) => decodeFilter(f as any)), undefined, timeoutMs).pipe(
      Effect.mapError((e) => new RelayError({ message: String((e as any).message ?? e), relay: relay.url }))
    )

  return {
    _tag: "Nip45Service" as const,
    count,
  }
})

export const Nip45ServiceLive = Layer.effect(Nip45Service, make)
