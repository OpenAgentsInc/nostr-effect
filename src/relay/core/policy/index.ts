/**
 * Policy Module
 *
 * Composable policy system for event validation.
 */

// Core types and combinators
export {
  type Policy,
  type PolicyContext,
  type PolicyDecision,
  Accept,
  Reject,
  Shadow,
  all,
  any,
  when,
  forKinds,
  exceptKinds,
  accept,
  reject,
  shadow,
} from "./Policy.js"

// Built-in policies
export {
  verifySignature,
  maxContentLength,
  maxTags,
  maxTagValueLength,
  maxFutureSeconds,
  maxPastSeconds,
  allowKinds,
  blockKinds,
  allowPubkeys,
  blockPubkeys,
} from "./BuiltInPolicies.js"

// Service
export {
  PolicyPipeline,
  PolicyPipelineLive,
  PolicyPipelineCustom,
  PolicyPipelinePermissive,
} from "./PolicyPipeline.js"
