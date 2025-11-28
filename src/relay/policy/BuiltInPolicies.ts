/**
 * Built-in Policies
 *
 * Common policies for relay event validation.
 */
import { Effect } from "effect"
import { EventService } from "../../services/EventService.js"
import type { CryptoError, InvalidPublicKey } from "../../core/Errors.js"
import { type Policy, type PolicyContext, Accept, Reject } from "./Policy.js"

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Verify event signature and ID
 * Rejects if signature is invalid or ID doesn't match
 */
export const verifySignature: Policy<CryptoError | InvalidPublicKey, EventService> = (
  ctx: PolicyContext
) =>
  Effect.gen(function* () {
    const eventService = yield* EventService
    const isValid = yield* eventService.verifyEvent(ctx.event)
    return isValid ? Accept : Reject("invalid: signature verification failed")
  })

// =============================================================================
// Size Limits
// =============================================================================

/**
 * Reject events with content exceeding max bytes
 */
export const maxContentLength = (maxBytes: number): Policy<never> =>
  (ctx) => {
    const length = new TextEncoder().encode(ctx.event.content).length
    return Effect.succeed(
      length <= maxBytes ? Accept : Reject(`invalid: content exceeds ${maxBytes} bytes`)
    )
  }

/**
 * Reject events with too many tags
 */
export const maxTags = (max: number): Policy<never> =>
  (ctx) =>
    Effect.succeed(
      ctx.event.tags.length <= max ? Accept : Reject(`invalid: exceeds ${max} tags`)
    )

/**
 * Reject events with any tag value exceeding max bytes
 */
export const maxTagValueLength = (maxBytes: number): Policy<never> =>
  (ctx) => {
    for (const tag of ctx.event.tags) {
      for (const value of tag) {
        if (new TextEncoder().encode(value).length > maxBytes) {
          return Effect.succeed(Reject(`invalid: tag value exceeds ${maxBytes} bytes`))
        }
      }
    }
    return Effect.succeed(Accept)
  }

// =============================================================================
// Timestamp Limits (NIP-22)
// =============================================================================

/**
 * Reject events with created_at too far in the future
 */
export const maxFutureSeconds = (seconds: number): Policy<never> =>
  (ctx) => {
    const now = Math.floor(Date.now() / 1000)
    const maxTime = now + seconds
    return Effect.succeed(
      ctx.event.created_at <= maxTime
        ? Accept
        : Reject(`invalid: created_at too far in future`)
    )
  }

/**
 * Reject events with created_at too far in the past
 */
export const maxPastSeconds = (seconds: number): Policy<never> =>
  (ctx) => {
    const now = Math.floor(Date.now() / 1000)
    const minTime = now - seconds
    return Effect.succeed(
      ctx.event.created_at >= minTime
        ? Accept
        : Reject(`invalid: created_at too far in past`)
    )
  }

// =============================================================================
// Kind Restrictions
// =============================================================================

/**
 * Only allow specific event kinds
 */
export const allowKinds = (kinds: readonly number[]): Policy<never> =>
  (ctx) =>
    Effect.succeed(
      kinds.includes(ctx.event.kind)
        ? Accept
        : Reject(`blocked: kind ${ctx.event.kind} not allowed`)
    )

/**
 * Block specific event kinds
 */
export const blockKinds = (kinds: readonly number[]): Policy<never> =>
  (ctx) =>
    Effect.succeed(
      kinds.includes(ctx.event.kind)
        ? Reject(`blocked: kind ${ctx.event.kind} not allowed`)
        : Accept
    )

// =============================================================================
// Pubkey Restrictions
// =============================================================================

/**
 * Only allow events from specific pubkeys (whitelist)
 */
export const allowPubkeys = (pubkeys: readonly string[]): Policy<never> =>
  (ctx) =>
    Effect.succeed(
      pubkeys.includes(ctx.event.pubkey)
        ? Accept
        : Reject("blocked: pubkey not in whitelist")
    )

/**
 * Block events from specific pubkeys (blacklist)
 */
export const blockPubkeys = (pubkeys: readonly string[]): Policy<never> =>
  (ctx) =>
    Effect.succeed(
      pubkeys.includes(ctx.event.pubkey)
        ? Reject("blocked: pubkey in blacklist")
        : Accept
    )
