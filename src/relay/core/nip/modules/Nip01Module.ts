/**
 * NIP-01 Module
 *
 * Basic protocol flow - event types, filters, and signatures.
 * This is the foundation module that every relay needs.
 */
import { type NipModule, createModule } from "../NipModule.js"
import {
  verifySignature,
  maxContentLength,
  maxTags,
  maxFutureSeconds,
  maxPastSeconds,
} from "../../policy/BuiltInPolicies.js"
import type { Policy } from "../../policy/Policy.js"
import type { CryptoError, InvalidPublicKey } from "../../../../core/Errors.js"
import type { EventService } from "../../../../services/EventService.js"

// =============================================================================
// Configuration
// =============================================================================

export interface Nip01Config {
  /** Maximum content length in bytes (default: 64KB) */
  readonly maxContentLength?: number
  /** Maximum number of tags per event (default: 2000) */
  readonly maxTags?: number
  /**
   * Maximum seconds in the future for created_at (default: undefined = no limit)
   * Events with created_at more than this many seconds in the future will be rejected.
   * Reported in NIP-11 as created_at_upper_limit.
   */
  readonly maxFutureSeconds?: number
  /**
   * Maximum age of events in seconds (default: undefined = no limit)
   * Events older than this many seconds will be rejected.
   * Reported in NIP-11 as created_at_lower_limit.
   */
  readonly maxPastSeconds?: number
}

interface InternalConfig {
  maxContentLength: number
  maxTags: number
  maxFutureSeconds?: number
  maxPastSeconds?: number
}

const DEFAULT_CONFIG: InternalConfig = {
  maxContentLength: 64 * 1024, // 64KB
  maxTags: 2000,
}

// =============================================================================
// Module
// =============================================================================

/**
 * Create NIP-01 module with optional configuration
 */
export const createNip01Module = (config: Nip01Config = {}): NipModule => {
  const cfg: InternalConfig = { ...DEFAULT_CONFIG, ...config }

  // Build policy list - always include signature, content length, and tags
  const policies: Policy<CryptoError | InvalidPublicKey, EventService>[] = [
    verifySignature,
    maxContentLength(cfg.maxContentLength),
    maxTags(cfg.maxTags),
  ]

  // Add timestamp policies if configured
  if (cfg.maxFutureSeconds !== undefined) {
    policies.push(maxFutureSeconds(cfg.maxFutureSeconds))
  }
  if (cfg.maxPastSeconds !== undefined) {
    policies.push(maxPastSeconds(cfg.maxPastSeconds))
  }

  // Build limitations object
  const limitations: {
    max_content_length: number
    max_event_tags: number
    created_at_lower_limit?: number
    created_at_upper_limit?: number
  } = {
    max_content_length: cfg.maxContentLength,
    max_event_tags: cfg.maxTags,
  }

  // Add timestamp limits to NIP-11 if configured
  if (cfg.maxPastSeconds !== undefined) {
    limitations.created_at_lower_limit = cfg.maxPastSeconds
  }
  if (cfg.maxFutureSeconds !== undefined) {
    limitations.created_at_upper_limit = cfg.maxFutureSeconds
  }

  return createModule({
    id: "nip-01",
    nips: [1],
    description: "Basic protocol flow: events, filters, subscriptions",
    kinds: [], // Applies to all kinds
    policies,
    limitations,
  })
}

/**
 * Default NIP-01 module instance
 */
export const Nip01Module = createNip01Module()
