/**
 * NipRegistry
 *
 * Service for managing and combining NIP modules.
 * Provides a unified interface for policies, hooks, and relay info.
 */
import { Context, Effect, Layer } from "effect"
import type { NostrEvent } from "../../../core/Schema.js"
import type { CryptoError, InvalidPublicKey } from "../../../core/Errors.js"
import { EventService } from "../../../services/EventService.js"
import { type Policy, all, Accept } from "../policy/Policy.js"
import {
  type NipModule,
  handlesKind,
  getAllNips,
  mergeRelayInfo,
} from "./NipModule.js"
import type { RelayInfo } from "../RelayInfo.js"

// =============================================================================
// Service Interface
// =============================================================================

export interface NipRegistry {
  readonly _tag: "NipRegistry"

  /**
   * Get all registered modules
   */
  readonly modules: readonly NipModule[]

  /**
   * Get all supported NIP numbers
   */
  readonly supportedNips: readonly number[]

  /**
   * Get combined relay info from all modules
   */
  getRelayInfo(base?: Partial<RelayInfo>): Partial<RelayInfo>

  /**
   * Get combined policy from all modules
   */
  getPolicy(): Policy<CryptoError | InvalidPublicKey, EventService>

  /**
   * Run pre-store hooks for an event
   * Returns the processed event or rejection
   */
  runPreStoreHooks(
    event: NostrEvent
  ): Effect.Effect<
    | { readonly action: "store"; readonly event: NostrEvent }
    | { readonly action: "replace"; readonly event: NostrEvent; readonly deleteFilter?: { kinds?: readonly number[]; authors?: readonly string[]; dTag?: string } }
    | { readonly action: "reject"; readonly reason: string },
    never
  >

  /**
   * Run post-store hooks for an event
   */
  runPostStoreHooks(event: NostrEvent): Effect.Effect<void, never>

  /**
   * Check if a module is registered by ID
   */
  hasModule(id: string): boolean

  /**
   * Get a module by ID
   */
  getModule(id: string): NipModule | undefined
}

// =============================================================================
// Service Tag
// =============================================================================

export const NipRegistry = Context.GenericTag<NipRegistry>("NipRegistry")

// =============================================================================
// Service Implementation
// =============================================================================

const make = (modules: readonly NipModule[]): NipRegistry => {
  const moduleMap = new Map(modules.map((m) => [m.id, m]))
  const supportedNips = getAllNips(modules)

  // Combine all policies from all modules
  const combinedPolicy: Policy<CryptoError | InvalidPublicKey, EventService> = (ctx) => {
    const applicablePolicies = modules
      .filter((m) => handlesKind(m, ctx.event.kind))
      .flatMap((m) => m.policies)

    if (applicablePolicies.length === 0) {
      return Effect.succeed(Accept)
    }

    return all(...applicablePolicies)(ctx)
  }

  return {
    _tag: "NipRegistry",
    modules,
    supportedNips,

    getRelayInfo: (base) => mergeRelayInfo(modules, base),

    getPolicy: () => combinedPolicy,

    runPreStoreHooks: (event) =>
      Effect.gen(function* () {
        let currentEvent = event

        // Get modules that handle this kind and have pre-store hooks
        const applicableModules = modules.filter(
          (m) => m.preStoreHook && handlesKind(m, event.kind)
        )

        for (const module of applicableModules) {
          const result = yield* module.preStoreHook!(currentEvent)

          if (result.action === "reject") {
            return result
          }

          if (result.action === "replace") {
            return result
          }

          // action === "store" - continue with potentially modified event
          currentEvent = result.event
        }

        return { action: "store" as const, event: currentEvent }
      }),

    runPostStoreHooks: (event) =>
      Effect.gen(function* () {
        const applicableModules = modules.filter(
          (m) => m.postStoreHook && handlesKind(m, event.kind)
        )

        for (const module of applicableModules) {
          yield* module.postStoreHook!(event)
        }
      }),

    hasModule: (id) => moduleMap.has(id),

    getModule: (id) => moduleMap.get(id),
  }
}

// =============================================================================
// Service Layers
// =============================================================================

/**
 * Create NipRegistry with specific modules
 */
export const NipRegistryLive = (modules: readonly NipModule[]) =>
  Layer.succeed(NipRegistry, make(modules))

/**
 * Empty registry (for testing)
 */
export const NipRegistryEmpty = Layer.succeed(NipRegistry, make([]))
