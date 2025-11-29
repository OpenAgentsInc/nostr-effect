/**
 * RelayService
 *
 * Client-side relay connection service with WebSocket management,
 * automatic reconnection, and subscription tracking.
 */
import { Context, Effect, Layer, Queue, Stream } from "effect"
import { Schema } from "@effect/schema"
import {
  ConnectionError,
  TimeoutError,
  SubscriptionError,
} from "../core/Errors.js"
import {
  RelayMessage,
  NostrEvent,
  Filter,
  SubscriptionId,
  EventId,
} from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

/** Connection state */
export type ConnectionState = "disconnected" | "connecting" | "connected"

/** Configuration for relay connection */
export interface RelayConnectionConfig {
  readonly url: string
  readonly reconnect?: boolean
  readonly maxReconnectAttempts?: number
  readonly initialReconnectDelay?: number
  readonly maxReconnectDelay?: number
}

/** Result of publishing an event */
export interface PublishResult {
  readonly accepted: boolean
  readonly message: string
}

/** Subscription handle returned by subscribe */
export interface SubscriptionHandle {
  readonly id: SubscriptionId
  readonly events: Stream.Stream<NostrEvent, SubscriptionError>
  readonly unsubscribe: () => Effect.Effect<void>
}

/** Internal subscription state */
interface SubscriptionState {
  readonly id: SubscriptionId
  readonly filters: readonly Filter[]
  readonly queue: Queue.Queue<NostrEvent>
  readonly eoseReceived: boolean
}

/** Pending OK resolver */
interface PendingOk {
  resolve: (result: PublishResult) => void
  reject: (error: Error) => void
}

/** Pending COUNT resolver (NIP-45) */
interface PendingCount {
  resolve: (result: { count: number; approximate?: boolean }) => void
  reject: (error: Error) => void
}

// =============================================================================
// Service Interface
// =============================================================================

export interface RelayService {
  readonly _tag: "RelayService"

  /**
   * Get the relay URL
   */
  readonly url: string

  /**
   * Get current connection state
   */
  connectionState(): Effect.Effect<ConnectionState>

  /**
   * Connect to the relay
   */
  connect(): Effect.Effect<void, ConnectionError>

  /**
   * Disconnect from the relay
   */
  disconnect(): Effect.Effect<void>

  /**
   * Publish an event to the relay
   */
  publish(event: NostrEvent): Effect.Effect<PublishResult, ConnectionError | TimeoutError>

  /**
   * Subscribe to events matching filters
   */
  subscribe(
    filters: readonly Filter[],
    subscriptionId?: string
  ): Effect.Effect<SubscriptionHandle, ConnectionError>

  /**
   * Wait for a specific event ID to be acknowledged
   */
  waitForOk(eventId: EventId, timeoutMs?: number): Effect.Effect<PublishResult, TimeoutError>

  /**
   * Request a COUNT with filters (NIP-45) and await response
   */
  count(
    filters: readonly Filter[],
    requestId?: string,
    timeoutMs?: number
  ): Effect.Effect<{ count: number; approximate?: boolean }, TimeoutError | ConnectionError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const RelayService = Context.GenericTag<RelayService>("RelayService")

// =============================================================================
// Service Implementation
// =============================================================================

const make = (config: RelayConnectionConfig) =>
  Effect.gen(function* () {
    // Use plain JS state for simplicity in WebSocket callbacks
    let state: ConnectionState = "disconnected"
    let ws: WebSocket | null = null
    const subscriptions = new Map<string, SubscriptionState>()
    const pendingOks = new Map<string, PendingOk>()
    const pendingCounts = new Map<string, PendingCount>()
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0

    // Subscription ID generation
    let subCounter = 0
    const generateSubId = (): string => {
      subCounter++
      return `sub_${Date.now()}_${subCounter}`
    }

    // Handle incoming message (called synchronously from WebSocket)
    const handleMessage = (data: string): void => {
      try {
        const parsed = JSON.parse(data)
        const decodeResult = Schema.decodeUnknownSync(RelayMessage)(parsed)

        const [type] = decodeResult

        switch (type) {
          case "EVENT": {
            const [, subId, event] = decodeResult
            const sub = subscriptions.get(subId)
            if (sub) {
              Effect.runSync(Queue.offer(sub.queue, event))
            }
            break
          }

          case "EOSE": {
            const [, subId] = decodeResult
            const sub = subscriptions.get(subId)
            if (sub && !sub.eoseReceived) {
              subscriptions.set(subId, { ...sub, eoseReceived: true })
            }
            break
          }

          case "OK": {
            const [, eventId, accepted, message] = decodeResult
            const pending = pendingOks.get(eventId)
            if (pending) {
              pending.resolve({ accepted, message })
              pendingOks.delete(eventId)
            }
            break
          }

          case "CLOSED": {
            const [, subId] = decodeResult
            const sub = subscriptions.get(subId)
            if (sub) {
              Effect.runSync(Queue.shutdown(sub.queue))
              subscriptions.delete(subId)
            }
            break
          }

          case "NOTICE": {
            const [, message] = decodeResult
            console.warn(`[Relay Notice] ${config.url}: ${message}`)
            break
          }

          case "COUNT": {
            const [, reqId, payload] = decodeResult as any
            const pending = pendingCounts.get(reqId)
            if (pending) {
              pending.resolve(payload as { count: number; approximate?: boolean })
              pendingCounts.delete(reqId)
            }
            break
          }
        }
      } catch {
        // Ignore parse errors for robustness
      }
    }

    // Send a message to the relay
    const sendMessage = (message: unknown): Effect.Effect<void, ConnectionError> =>
      Effect.sync(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new ConnectionError({ message: "Not connected", url: config.url })
        }
        ws.send(JSON.stringify(message))
      }).pipe(
        Effect.catchAllDefect((error) =>
          Effect.fail(
            new ConnectionError({
              message: error instanceof Error ? error.message : "Send failed",
              url: config.url,
            })
          )
        )
      )

    // Reconnection logic
    const scheduleReconnect = (): void => {
      if (config.reconnect === false) return

      const maxAttempts = config.maxReconnectAttempts ?? 10
      if (reconnectAttempts >= maxAttempts) return

      const initialDelay = config.initialReconnectDelay ?? 1000
      const maxDelay = config.maxReconnectDelay ?? 30000
      const delay = Math.min(initialDelay * Math.pow(2, reconnectAttempts), maxDelay)

      reconnectAttempts++
      reconnectTimeout = setTimeout(() => {
        Effect.runFork(
          connectWs().pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                reconnectAttempts = 0
                // Resubscribe to all active subscriptions
                for (const [, sub] of subscriptions) {
                  if (ws) {
                    ws.send(JSON.stringify(["REQ", sub.id, ...sub.filters]))
                  }
                }
              })
            ),
            Effect.catchAll(() =>
              Effect.sync(() => {
                scheduleReconnect()
              })
            )
          )
        )
      }, delay)
    }

    // Connect to WebSocket
    const connectWs = (): Effect.Effect<void, ConnectionError> =>
      Effect.async<void, ConnectionError>((resume) => {
        try {
          const socket = new WebSocket(config.url)

          socket.onopen = () => {
            ws = socket
            state = "connected"
            resume(Effect.void)
          }

          socket.onerror = () => {
            resume(
              Effect.fail(new ConnectionError({ message: "WebSocket error", url: config.url }))
            )
          }

          socket.onclose = () => {
            ws = null
            state = "disconnected"
            scheduleReconnect()
          }

          socket.onmessage = (event) => {
            const data = typeof event.data === "string" ? event.data : event.data.toString()
            handleMessage(data)
          }

          // Cleanup on interrupt
          return Effect.sync(() => {
            if (socket.readyState === WebSocket.CONNECTING) {
              socket.close()
            }
          })
        } catch (error) {
          resume(
            Effect.fail(
              new ConnectionError({
                message: error instanceof Error ? error.message : "Connection failed",
                url: config.url,
              })
            )
          )
          return Effect.void
        }
      })

    // Public API
    const connect: RelayService["connect"] = () =>
      Effect.gen(function* () {
        if (state === "connected") return

        state = "connecting"
        yield* connectWs()
      })

    const disconnect: RelayService["disconnect"] = () =>
      Effect.sync(() => {
        // Cancel reconnection
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout)
          reconnectTimeout = null
        }
        reconnectAttempts = 0

        // Close WebSocket
        if (ws) {
          ws.close()
          ws = null
        }

        // Clear subscriptions
        for (const [, sub] of subscriptions) {
          Effect.runSync(Queue.shutdown(sub.queue))
        }
        subscriptions.clear()

        // Reject pending OKs
        for (const [, pending] of pendingOks) {
          pending.reject(new Error("Disconnected"))
        }
        pendingOks.clear()

        state = "disconnected"
      })

    const publish: RelayService["publish"] = (event) =>
      Effect.gen(function* () {
        yield* sendMessage(["EVENT", event])
        return yield* waitForOk(event.id, 10000)
      })

    const waitForOk: RelayService["waitForOk"] = (eventId, timeoutMs = 10000) =>
      Effect.async<PublishResult, TimeoutError>((resume) => {
        const timeoutHandle = setTimeout(() => {
          pendingOks.delete(eventId)
          resume(
            Effect.fail(
              new TimeoutError({
                message: `Timeout waiting for OK for event ${eventId}`,
                durationMs: timeoutMs,
              })
            )
          )
        }, timeoutMs)

        pendingOks.set(eventId, {
          resolve: (result) => {
            clearTimeout(timeoutHandle)
            resume(Effect.succeed(result))
          },
          reject: (error) => {
            clearTimeout(timeoutHandle)
            resume(
              Effect.fail(
                new TimeoutError({
                  message: error.message,
                  durationMs: timeoutMs,
                })
              )
            )
          },
        })

        // Cleanup on interrupt
        return Effect.sync(() => {
          clearTimeout(timeoutHandle)
          pendingOks.delete(eventId)
        })
      })

    const subscribe: RelayService["subscribe"] = (filters, subscriptionId) =>
      Effect.gen(function* () {
        if (state !== "connected") {
          return yield* Effect.fail(
            new ConnectionError({ message: "Not connected", url: config.url })
          )
        }

        const subId = (subscriptionId ?? generateSubId()) as SubscriptionId
        const queue = yield* Queue.unbounded<NostrEvent>()

        const subState: SubscriptionState = {
          id: subId,
          filters: filters,
          queue,
          eoseReceived: false,
        }

        // Register subscription
        subscriptions.set(subId, subState)

        // Send REQ message
        yield* sendMessage(["REQ", subId, ...filters])

        // Create event stream from queue
        const events = Stream.fromQueue(queue).pipe(
          Stream.catchAll(() =>
            Stream.fail(
              new SubscriptionError({
                message: "Subscription closed",
                subscriptionId: subId,
              })
            )
          )
        )

        // Unsubscribe function
        const unsubscribe = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            // Send CLOSE message
            yield* sendMessage(["CLOSE", subId]).pipe(Effect.ignore)

            // Remove from subscriptions
            subscriptions.delete(subId)

            // Shutdown queue
            yield* Queue.shutdown(queue)
          })

        return {
          id: subId,
          events,
          unsubscribe,
        }
      })

    const connectionState: RelayService["connectionState"] = () =>
      Effect.sync(() => state)

    const count: RelayService["count"] = (filters, requestId, timeoutMs = 5000) =>
      Effect.gen(function* () {
        if (state !== "connected") {
          return yield* Effect.fail(
            new ConnectionError({ message: "Not connected", url: config.url })
          )
        }

        const id = (requestId ?? generateSubId()) as SubscriptionId
        // Send COUNT
        yield* sendMessage(["COUNT", id, ...filters])

        // Wait for COUNT response
        return yield* Effect.async<{ count: number; approximate?: boolean }, TimeoutError>((resume) => {
          const timeoutHandle = setTimeout(() => {
            pendingCounts.delete(id)
            resume(
              Effect.fail(
                new TimeoutError({
                  message: `Timeout waiting for COUNT ${id}`,
                  durationMs: timeoutMs,
                })
              )
            )
          }, timeoutMs)

          pendingCounts.set(id, {
            resolve: (result) => {
              clearTimeout(timeoutHandle)
              resume(Effect.succeed(result))
            },
            reject: (error) => {
              clearTimeout(timeoutHandle)
              resume(
                Effect.fail(
                  new TimeoutError({
                    message: error.message,
                    durationMs: timeoutMs,
                  })
                )
              )
            },
          })

          return Effect.sync(() => {
            clearTimeout(timeoutHandle)
            pendingCounts.delete(id)
          })
        })
      })

    return {
      _tag: "RelayService" as const,
      url: config.url,
      connectionState,
      connect,
      disconnect,
      publish,
      subscribe,
      waitForOk,
      count,
    }
  })

// =============================================================================
// Layer Constructor
// =============================================================================

/**
 * Create a RelayService layer for a specific relay URL
 */
export const makeRelayService = (config: RelayConnectionConfig): Layer.Layer<RelayService> =>
  Layer.effect(RelayService, make(config))

/**
 * Create a RelayService scoped to the current scope
 */
export const makeRelayServiceScoped = (
  config: RelayConnectionConfig
): Effect.Effect<RelayService, never, never> =>
  make(config).pipe(
    Effect.tap((service) => service.connect().pipe(Effect.ignore))
  )
