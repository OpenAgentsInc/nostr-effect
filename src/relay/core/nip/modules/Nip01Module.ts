/**
 * NIP-01 Module
 *
 * Basic protocol flow - event types, filters, and signatures.
 * This is the foundation module that every relay needs.
 */
import { type NipModule, createModule } from "../NipModule.js"
import { verifySignature, maxContentLength, maxTags } from "../../policy/BuiltInPolicies.js"

// =============================================================================
// Configuration
// =============================================================================

export interface Nip01Config {
  /** Maximum content length in bytes (default: 64KB) */
  readonly maxContentLength?: number
  /** Maximum number of tags per event (default: 2000) */
  readonly maxTags?: number
}

const DEFAULT_CONFIG: Required<Nip01Config> = {
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
  const cfg = { ...DEFAULT_CONFIG, ...config }

  return createModule({
    id: "nip-01",
    nips: [1],
    description: "Basic protocol flow: events, filters, subscriptions",
    kinds: [], // Applies to all kinds

    policies: [
      verifySignature,
      maxContentLength(cfg.maxContentLength),
      maxTags(cfg.maxTags),
    ],

    limitations: {
      max_content_length: cfg.maxContentLength,
      max_event_tags: cfg.maxTags,
    },
  })
}

/**
 * Default NIP-01 module instance
 */
export const Nip01Module = createNip01Module()
