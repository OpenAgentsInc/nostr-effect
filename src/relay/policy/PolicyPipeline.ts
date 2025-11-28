/**
 * PolicyPipeline
 *
 * Service for running events through a configurable policy chain.
 */
import { Context, Effect, Layer } from "effect"
import type { NostrEvent } from "../../core/Schema.js"
import type { CryptoError, InvalidPublicKey } from "../../core/Errors.js"
import { EventService } from "../../services/EventService.js"
import { type Policy, type PolicyContext, type PolicyDecision, all, Accept } from "./Policy.js"
import { verifySignature, maxContentLength, maxTags } from "./BuiltInPolicies.js"

// =============================================================================
// Service Interface
// =============================================================================

export interface PolicyPipeline {
  readonly _tag: "PolicyPipeline"

  /**
   * Run an event through the policy pipeline
   * EventService is provided internally - callers don't need to provide it
   */
  evaluate(
    event: NostrEvent,
    connectionId: string,
    remoteAddress?: string
  ): Effect.Effect<PolicyDecision, CryptoError | InvalidPublicKey>
}

// =============================================================================
// Service Tag
// =============================================================================

export const PolicyPipeline = Context.GenericTag<PolicyPipeline>("PolicyPipeline")

// =============================================================================
// Default Policy Configuration
// =============================================================================

const DEFAULT_MAX_CONTENT_LENGTH = 64 * 1024 // 64KB
const DEFAULT_MAX_TAGS = 2000

/**
 * Default policy chain:
 * 1. Verify signature (required)
 * 2. Content size limit
 * 3. Tag count limit
 */
const defaultPolicy: Policy<CryptoError | InvalidPublicKey, EventService> = all(
  verifySignature,
  maxContentLength(DEFAULT_MAX_CONTENT_LENGTH),
  maxTags(DEFAULT_MAX_TAGS)
)

// =============================================================================
// Service Implementation
// =============================================================================

const make = (
  policy: Policy<CryptoError | InvalidPublicKey, EventService> = defaultPolicy
) =>
  Effect.gen(function* () {
    const eventService = yield* EventService

    return {
      _tag: "PolicyPipeline" as const,

      evaluate: (
        event: NostrEvent,
        connectionId: string,
        remoteAddress?: string
      ): Effect.Effect<PolicyDecision, CryptoError | InvalidPublicKey> => {
        const ctx: PolicyContext = { event, connectionId, remoteAddress }
        // Provide EventService internally so callers don't need to
        return policy(ctx).pipe(Effect.provideService(EventService, eventService))
      },
    }
  })

// =============================================================================
// Service Layers
// =============================================================================

/**
 * Default PolicyPipeline with standard policies
 */
export const PolicyPipelineLive = Layer.effect(PolicyPipeline, make())

/**
 * Create a custom PolicyPipeline with specific policies
 */
export const PolicyPipelineCustom = (
  policy: Policy<CryptoError | InvalidPublicKey, EventService>
) => Layer.effect(PolicyPipeline, make(policy))

/**
 * No-op pipeline that accepts everything (for testing)
 */
export const PolicyPipelinePermissive = Layer.succeed(PolicyPipeline, {
  _tag: "PolicyPipeline",
  evaluate: () => Effect.succeed(Accept),
})
