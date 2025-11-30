/**
 * NipA0Service
 *
 * Lettered spec A0 (placeholder client service)
 */
import { Context, Effect, Layer } from "effect"

export interface NipA0Service {
  readonly _tag: "NipA0Service"
  info(): Effect.Effect<{ id: "A0"; status: "stub" }>
}

export const NipA0Service = Context.GenericTag<NipA0Service>("NipA0Service")

const make = Effect.succeed<NipA0Service>({
  _tag: "NipA0Service",
  info: () => Effect.succeed({ id: "A0" as const, status: "stub" as const }),
})

export const NipA0ServiceLive = Layer.effect(NipA0Service, make)

