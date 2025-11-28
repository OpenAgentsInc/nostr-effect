/**
 * NIP-11 Module
 *
 * Relay Information Document - metadata about the relay.
 */
import { type NipModule, createModule } from "../NipModule.js"
import type { RelayInfo } from "../../RelayInfo.js"

// =============================================================================
// Configuration
// =============================================================================

export interface Nip11Config {
  /** Relay name */
  readonly name?: string
  /** Relay description */
  readonly description?: string
  /** Admin pubkey (32-byte hex) */
  readonly pubkey?: string
  /** Contact information (email, URL, etc.) */
  readonly contact?: string
  /** Software URL */
  readonly software?: string
  /** Software version */
  readonly version?: string
}

// =============================================================================
// Module
// =============================================================================

/**
 * Create NIP-11 module with relay info configuration
 */
export const createNip11Module = (config: Nip11Config = {}): NipModule => {
  const relayInfo: Partial<RelayInfo> = {
    ...(config.name && { name: config.name }),
    ...(config.description && { description: config.description }),
    ...(config.pubkey && { pubkey: config.pubkey }),
    ...(config.contact && { contact: config.contact }),
    ...(config.software && { software: config.software }),
    ...(config.version && { version: config.version }),
  }

  return createModule({
    id: "nip-11",
    nips: [11],
    description: "Relay Information Document",
    kinds: [], // Doesn't handle any specific kinds
    relayInfo,
  })
}

/**
 * Default NIP-11 module with minimal info
 */
export const Nip11Module = createNip11Module({
  name: "nostr-effect relay",
  description: "Effect-based Nostr relay implementation",
  software: "https://github.com/OpenAgentsInc/nostr-effect",
  version: "0.1.0",
})
