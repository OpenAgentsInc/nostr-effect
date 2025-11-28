/**
 * Policy
 *
 * Composable policy system for event validation.
 * Policies can accept, reject, or shadow (silently drop) events.
 */
import { Effect } from "effect"
import type { NostrEvent } from "../../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

/**
 * Context passed to policies for decision making
 */
export interface PolicyContext {
  readonly event: NostrEvent
  readonly connectionId: string
  readonly remoteAddress: string | undefined
}

/**
 * Policy decision result
 */
export type PolicyDecision =
  | { readonly _tag: "Accept" }
  | { readonly _tag: "Reject"; readonly reason: string }
  | { readonly _tag: "Shadow" } // Silently drop (return OK but don't store/broadcast)

/**
 * Policy function type
 * E = error type, R = requirements (services needed)
 */
export type Policy<E = never, R = never> = (ctx: PolicyContext) => Effect.Effect<PolicyDecision, E, R>

// =============================================================================
// Decision Constructors
// =============================================================================

export const Accept: PolicyDecision = { _tag: "Accept" }

export const Reject = (reason: string): PolicyDecision => ({ _tag: "Reject", reason })

export const Shadow: PolicyDecision = { _tag: "Shadow" }

// =============================================================================
// Combinators
// =============================================================================

/**
 * Run all policies, short-circuit on first Reject or Shadow
 * Returns Accept only if all policies Accept
 */
export const all = <E, R>(...policies: Policy<E, R>[]): Policy<E, R> =>
  (ctx) =>
    Effect.gen(function* () {
      for (const policy of policies) {
        const decision = yield* policy(ctx)
        if (decision._tag !== "Accept") {
          return decision
        }
      }
      return Accept
    })

/**
 * Run policies until one Accepts
 * Returns Reject only if all policies Reject (uses last reject reason)
 */
export const any = <E, R>(...policies: Policy<E, R>[]): Policy<E, R> =>
  (ctx) =>
    Effect.gen(function* () {
      let lastReason = "no policy matched"
      for (const policy of policies) {
        const decision = yield* policy(ctx)
        if (decision._tag === "Accept") {
          return Accept
        }
        if (decision._tag === "Shadow") {
          return Shadow
        }
        if (decision._tag === "Reject") {
          lastReason = decision.reason
        }
      }
      return Reject(lastReason)
    })

/**
 * Apply policy only when predicate is true
 */
export const when = <E, R>(
  predicate: (ctx: PolicyContext) => boolean,
  policy: Policy<E, R>
): Policy<E, R> =>
  (ctx) =>
    predicate(ctx) ? policy(ctx) : Effect.succeed(Accept)

/**
 * Apply policy only for specific event kinds
 */
export const forKinds = <E, R>(kinds: readonly number[], policy: Policy<E, R>): Policy<E, R> =>
  when((ctx) => kinds.includes(ctx.event.kind), policy)

/**
 * Apply policy only for kinds NOT in the list
 */
export const exceptKinds = <E, R>(kinds: readonly number[], policy: Policy<E, R>): Policy<E, R> =>
  when((ctx) => !kinds.includes(ctx.event.kind), policy)

/**
 * Always accept (no-op policy)
 */
export const accept: Policy<never> = () => Effect.succeed(Accept)

/**
 * Always reject with given reason
 */
export const reject = (reason: string): Policy<never> => () => Effect.succeed(Reject(reason))

/**
 * Always shadow
 */
export const shadow: Policy<never> = () => Effect.succeed(Shadow)
