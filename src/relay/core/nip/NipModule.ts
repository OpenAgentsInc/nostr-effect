/**
 * NipModule
 *
 * Interface for pluggable NIP support in the relay.
 * Each module can contribute policies, kind handlers, and relay info.
 */
import type { Effect } from "effect"
import type { NostrEvent } from "../../../core/Schema.js"
import type { Policy } from "../policy/Policy.js"
import type { RelayInfo, RelayLimitation } from "../RelayInfo.js"
import type { CryptoError, InvalidPublicKey } from "../../../core/Errors.js"
import type { EventService } from "../../../services/EventService.js"

// =============================================================================
// Types
// =============================================================================

/**
 * Hook called before an event is stored
 * Can modify the event or reject it
 */
export type PreStoreHook = (
  event: NostrEvent
) => Effect.Effect<
  | { readonly action: "store"; readonly event: NostrEvent }
  | { readonly action: "replace"; readonly event: NostrEvent; readonly deleteFilter?: EventDeleteFilter }
  | { readonly action: "reject"; readonly reason: string },
  never
>

/**
 * Filter for events to delete when replacing
 */
export interface EventDeleteFilter {
  readonly kinds?: readonly number[]
  readonly authors?: readonly string[]
  readonly dTag?: string // For parameterized replaceable events
}

/**
 * Hook called after an event is stored
 * For side effects like notifications, indexing, etc.
 */
export type PostStoreHook = (event: NostrEvent) => Effect.Effect<void, never>

/**
 * NIP Module interface
 *
 * Modules can provide:
 * - policies: Validation rules for events
 * - preStoreHook: Pre-processing before storage (e.g., replaceable event handling)
 * - postStoreHook: Post-processing after storage
 * - relayInfo: Contributions to NIP-11 relay info
 */
export interface NipModule {
  /**
   * Module identifier (e.g., "nip-01", "nip-09", "nip-16")
   */
  readonly id: string

  /**
   * NIP numbers this module implements
   */
  readonly nips: readonly number[]

  /**
   * Human-readable description
   */
  readonly description: string

  /**
   * Event kinds this module handles (for routing)
   * Empty array means module applies to all kinds
   */
  readonly kinds: readonly number[]

  /**
   * Policies contributed by this module
   * Combined with other modules using `all` combinator
   */
  readonly policies: readonly Policy<CryptoError | InvalidPublicKey, EventService>[]

  /**
   * Pre-store hook for event processing
   * Called before storing an event
   */
  readonly preStoreHook?: PreStoreHook

  /**
   * Post-store hook for side effects
   * Called after successfully storing an event
   */
  readonly postStoreHook?: PostStoreHook

  /**
   * Contributions to NIP-11 relay info
   */
  readonly relayInfo?: Partial<RelayInfo>

  /**
   * Contributions to relay limitations
   */
  readonly limitations?: Partial<RelayLimitation>
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a NIP module with defaults
 */
export const createModule = (
  config: Omit<NipModule, "policies"> & {
    policies?: NipModule["policies"]
  }
): NipModule => ({
  policies: [],
  ...config,
})

/**
 * Check if a module handles a specific kind
 */
export const handlesKind = (module: NipModule, kind: number): boolean =>
  module.kinds.length === 0 || module.kinds.includes(kind)

/**
 * Get all NIPs from a list of modules
 */
export const getAllNips = (modules: readonly NipModule[]): readonly number[] => {
  const nips = new Set<number>()
  for (const module of modules) {
    for (const nip of module.nips) {
      nips.add(nip)
    }
  }
  return [...nips].sort((a, b) => a - b)
}

/**
 * Merge relay info from multiple modules
 */
export const mergeRelayInfo = (
  modules: readonly NipModule[],
  base: Partial<RelayInfo> = {}
): Partial<RelayInfo> => {
  // Collect all supported NIPs
  const supportedNips = getAllNips(modules)

  // Merge limitations
  let limitations: Partial<RelayLimitation> = {}
  for (const module of modules) {
    if (module.limitations) {
      limitations = { ...limitations, ...module.limitations }
    }
    if (module.relayInfo?.limitation) {
      limitations = { ...limitations, ...module.relayInfo.limitation }
    }
  }

  // Merge other relay info (last wins for conflicts)
  let merged: Partial<RelayInfo> = { ...base }
  for (const module of modules) {
    if (module.relayInfo) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { limitation, supported_nips, ...rest } = module.relayInfo
      merged = { ...merged, ...rest }
    }
  }

  // Build final result
  return {
    ...merged,
    supported_nips: supportedNips,
    ...(Object.keys(limitations).length > 0 && { limitation: limitations as RelayLimitation }),
  }
}
