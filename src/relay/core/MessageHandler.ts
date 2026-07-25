/**
 * MessageHandler
 *
 * Routes NIP-01 client messages to appropriate handlers.
 * Returns relay messages for the client and broadcasts.
 */
import { Context, Effect, Layer, Option } from "effect"
import { Schema } from "effect"
import { EventStore } from "../storage/EventStore.js"
import { SubscriptionManager, type Subscription } from "./SubscriptionManager.js"
import { PolicyPipeline } from "./policy/index.js"
import { MessageParseError, DuplicateEvent, StorageError } from "../../core/Errors.js"
import type { CryptoError, InvalidPublicKey } from "../../core/Errors.js"
import {
  ClientMessage,
  type NostrEvent,
  type RelayMessage,
  type SubscriptionId,
  type EventId,
  isReplaceableKind,
  isParameterizedReplaceableKind,
  isEphemeralKind,
  getDTagValue,
} from "../../core/Schema.js"
import { NipRegistry } from "./nip/NipRegistry.js"
import { encodeIdListMessage, decodeIdListMessage } from "./negentropy/Codec.js"
import { AuthService } from "./AuthService.js"

// =============================================================================
// Response Types
// =============================================================================

export interface HandleResult {
  /** Messages to send back to the originating connection */
  readonly responses: readonly RelayMessage[]
  /** Messages to broadcast to other connections (subscription matches) */
  readonly broadcasts: readonly BroadcastMessage[]
}

export interface BroadcastMessage {
  readonly connectionId: string
  readonly subscriptionId: SubscriptionId
  readonly event: NostrEvent
}

// =============================================================================
// Service Interface
// =============================================================================

export interface MessageHandler {
  readonly _tag: "MessageHandler"

  /**
   * Handle a raw message string from a client
   */
  handleRaw(connectionId: string, raw: string): Effect.Effect<HandleResult, MessageParseError>

  /**
   * Handle a parsed client message
   */
  handleMessage(
    connectionId: string,
    message: ClientMessage
  ): Effect.Effect<HandleResult, StorageError | CryptoError | InvalidPublicKey | DuplicateEvent>
}

// =============================================================================
// Service Tag
// =============================================================================

export const MessageHandler = Context.Service<MessageHandler>("MessageHandler")

// =============================================================================
// Message Building Helpers
// =============================================================================

const okMessage = (eventId: EventId, success: boolean, message: string): RelayMessage =>
  ["OK", eventId, success, message] as RelayMessage

const eventMessage = (subscriptionId: SubscriptionId, event: NostrEvent): RelayMessage =>
  ["EVENT", subscriptionId, event] as RelayMessage

/** NIP-01 EOSE; optional NIP-67 completeness hints (`finish` / `more`). */
const eoseMessage = (
  subscriptionId: SubscriptionId,
  hints?: readonly string[]
): RelayMessage =>
  (hints !== undefined
    ? (["EOSE", subscriptionId, hints] as RelayMessage)
    : (["EOSE", subscriptionId] as RelayMessage))

const noticeMessage = (message: string): RelayMessage =>
  ["NOTICE", message] as RelayMessage

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Core message handler implementation
 * @param nipRegistry - Optional NipRegistry for hook-based event handling
 * @param authService - Optional AuthService for NIP-42 authentication
 */
const make = (nipRegistry?: NipRegistry, authService?: AuthService) =>
  Effect.gen(function* () {
    const eventStore = yield* EventStore
    const subscriptionManager = yield* SubscriptionManager
    const policyPipeline = yield* PolicyPipeline
    // NIP-77: minimal in-memory session state for NEG-OPEN subscriptions
    const negSessions = new Map<string, { readonly filter: any; lastHex: string; lastActive: number }>()
    // Simple in-memory rate limiter (disabled unless env set)
    const RL_MAX = Number((globalThis as any).process?.env?.RELAY_RL_MAX_EVENTS ?? 0)
    const RL_WINDOW = Number((globalThis as any).process?.env?.RELAY_RL_WINDOW_MS ?? 0)
    const rlBuckets = new Map<string, { startedAt: number; count: number }>()

    const checkRate = (connectionId: string): boolean => {
      if (!RL_MAX || !RL_WINDOW) return true
      const now = Date.now()
      const bucket = rlBuckets.get(connectionId)
      if (!bucket || now - bucket.startedAt >= RL_WINDOW) {
        rlBuckets.set(connectionId, { startedAt: now, count: 1 })
        return true
      }
      bucket.count += 1
      return bucket.count <= RL_MAX
    }

    const handleEvent = (
      connectionId: string,
      event: NostrEvent
    ): Effect.Effect<
      HandleResult,
      StorageError | CryptoError | InvalidPublicKey | DuplicateEvent
    > =>
      Effect.gen(function* () {
        // Rate limit EVENT submissions (opt-in via env)
        if (!checkRate(connectionId)) {
          return { responses: [okMessage(event.id, false, "rate-limited")], broadcasts: [] }
        }
        // Run through policy pipeline
        const decision = yield* policyPipeline.evaluate(event, connectionId)

        // Handle policy decision
        if (decision._tag === "Reject") {
          return {
            responses: [okMessage(event.id, false, decision.reason)],
            broadcasts: [],
          }
        }

        if (decision._tag === "Shadow") {
          // Return OK but don't store or broadcast
          return {
            responses: [okMessage(event.id, true, "")],
            broadcasts: [],
          }
        }

        // Policy accepted
        // NIP-70: Protected events require NIP-42 AUTH for the same pubkey
        if (event.tags.some((t) => t[0] === "-" && t.length === 1)) {
          if (!authService) {
            return { responses: [okMessage(event.id, false, "auth-required: protected event")], broadcasts: [] }
          }
          const authed = yield* authService.isAuthenticated(connectionId)
          const authedPk = authed ? yield* authService.getAuthPubkey(connectionId) : undefined
          if (!authed || !authedPk || authedPk !== event.pubkey) {
            return { responses: [okMessage(event.id, false, "auth-required: protected event")], broadcasts: [] }
          }
        }
        // Public NIP-29 groups do not require an application account, but a
        // deployment that sets NIP-42 auth_required still binds every group
        // write to the authenticated Nostr key. Reads remain public.
        if (
          event.tags.some((t) => t[0] === "h" && t[1]) &&
          authService?.authRequired === true
        ) {
          const authed = yield* authService.isAuthenticated(connectionId)
          const authedPk = authed
            ? yield* authService.getAuthPubkey(connectionId)
            : undefined
          if (!authed || !authedPk || authedPk !== event.pubkey) {
            return {
              responses: [
                okMessage(
                  event.id,
                  false,
                  "auth-required: NIP-29 group write"
                ),
              ],
              broadcasts: [],
            }
          }
        }
        // NIP-09: Deletion request (kind 5) – e tags and a tags (same pubkey only)
        if (event.kind === 5) {
          // e-tag: delete specific event ids authored by the deleter
          const idsToDelete = event.tags.filter((t) => t[0] === "e").map((t) => t[1]!).filter(Boolean)
          for (const id of idsToDelete) {
            const matches = yield* eventStore.queryEvents([{ ids: [id as any] } as any])
            const target = matches.find((e) => e.id === id)
            if (target && target.pubkey === event.pubkey) {
              yield* eventStore.deleteEvent(id as any).pipe(Effect.ignore)
            }
          }

          // a-tag: delete all versions of the addressable/replaceable event up to created_at
          // Address format: "<kind>:<pubkey>:<d-tag>" (d may contain colons)
          const aTags = event.tags.filter((t) => t[0] === "a").map((t) => t[1]!).filter(Boolean)
          for (const address of aTags) {
            const firstColon = address.indexOf(":")
            const secondColon = address.indexOf(":", firstColon + 1)
            if (firstColon < 0 || secondColon < 0) continue
            const kind = Number(address.slice(0, firstColon))
            const aPubkey = address.slice(firstColon + 1, secondColon)
            const dTag = address.slice(secondColon + 1)
            if (!Number.isFinite(kind) || aPubkey !== event.pubkey) continue

            const filter: Record<string, unknown> = {
              kinds: [kind],
              authors: [event.pubkey],
              until: event.created_at,
            }
            if (dTag.length > 0 || kind >= 30000) {
              filter["#d"] = [dTag]
            }
            const matches = yield* eventStore.queryEvents([filter as any])
            for (const target of matches) {
              if (target.pubkey === event.pubkey && target.created_at <= event.created_at) {
                yield* eventStore.deleteEvent(target.id).pipe(Effect.ignore)
              }
            }
          }
        }

        // Run pre-store hooks and store
        // NIP-62: Request to Vanish (kind 62) — delete all events from pubkey up to created_at
        if (event.kind === 62) {
          const events = yield* eventStore.queryEvents([{ authors: [event.pubkey as any] } as any])
          for (const ev of events) {
            if (ev.created_at <= event.created_at) {
              yield* eventStore.deleteEvent(ev.id).pipe(Effect.ignore)
            }
          }
        }

        let stored = false
        let duplicateOrOlder = false
        let eventToStore = event

        if (nipRegistry) {
          // Use NipRegistry hooks for event treatment
          const hookResult = yield* nipRegistry.runPreStoreHooks(event)

          if (hookResult.action === "reject") {
            return {
              responses: [okMessage(event.id, false, hookResult.reason)],
              broadcasts: [],
            }
          }

          eventToStore = hookResult.event

          if (hookResult.action === "broadcast") {
            // NIP-16 ephemeral: accept + live-broadcast, do not persist
            const matchingSubs = yield* subscriptionManager.getMatchingSubscriptions(eventToStore)
            const broadcasts: BroadcastMessage[] = matchingSubs.map((sub: Subscription) => ({
              connectionId: sub.connectionId,
              subscriptionId: sub.subscriptionId,
              event: eventToStore,
            }))
            return {
              responses: [okMessage(event.id, true, "")],
              broadcasts,
            }
          }

          if (hookResult.action === "replace" && hookResult.deleteFilter) {
            // Replaceable event - use the filter from the hook
            const filter = hookResult.deleteFilter
            if (filter.dTag !== undefined) {
              // Parameterized replaceable (NIP-33)
              const result = yield* eventStore.storeParameterizedReplaceableEvent(
                eventToStore,
                filter.dTag
              )
              stored = result.stored
              duplicateOrOlder = !result.stored
            } else {
              // Regular replaceable (NIP-16)
              const result = yield* eventStore.storeReplaceableEvent(eventToStore)
              stored = result.stored
              duplicateOrOlder = !result.stored
            }
          } else {
            // Regular store
            const storeResult = yield* eventStore.storeEvent(eventToStore).pipe(
              Effect.catchTag("DuplicateEvent", () =>
                Effect.succeed({ duplicate: true, stored: false })
              ),
              Effect.map((result) =>
                typeof result === "boolean" ? { duplicate: false, stored: result } : result
              )
            )
            stored = storeResult.stored
            duplicateOrOlder = storeResult.duplicate
          }
        } else {
          // Fallback: use hard-coded logic (for backwards compatibility)
          if (isEphemeralKind(event.kind)) {
            const matchingSubs = yield* subscriptionManager.getMatchingSubscriptions(event)
            const broadcasts: BroadcastMessage[] = matchingSubs.map((sub: Subscription) => ({
              connectionId: sub.connectionId,
              subscriptionId: sub.subscriptionId,
              event,
            }))
            return {
              responses: [okMessage(event.id, true, "")],
              broadcasts,
            }
          } else if (isReplaceableKind(event.kind)) {
            // NIP-16: Replaceable event (kinds 0, 3, 10000-19999)
            const result = yield* eventStore.storeReplaceableEvent(event)
            stored = result.stored
            duplicateOrOlder = !result.stored
          } else if (isParameterizedReplaceableKind(event.kind)) {
            // NIP-33: Parameterized replaceable event (kinds 30000-39999)
            const dTagValue = getDTagValue(event) ?? ""
            const result = yield* eventStore.storeParameterizedReplaceableEvent(event, dTagValue)
            stored = result.stored
            duplicateOrOlder = !result.stored
          } else {
            // Regular event - use standard storage
            const storeResult = yield* eventStore.storeEvent(event).pipe(
              Effect.catchTag("DuplicateEvent", () =>
                Effect.succeed({ duplicate: true, stored: false })
              ),
              Effect.map((result) =>
                typeof result === "boolean" ? { duplicate: false, stored: result } : result
              )
            )
            stored = storeResult.stored
            duplicateOrOlder = storeResult.duplicate
          }
        }

        if (duplicateOrOlder) {
          return {
            responses: [okMessage(event.id, true, "duplicate: event already exists")],
            broadcasts: [],
          }
        }

        if (!stored) {
          return {
            responses: [okMessage(event.id, true, "")],
            broadcasts: [],
          }
        }

        // Run post-store hooks if registry exists
        if (nipRegistry) {
          yield* nipRegistry.runPostStoreHooks(eventToStore)
        }

        // Find matching subscriptions for broadcast
        const matchingSubs = yield* subscriptionManager.getMatchingSubscriptions(eventToStore)

        const broadcasts: BroadcastMessage[] = matchingSubs.map((sub: Subscription) => ({
          connectionId: sub.connectionId,
          subscriptionId: sub.subscriptionId,
          event: eventToStore,
        }))

        return {
          responses: [okMessage(event.id, true, "")],
          broadcasts,
        }
      })

  /**
   * Query each filter on its own, keeping whatever succeeds and discarding
   * only the filters that error. Reports how many filters were actually
   * answered so the caller can flag an incomplete result set.
   */
  const queryPerFilterIsolated = (
    filters: readonly (typeof import("../../core/Schema.js").Filter.Type)[]
  ): Effect.Effect<{ readonly events: readonly NostrEvent[]; readonly attempted: number }> =>
    Effect.gen(function* () {
      const seen = new Set<string>()
      const events: NostrEvent[] = []
      let attempted = 0

      for (const filter of filters) {
        const result = yield* eventStore
          .queryEvents([filter])
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (result === undefined) continue
        attempted += 1
        for (const event of result) {
          if (seen.has(event.id)) continue
          seen.add(event.id)
          events.push(event)
        }
      }

      return { events, attempted }
    })

  const handleReq = (
    connectionId: string,
    subscriptionId: SubscriptionId,
    filters: readonly (typeof import("../../core/Schema.js").Filter.Type)[]
  ): Effect.Effect<HandleResult, StorageError> =>
    Effect.gen(function* () {
      // Register the subscription
      yield* subscriptionManager.subscribe(connectionId, subscriptionId, filters)

      // NIP-67: probe limit+1 when a client limit is set so we can emit finish/more
      const clientLimit = filters[0]?.limit
      const queryFilters =
        clientLimit !== undefined
          ? filters.map((f, i) =>
              i === 0 && f.limit !== undefined
                ? ({ ...f, limit: (f.limit + 1) as typeof f.limit } as typeof f)
                : f
            )
          : filters

      // Fault isolation (NIP-01).
      //
      // A REQ carries independent filters that are OR'd together, so one
      // filter that the store cannot answer must not erase its siblings. The
      // happy path is still a single batched query; only on failure do we
      // degrade to per-filter queries and drop just the filters that failed.
      // This keeps a storage bug in one filter from blinding a whole
      // subscription, which is how a tag-index defect became total read
      // blindness in production.
      const queried = yield* eventStore.queryEvents(queryFilters).pipe(
        Effect.map((events) => ({
          events: events as readonly NostrEvent[],
          attempted: queryFilters.length,
        })),
        Effect.catch(() => queryPerFilterIsolated(queryFilters))
      )

      const failedFilters = queryFilters.length - queried.attempted
      // NIP-67 completeness hints: finish = all stored matches sent; more = more exist
      let events = queried.events
      let hints: readonly string[] = ["finish"]
      if (clientLimit !== undefined && events.length > clientLimit) {
        events = events.slice(0, clientLimit)
        hints = ["more"]
      }
      // A dropped filter means the result set is not provably complete.
      if (failedFilters > 0 && hints[0] === "finish") {
        hints = ["more"]
      }

      // Build response: EVENT messages + EOSE (with optional NIP-67 hints).
      // EOSE is unconditional: a client blocks on it, so a subscription whose
      // stored phase is never terminated hangs that client forever.
      const responses: RelayMessage[] = [
        ...events.map((event) => eventMessage(subscriptionId, event)),
        eoseMessage(subscriptionId, hints),
      ]

      if (failedFilters > 0) {
        responses.unshift(
          noticeMessage(
            `partial results for subscription ${subscriptionId}: ${failedFilters} of ` +
              `${queryFilters.length} filter(s) could not be served`
          )
        )
      }

      return { responses, broadcasts: [] }
    })


  const handleClose = (
    connectionId: string,
    subscriptionId: SubscriptionId
  ): Effect.Effect<HandleResult> =>
    Effect.gen(function* () {
      yield* subscriptionManager.unsubscribe(connectionId, subscriptionId)
      // NIP-01: CLOSE doesn't require a response
      return { responses: [], broadcasts: [] }
    })

  // NIP-45: COUNT message
  const handleCount = (
    _connectionId: string,
    subscriptionId: SubscriptionId,
    filters: readonly (typeof import("../../core/Schema.js").Filter.Type)[]
  ): Effect.Effect<HandleResult, StorageError> =>
    Effect.gen(function* () {
      // For now, evaluate counts by querying and counting results
      const events = yield* eventStore.queryEvents(filters)
      const count = events.length
      const response: RelayMessage = [
        "COUNT",
        subscriptionId,
        { count, approximate: false },
      ] as RelayMessage
      return { responses: [response], broadcasts: [] }
    })

  const handleAuth = (
    connectionId: string,
    authEvent: NostrEvent
  ): Effect.Effect<HandleResult, CryptoError | InvalidPublicKey> =>
    Effect.gen(function* () {
      if (!authService) {
        // AUTH not enabled, return error
        return {
          responses: [okMessage(authEvent.id, false, "error: AUTH not supported")],
          broadcasts: [],
        }
      }

      const result = yield* authService.handleAuth(connectionId, authEvent)
      return {
        responses: [okMessage(authEvent.id, result.success, result.message)],
        broadcasts: [],
      }
    })

  const handleMessage: MessageHandler["handleMessage"] = (connectionId, message) => {
    const [type] = message

    switch (type) {
      // NIP-77: Negentropy messages
      case "NEG-OPEN": {
        const [, subId, filter, initialHex] = message as any
        const key = `${connectionId}:${subId}`
        // Parse client id list (if provided)
        let clientIds: string[] = []
        try {
          if (initialHex && String(initialHex).length > 0) {
            clientIds = decodeIdListMessage(String(initialHex)).ids
          }
        } catch {
          const err: any = ["NEG-ERR", subId, "invalid: bad message"]
          return Effect.succeed({ responses: [err as any], broadcasts: [] })
        }
        // Compute server ids matching filter
        return Effect.gen(function* () {
          const serverEvents = yield* eventStore.queryEvents([filter])
          const serverIds = new Set(serverEvents.map((e) => e.id))
          // Compute missing on client side
          const missing = Array.from(serverIds).filter((id) => !clientIds.includes(id))
          const hex = encodeIdListMessage(missing)
          negSessions.set(key, { filter, lastHex: hex, lastActive: Date.now() })
          const response: any = ["NEG-MSG", subId, hex]
          return { responses: [response as any], broadcasts: [] }
        })
      }
      case "NEG-MSG": {
        const [, subId, hex] = message as any
        const key = `${connectionId}:${subId}`
        if (!negSessions.has(key)) {
          const err: any = ["NEG-ERR", subId, "closed: no such session"]
          return Effect.succeed({ responses: [err as any], broadcasts: [] })
        }
        // Merge client ids, recompute diff
        return Effect.gen(function* () {
          const sess = negSessions.get(key)!
          let clientIds: string[] = []
          try {
            clientIds = decodeIdListMessage(String(hex ?? "")).ids
          } catch {
            const err: any = ["NEG-ERR", subId, "invalid: bad message"]
            return { responses: [err as any], broadcasts: [] }
          }
          const serverEvents = yield* eventStore.queryEvents([sess.filter])
          const serverIds = new Set(serverEvents.map((e) => e.id))
          const missing = Array.from(serverIds).filter((id) => !clientIds.includes(id))
          const outHex = encodeIdListMessage(missing)
          negSessions.set(key, { ...sess, lastHex: outHex, lastActive: Date.now() })
          const response: any = ["NEG-MSG", subId, outHex]
          return { responses: [response as any], broadcasts: [] }
        })
      }
      case "NEG-CLOSE": {
        const [, subId] = message as any
        const key = `${connectionId}:${subId}`
        negSessions.delete(key)
        return Effect.succeed({ responses: [], broadcasts: [] })
      }
      case "EVENT":
        return handleEvent(connectionId, message[1])

      case "REQ":
        // REQ message is ["REQ", subscriptionId, ...filters]
        // With variadic tuple, message[1] is subId, rest are filters
        const [, subscriptionId, ...filters] = message
        return handleReq(connectionId, subscriptionId, filters)

      case "CLOSE":
        return handleClose(connectionId, message[1])

      case "AUTH":
        return handleAuth(connectionId, message[1])

      case "COUNT": {
        const [, subscriptionId, ...filters] = message as any
        return handleCount(connectionId, subscriptionId, filters)
      }
    }
  }

  const handleRaw: MessageHandler["handleRaw"] = (connectionId, raw) =>
    Effect.gen(function* () {
      // Parse JSON
      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw),
        catch: () => new MessageParseError({ message: "Invalid JSON", raw }),
      })

      // Decode as ClientMessage
      const decoded = yield* Schema.decodeUnknownEffect(ClientMessage)(parsed).pipe(
        Effect.mapError(
          () => new MessageParseError({ message: "Invalid message format", raw })
        )
      )

      // Handle the decoded message
      return yield* handleMessage(connectionId, decoded).pipe(
        Effect.mapError(
          (error) =>
            new MessageParseError({
              message: `Handler error: ${error._tag}`,
              raw,
            })
        )
      )
    })

  return {
    _tag: "MessageHandler" as const,
    handleRaw,
    handleMessage,
  }
})

// =============================================================================
// Service Layers
// =============================================================================

/**
 * Default MessageHandler without NipRegistry (backwards compatible)
 */
export const MessageHandlerLive = Layer.effect(MessageHandler, make())

/**
 * MessageHandler that uses NipRegistry for event treatment hooks
 * This is the recommended layer for full NIP support
 */
export const MessageHandlerWithRegistry = Layer.effect(
  MessageHandler,
  Effect.gen(function* () {
    const registry = yield* NipRegistry
    return yield* make(registry)
  })
)

/**
 * MessageHandler with NipRegistry and AuthService for NIP-42 authentication
 * Use this layer when you want full NIP support including authentication
 */
export const MessageHandlerWithAuth = Layer.effect(
  MessageHandler,
  Effect.gen(function* () {
    const registry = yield* NipRegistry
    const auth = yield* Effect.serviceOption(AuthService)
    return yield* make(registry, Option.getOrUndefined(auth))
  })
)
