/**
 * SimplePool - nostr-tools-compatible multi-relay connection pool
 *
 * This module provides a SimplePool class that matches the nostr-tools API
 * for connecting to multiple Nostr relays, publishing events, and subscribing
 * to event streams.
 *
 * @example
 * ```typescript
 * import { SimplePool } from 'nostr-effect/pool'
 * import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-effect/pure'
 *
 * const pool = new SimplePool()
 * const relays = ['wss://relay.damus.io', 'wss://relay.primal.net']
 *
 * // Subscribe with callbacks
 * const sub = pool.subscribe(relays, { kinds: [1], limit: 10 }, {
 *   onevent(event) { console.log(event) },
 *   oneose() { console.log('caught up') }
 * })
 *
 * // Or use async iteration
 * for await (const event of pool.subscribeIterator(relays, { kinds: [1], limit: 10 })) {
 *   console.log(event)
 * }
 *
 * // Publish
 * const sk = generateSecretKey()
 * const event = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now()/1000), tags: [], content: 'Hello!' }, sk)
 * await Promise.all(pool.publish(relays, event))
 *
 * // Cleanup
 * pool.destroy()
 * ```
 */
import { verifyEvent, type NostrEvent } from "./pure.js"

// =============================================================================
// Types
// =============================================================================

/** Filter for querying events */
export interface Filter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  "#e"?: string[]
  "#p"?: string[]
  "#a"?: string[]
  "#d"?: string[]
  "#t"?: string[]
  [key: `#${string}`]: string[] | undefined
}

/** Options for SimplePool constructor */
export interface SimplePoolOptions {
  /** Enable auto-reconnect on disconnect (default: false) */
  enableReconnect?: boolean
  /** Verify event signatures (default: true) */
  verifyEvent?: boolean
  /** Default timeout in ms (default: 10000) */
  timeout?: number
}

/** Subscription callback params */
export interface SubscribeParams {
  /** Called when an event is received. Includes the relay URL the event came from. */
  onevent?: (event: NostrEvent, relay?: string) => void
  /** Called when EOSE (end of stored events) is received */
  oneose?: () => void
  /** Called when subscription is closed */
  onclose?: (reasons: string[]) => void
  /** Maximum wait time for subscription */
  maxWait?: number
  /** Subscription label for debugging */
  label?: string
  /** Subscription ID hint */
  id?: string
}

/** Subscription handle for closing */
export interface SubCloser {
  close: (reason?: string) => void
}

/** Relay connection state */
interface RelayConnection {
  ws: WebSocket
  connected: boolean
  subscriptions: Map<string, SubscriptionState>
  pendingPublishes: Map<string, PublishResolver>
  onopen?: () => void
  onclose?: () => void
}

/** Internal subscription state */
interface SubscriptionState {
  filters: Filter[]
  params: SubscribeParams
  eoseReceived: boolean
  closeReason?: string
}

/** Publish resolver for OK messages */
interface PublishResolver {
  resolve: (reason: string) => void
  reject: (error: Error) => void
}

// =============================================================================
// Utility Functions
// =============================================================================

/** Normalize relay URL */
function normalizeURL(url: string): string {
  let normalized = url.trim()

  // Add protocol if missing
  if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
    normalized = `wss://${normalized}`
  }

  // Remove trailing slash
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

/** Generate a random subscription ID */
function generateSubId(): string {
  return Math.random().toString(36).substring(2, 15)
}

/** Check if an event matches any of the filters */
function matchFilters(filters: Filter[], event: NostrEvent): boolean {
  for (const filter of filters) {
    if (matchFilter(filter, event)) return true
  }
  return false
}

/** Check if an event matches a single filter */
function matchFilter(filter: Filter, event: NostrEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false
  if (filter.since && event.created_at < filter.since) return false
  if (filter.until && event.created_at > filter.until) return false

  // Check tag filters
  for (const key of Object.keys(filter)) {
    if (key.startsWith("#")) {
      const tagName = key.slice(1)
      const filterValues = filter[key as `#${string}`]
      if (filterValues) {
        const eventTagValues = event.tags.filter((t) => t[0] === tagName).map((t) => t[1])
        if (!filterValues.some((v) => eventTagValues.includes(v))) return false
      }
    }
  }

  return true
}

// =============================================================================
// WebSocket Implementation
// =============================================================================

let _WebSocket: typeof WebSocket

try {
  _WebSocket = WebSocket
} catch {
  // WebSocket not available globally
}

/**
 * Use a custom WebSocket implementation (e.g., for Node.js)
 */
export function useWebSocketImplementation(websocketImplementation: typeof WebSocket): void {
  _WebSocket = websocketImplementation
}

// Alias for compatibility
export const setWebSocket = useWebSocketImplementation

// =============================================================================
// SimplePool Class
// =============================================================================

/**
 * A connection pool for multiple Nostr relays.
 *
 * This class provides nostr-tools-compatible methods for subscribing to events,
 * publishing events, and querying data from multiple relays.
 */
export class SimplePool {
  private relays: Map<string, RelayConnection> = new Map()
  private seenEvents: Set<string> = new Set()
  private options: Required<SimplePoolOptions>

  constructor(options?: SimplePoolOptions) {
    this.options = {
      enableReconnect: options?.enableReconnect ?? false,
      verifyEvent: options?.verifyEvent ?? true,
      timeout: options?.timeout ?? 10000,
    }
  }

  /**
   * Ensure a relay is connected, creating the connection if needed.
   */
  async ensureRelay(url: string, options?: { connectionTimeout?: number }): Promise<RelayConnection> {
    url = normalizeURL(url)

    let relay = this.relays.get(url)
    if (relay?.connected) {
      return relay
    }

    // Create new connection
    return new Promise((resolve, reject) => {
      const timeout = options?.connectionTimeout ?? this.options.timeout

      const timeoutId = setTimeout(() => {
        reject(new Error(`Connection timeout to ${url}`))
      }, timeout)

      const ws = new _WebSocket(url)

      const connection: RelayConnection = {
        ws,
        connected: false,
        subscriptions: new Map(),
        pendingPublishes: new Map(),
      }

      ws.onopen = () => {
        clearTimeout(timeoutId)
        connection.connected = true
        this.relays.set(url, connection)
        connection.onopen?.()
        resolve(connection)
      }

      ws.onerror = (_e) => {
        clearTimeout(timeoutId)
        reject(new Error(`WebSocket error connecting to ${url}`))
      }

      ws.onclose = () => {
        connection.connected = false
        // Notify all subscriptions of close
        for (const [_subId, sub] of connection.subscriptions.entries()) {
          sub.closeReason = "relay disconnected"
        }
        connection.onclose?.()
        if (!this.options.enableReconnect) {
          this.relays.delete(url)
        }
      }

      ws.onmessage = (msgEvent) => {
        this.handleMessage(url, connection, msgEvent.data as string)
      }

      this.relays.set(url, connection)
    })
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(url: string, connection: RelayConnection, data: string): void {
    try {
      const msg = JSON.parse(data)
      const type = msg[0]

      switch (type) {
        case "EVENT": {
          const subId = msg[1] as string
          const event = msg[2] as NostrEvent
          const sub = connection.subscriptions.get(subId)

          if (sub && matchFilters(sub.filters, event)) {
            // Verify signature if enabled
            if (this.options.verifyEvent && !verifyEvent(event)) {
              return // Invalid signature
            }

            // Deduplicate
            if (this.seenEvents.has(event.id)) {
              return
            }
            this.seenEvents.add(event.id)

            // Limit dedup set size
            if (this.seenEvents.size > 10000) {
              const toRemove = Array.from(this.seenEvents).slice(0, 5000)
              for (const id of toRemove) {
                this.seenEvents.delete(id)
              }
            }

            sub.params.onevent?.(event, url)
          }
          break
        }

        case "EOSE": {
          const subId = msg[1] as string
          const sub = connection.subscriptions.get(subId)
          if (sub && !sub.eoseReceived) {
            sub.eoseReceived = true
            sub.params.oneose?.()
          }
          break
        }

        case "OK": {
          const eventId = msg[1] as string
          const accepted = msg[2] as boolean
          const reason = msg[3] as string

          const resolver = connection.pendingPublishes.get(eventId)
          if (resolver) {
            connection.pendingPublishes.delete(eventId)
            if (accepted) {
              resolver.resolve(reason || "")
            } else {
              resolver.reject(new Error(reason || "Event rejected"))
            }
          }
          break
        }

        case "CLOSED": {
          const subId = msg[1] as string
          const reason = msg[2] as string
          const sub = connection.subscriptions.get(subId)
          if (sub) {
            sub.closeReason = reason
            connection.subscriptions.delete(subId)
          }
          break
        }

        case "NOTICE": {
          // Could add a notice callback, but for now just ignore
          break
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  /**
   * Subscribe to events matching a filter.
   *
   * @param relays - Relay URLs to subscribe to
   * @param filter - Event filter
   * @param params - Subscription callbacks
   * @returns SubCloser to close the subscription
   */
  subscribe(relays: string[], filter: Filter | Filter[], params: SubscribeParams): SubCloser {
    const filters = Array.isArray(filter) ? filter : [filter]
    const subId = params.id || generateSubId()

    const normalizedUrls = [...new Set(relays.map(normalizeURL))]
    const eosesReceived: boolean[] = new Array(normalizedUrls.length).fill(false)
    const closesReceived: (string | null)[] = new Array(normalizedUrls.length).fill(null)

    const checkAllEose = () => {
      if (eosesReceived.every((e) => e)) {
        params.oneose?.()
      }
    }

    const checkAllClosed = () => {
      if (closesReceived.every((c) => c !== null)) {
        params.onclose?.(closesReceived.filter((c): c is string => c !== null))
      }
    }

    // Connect and subscribe to each relay
    normalizedUrls.forEach((url, i) => {
      const ensureOpts = params.maxWait !== undefined ? { connectionTimeout: params.maxWait } : undefined
      this.ensureRelay(url, ensureOpts)
        .then((connection) => {
          // Create subscription state
          const subState: SubscriptionState = {
            filters,
            params: {
              ...params,
              oneose: () => {
                eosesReceived[i] = true
                checkAllEose()
              },
            },
            eoseReceived: false,
          }

          connection.subscriptions.set(subId, subState)

          // Send REQ message
          const reqMsg = JSON.stringify(["REQ", subId, ...filters])
          connection.ws.send(reqMsg)
        })
        .catch((err) => {
          closesReceived[i] = err.message || "connection failed"
          checkAllClosed()
        })
    })

    return {
      close: (_reason?: string) => {
        for (const url of normalizedUrls) {
          const connection = this.relays.get(url)
          if (connection?.connected) {
            connection.subscriptions.delete(subId)
            try {
              connection.ws.send(JSON.stringify(["CLOSE", subId]))
            } catch {
              // Ignore send errors
            }
          }
        }
      },
    }
  }

  /**
   * Subscribe and automatically close on EOSE.
   */
  subscribeEose(
    relays: string[],
    filter: Filter | Filter[],
    params: Omit<SubscribeParams, "oneose">
  ): SubCloser {
    const sub = this.subscribe(relays, filter, {
      ...params,
      oneose: () => {
        sub.close("closed automatically on eose")
      },
    })
    return sub
  }

  /**
   * Subscribe using async iteration.
   *
   * @param relays - Relay URLs to subscribe to
   * @param filter - Event filter
   * @returns AsyncIterable of events
   */
  subscribeIterator(relays: string[], filter: Filter | Filter[]): AsyncIterable<NostrEvent> {
    const events: NostrEvent[] = []
    const waiters: Array<(event: NostrEvent | null) => void> = []
    let closed = false

    const sub = this.subscribe(relays, filter, {
      onevent: (event) => {
        const waiter = waiters.shift()
        if (waiter) {
          waiter(event)
        } else {
          events.push(event)
        }
      },
      onclose: () => {
        closed = true
        // Resolve any waiting promises with null to signal end
        for (const waiter of waiters) {
          waiter(null)
        }
        waiters.length = 0
      },
    })

    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<NostrEvent>> => {
          // Return buffered event if available
          const buffered = events.shift()
          if (buffered) {
            return { value: buffered, done: false }
          }

          // If closed, we're done
          if (closed) {
            return { value: undefined as unknown as NostrEvent, done: true }
          }

          // Wait for next event
          const event = await new Promise<NostrEvent | null>((resolve) => {
            waiters.push(resolve)
          })

          if (event === null) {
            return { value: undefined as unknown as NostrEvent, done: true }
          }

          return { value: event, done: false }
        },
        return: async (): Promise<IteratorResult<NostrEvent>> => {
          sub.close("iterator returned")
          return { value: undefined as unknown as NostrEvent, done: true }
        },
      }),
    }
  }

  /**
   * Query events synchronously (wait for EOSE then return all events).
   *
   * @param relays - Relay URLs to query
   * @param filter - Event filter
   * @param params - Query options
   * @returns Promise resolving to array of events
   */
  async querySync(
    relays: string[],
    filter: Filter | Filter[],
    params?: Pick<SubscribeParams, "maxWait" | "label" | "id">
  ): Promise<NostrEvent[]> {
    return new Promise((resolve) => {
      const events: NostrEvent[] = []
      let resolved = false

      const sub = this.subscribeEose(relays, filter, {
        ...params,
        onevent: (event) => {
          events.push(event)
        },
        onclose: () => {
          if (!resolved) {
            resolved = true
            resolve(events)
          }
        },
      })

      // Timeout fallback
      if (params?.maxWait) {
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            sub.close("timeout")
            resolve(events)
          }
        }, params.maxWait)
      }
    })
  }

  /**
   * Get a single event (sets limit: 1, returns most recent).
   *
   * @param relays - Relay URLs to query
   * @param filter - Event filter
   * @param params - Query options
   * @returns Promise resolving to event or null
   */
  async get(
    relays: string[],
    filter: Filter | Filter[],
    params?: Pick<SubscribeParams, "maxWait" | "label" | "id">
  ): Promise<NostrEvent | null> {
    // Add limit: 1 to each filter
    const filters = Array.isArray(filter) ? filter : [filter]
    const limitedFilters = filters.map((f) => ({ ...f, limit: 1 }))

    const events = await this.querySync(relays, limitedFilters, params)

    // Sort by created_at descending and return first
    events.sort((a, b) => b.created_at - a.created_at)
    return events[0] || null
  }

  /**
   * Publish an event to multiple relays.
   *
   * @param relays - Relay URLs to publish to
   * @param event - Signed event to publish
   * @returns Array of Promises, one per relay
   */
  publish(relays: string[], event: NostrEvent): Promise<string>[] {
    const normalizedUrls = [...new Set(relays.map(normalizeURL))]

    return normalizedUrls.map(async (url) => {
      const connection = await this.ensureRelay(url)

      return new Promise<string>((resolve, reject) => {
        // Set up timeout
        const timeoutId = setTimeout(() => {
          connection.pendingPublishes.delete(event.id)
          reject(new Error(`Publish timeout to ${url}`))
        }, this.options.timeout)

        // Store resolver
        connection.pendingPublishes.set(event.id, {
          resolve: (reason) => {
            clearTimeout(timeoutId)
            resolve(reason)
          },
          reject: (err) => {
            clearTimeout(timeoutId)
            reject(err)
          },
        })

        // Send EVENT message
        connection.ws.send(JSON.stringify(["EVENT", event]))
      })
    })
  }

  /**
   * Close connections to specific relays.
   *
   * @param relays - Relay URLs to close
   */
  close(relays: string[]): void {
    for (const url of relays.map(normalizeURL)) {
      const connection = this.relays.get(url)
      if (connection) {
        try {
          connection.ws.close()
        } catch {
          // Ignore close errors
        }
        this.relays.delete(url)
      }
    }
  }

  /**
   * Close all connections and cleanup.
   */
  destroy(): void {
    for (const [_url, connection] of this.relays.entries()) {
      try {
        connection.ws.close()
      } catch {
        // Ignore close errors
      }
    }
    this.relays.clear()
    this.seenEvents.clear()
  }

  /**
   * Get the connection status of all relays.
   *
   * @returns Map of URL to connected status
   */
  listConnectionStatus(): Map<string, boolean> {
    const status = new Map<string, boolean>()
    for (const [url, connection] of this.relays.entries()) {
      status.set(url, connection.connected)
    }
    return status
  }
}

// Re-export types from pure for convenience
export type { Event, NostrEvent } from "./pure.js"
