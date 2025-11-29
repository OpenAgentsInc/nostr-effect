/**
 * RelayPool
 *
 * Multi-relay orchestration service for managing connections to multiple relays,
 * publishing events in parallel, and merging subscription streams with deduplication.
 */
import { Context, Effect, Layer, Stream, Ref } from "effect"
import {
  ConnectionError,
  SubscriptionError,
} from "../core/Errors.js"
import {
  NostrEvent,
  Filter,
  EventId,
} from "../core/Schema.js"
import {
  RelayService,
  makeRelayServiceScoped,
  type SubscriptionHandle,
} from "./RelayService.js"

// =============================================================================
// Types
// =============================================================================

/** Status of a specific relay */
export type RelayStatus =
  | { readonly status: "connected" }
  | { readonly status: "connecting" }
  | { readonly status: "disconnected"; readonly reason?: string }

/** Failure info for a relay */
export interface RelayFailure {
  readonly url: string
  readonly reason: string
}

/** Result of publishing to multiple relays */
export interface PoolPublishResult {
  readonly successes: ReadonlyArray<string>
  readonly failures: ReadonlyArray<RelayFailure>
}

/** Pool configuration */
export interface RelayPoolConfig {
  readonly autoConnect?: boolean
  readonly deduplicateEvents?: boolean
}

/** Internal relay entry */
interface RelayEntry {
  readonly url: string
  readonly service: RelayService
}

// =============================================================================
// Service Interface
// =============================================================================

export interface RelayPool {
  readonly _tag: "RelayPool"

  /**
   * Add a relay to the pool
   */
  addRelay(url: string): Effect.Effect<void, ConnectionError>

  /**
   * Remove a relay from the pool
   */
  removeRelay(url: string): Effect.Effect<void>

  /**
   * Get list of all relay URLs in the pool
   */
  getRelays(): Effect.Effect<ReadonlyArray<string>>

  /**
   * Get connection status for a specific relay
   */
  getRelayStatus(url: string): Effect.Effect<RelayStatus | null>

  /**
   * Get list of connected relay URLs
   */
  getConnectedRelays(): Effect.Effect<ReadonlyArray<string>>

  /**
   * Publish an event to all connected relays in parallel
   */
  publish(event: NostrEvent): Effect.Effect<PoolPublishResult, never>

  /**
   * Subscribe to events matching filters across all connected relays
   * Merges streams from all relays and deduplicates by event ID
   */
  subscribe(
    filters: readonly Filter[]
  ): Effect.Effect<SubscriptionHandle, ConnectionError | SubscriptionError>

  /**
   * Close all connections and cleanup
   */
  close(): Effect.Effect<void>
}

// =============================================================================
// Service Tag
// =============================================================================

export const RelayPool = Context.GenericTag<RelayPool>("RelayPool")

// =============================================================================
// Service Implementation
// =============================================================================

const make = (config: RelayPoolConfig = {}) =>
  Effect.gen(function* () {
    const relaysRef = yield* Ref.make<Map<string, RelayEntry>>(new Map())

    const normalizeUrl = (url: string): string => {
      // Basic URL normalization
      let normalized = url.trim().toLowerCase()

      // Add protocol if missing (default to wss://)
      if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
        normalized = `wss://${normalized}`
      }

      // Remove trailing slash
      if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1)
      }

      return normalized
    }

    const addRelay: RelayPool["addRelay"] = (url) =>
      Effect.gen(function* () {
        const normalizedUrl = normalizeUrl(url)
        const relays = yield* Ref.get(relaysRef)

        // Check if relay already exists
        if (relays.has(normalizedUrl)) {
          return
        }

        // Create new relay service
        const service = yield* makeRelayServiceScoped({
          url: normalizedUrl,
          reconnect: true,
        })

        // Connect if auto-connect is enabled
        if (config.autoConnect !== false) {
          yield* service.connect()
        }

        // Add to map
        const newRelays = new Map(relays)
        newRelays.set(normalizedUrl, { url: normalizedUrl, service })
        yield* Ref.set(relaysRef, newRelays)
      })

    const removeRelay: RelayPool["removeRelay"] = (url) =>
      Effect.gen(function* () {
        const normalizedUrl = normalizeUrl(url)
        const relays = yield* Ref.get(relaysRef)

        const entry = relays.get(normalizedUrl)
        if (!entry) {
          return
        }

        // Disconnect
        yield* entry.service.disconnect()

        // Remove from map
        const newRelays = new Map(relays)
        newRelays.delete(normalizedUrl)
        yield* Ref.set(relaysRef, newRelays)
      })

    const getRelays: RelayPool["getRelays"] = () =>
      Effect.gen(function* () {
        const relays = yield* Ref.get(relaysRef)
        return Array.from(relays.keys())
      })

    const getRelayStatus: RelayPool["getRelayStatus"] = (url) =>
      Effect.gen(function* () {
        const normalizedUrl = normalizeUrl(url)
        const relays = yield* Ref.get(relaysRef)

        const entry = relays.get(normalizedUrl)
        if (!entry) {
          return null
        }

        const state = yield* entry.service.connectionState()

        switch (state) {
          case "connected":
            return { status: "connected" as const }
          case "connecting":
            return { status: "connecting" as const }
          case "disconnected":
            return { status: "disconnected" as const }
        }
      })

    const getConnectedRelays: RelayPool["getConnectedRelays"] = () =>
      Effect.gen(function* () {
        const relays = yield* Ref.get(relaysRef)
        const connected: string[] = []

        for (const [url, entry] of relays.entries()) {
          const state = yield* entry.service.connectionState()
          if (state === "connected") {
            connected.push(url)
          }
        }

        return connected
      })

    const publish: RelayPool["publish"] = (event) =>
      Effect.gen(function* () {
        const relays = yield* Ref.get(relaysRef)
        const entries = Array.from(relays.values())

        // Filter to only connected relays
        const connected: RelayEntry[] = []
        for (const entry of entries) {
          const state = yield* entry.service.connectionState()
          if (state === "connected") {
            connected.push(entry)
          }
        }

        if (connected.length === 0) {
          return {
            successes: [],
            failures: [],
          }
        }

        // Publish to all connected relays in parallel
        const results = yield* Effect.all(
          connected.map((entry) =>
            entry.service.publish(event).pipe(
              Effect.map((result) => ({
                url: entry.url,
                success: result.accepted,
                message: result.message,
              })),
              Effect.catchAll((error) =>
                Effect.succeed({
                  url: entry.url,
                  success: false,
                  message: error instanceof Error ? error.message : String(error),
                })
              )
            )
          ),
          { concurrency: "unbounded" }
        )

        // Aggregate results
        const successes: string[] = []
        const failures: RelayFailure[] = []

        for (const result of results) {
          if (result.success) {
            successes.push(result.url)
          } else {
            failures.push({
              url: result.url,
              reason: result.message,
            })
          }
        }

        return { successes, failures }
      })

    const subscribe: RelayPool["subscribe"] = (filters) =>
      Effect.gen(function* () {
        const relays = yield* Ref.get(relaysRef)
        const entries = Array.from(relays.values())

        // Filter to only connected relays
        const connected: RelayEntry[] = []
        for (const entry of entries) {
          const state = yield* entry.service.connectionState()
          if (state === "connected") {
            connected.push(entry)
          }
        }

        if (connected.length === 0) {
          return yield* Effect.fail(
            new ConnectionError({ message: "No connected relays", url: "pool" })
          )
        }

        // Subscribe to all connected relays
        const handles = yield* Effect.all(
          connected.map((entry) =>
            entry.service.subscribe(filters).pipe(
              Effect.catchAll((_err) => {
                // Log error but don't fail if some relays can't subscribe
                return Effect.succeed(null)
              })
            )
          )
        )

        // Filter out null handles from failed subscriptions
        const validHandles = handles.filter((h): h is SubscriptionHandle => h !== null)

        if (validHandles.length === 0) {
          return yield* Effect.fail(
            new SubscriptionError({
              message: "Failed to subscribe to any relay",
              subscriptionId: "pool",
            })
          )
        }

        // Merge all event streams
        const mergedStream: Stream.Stream<NostrEvent, SubscriptionError> = Stream.mergeAll(
          validHandles.map((handle) => handle.events),
          { concurrency: "unbounded" }
        )

        // Deduplicate events by ID if enabled
        const deduplicatedStream: Stream.Stream<NostrEvent, SubscriptionError> = config.deduplicateEvents !== false
          ? mergedStream.pipe(
              Stream.mapAccum(new Set<EventId>(), (seen, event) => {
                if (seen.has(event.id)) {
                  return [seen, null as NostrEvent | null] // Skip duplicate
                }
                const newSeen = new Set(seen)
                newSeen.add(event.id)
                return [newSeen, event as NostrEvent | null]
              }),
              Stream.filter((event): event is NostrEvent => event !== null)
            )
          : mergedStream

        // Combined unsubscribe function
        const unsubscribe = (): Effect.Effect<void> =>
          Effect.all(
            validHandles.map((handle) => handle.unsubscribe()),
            { discard: true }
          )

        return {
          id: "pool" as any, // Pool-wide subscription doesn't have a single ID
          events: deduplicatedStream,
          unsubscribe,
        }
      })

    const close: RelayPool["close"] = () =>
      Effect.gen(function* () {
        const relays = yield* Ref.get(relaysRef)

        // Disconnect all relays
        yield* Effect.all(
          Array.from(relays.values()).map((entry) => entry.service.disconnect()),
          { discard: true }
        )

        // Clear the map
        yield* Ref.set(relaysRef, new Map())
      })

    return {
      _tag: "RelayPool" as const,
      addRelay,
      removeRelay,
      getRelays,
      getRelayStatus,
      getConnectedRelays,
      publish,
      subscribe,
      close,
    }
  })

// =============================================================================
// Layer Constructor
// =============================================================================

/**
 * Create a RelayPool layer
 */
export const makeRelayPool = (config?: RelayPoolConfig): Layer.Layer<RelayPool> =>
  Layer.effect(RelayPool, make(config))

/**
 * Create a RelayPool with initial relays
 */
export const makeRelayPoolWithRelays = (
  urls: readonly string[],
  config?: RelayPoolConfig
): Layer.Layer<RelayPool> =>
  Layer.effect(
    RelayPool,
    Effect.gen(function* () {
      const pool = yield* make(config)

      // Add all relays, ignoring connection errors
      yield* Effect.all(
        urls.map((url) => pool.addRelay(url).pipe(Effect.ignore)),
        { discard: true }
      )

      return pool
    })
  )
