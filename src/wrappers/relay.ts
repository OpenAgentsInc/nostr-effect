/**
 * Single Relay Connection
 *
 * Simple WebSocket connection to a single Nostr relay.
 * For multi-relay connections, use SimplePool from 'nostr-effect/pool'.
 *
 * @example
 * ```typescript
 * import { Relay } from 'nostr-effect/relay'
 *
 * const relay = new Relay('wss://relay.damus.io')
 *
 * relay.on('connect', () => console.log('Connected!'))
 * relay.on('error', (err) => console.error(err))
 *
 * await relay.connect()
 *
 * // Subscribe to events
 * const sub = relay.subscribe([{ kinds: [1], limit: 10 }], {
 *   onevent: (event) => console.log(event),
 *   oneose: () => console.log('End of stored events'),
 * })
 *
 * // Publish an event
 * await relay.publish(signedEvent)
 *
 * // Clean up
 * sub.close()
 * relay.close()
 * ```
 */

import { verifyEvent, type NostrEvent } from "./pure.js"
import type { Filter } from "./pool.js"

// =============================================================================
// Types
// =============================================================================

export type { Filter, NostrEvent }

/** Relay connection status */
export type RelayStatus = "disconnected" | "connecting" | "connected" | "error"

/** Subscription callbacks */
export interface SubscriptionCallbacks {
  onevent?: (event: NostrEvent) => void
  oneose?: () => void
  onclose?: (reason: string) => void
}

/** Subscription handle */
export interface Subscription {
  close: () => void
  readonly id: string
  readonly filters: Filter[]
}

/** Relay event types */
export type RelayEventType = "connect" | "disconnect" | "error" | "notice"

/** Event handlers */
export type RelayEventHandler<T extends RelayEventType> = T extends "connect"
  ? () => void
  : T extends "disconnect"
    ? () => void
    : T extends "error"
      ? (error: Error) => void
      : T extends "notice"
        ? (message: string) => void
        : never

// =============================================================================
// Relay Class
// =============================================================================

/**
 * A single Nostr relay connection.
 *
 * Manages WebSocket connection, subscriptions, and event publishing
 * to a single relay URL.
 */
export class Relay {
  readonly url: string
  private ws: WebSocket | null = null
  private status: RelayStatus = "disconnected"
  private subscriptions = new Map<
    string,
    { filters: Filter[]; callbacks: SubscriptionCallbacks; eoseReceived: boolean }
  >()
  private pendingPublishes = new Map<
    string,
    { resolve: (reason: string) => void; reject: (error: Error) => void }
  >()
  private seenEvents = new Set<string>()
  private eventHandlers: Map<RelayEventType, Set<RelayEventHandler<RelayEventType>>> = new Map()
  private connectionPromise: Promise<void> | null = null
  private verifyEvents: boolean

  constructor(url: string, options?: { verifyEvents?: boolean }) {
    this.url = normalizeURL(url)
    this.verifyEvents = options?.verifyEvents ?? true
  }

  /** Get current connection status */
  get connected(): boolean {
    return this.status === "connected"
  }

  /**
   * Connect to the relay.
   * @param timeout - Connection timeout in ms (default: 10000)
   */
  async connect(timeout = 10000): Promise<void> {
    if (this.status === "connected") {
      return
    }

    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.status = "connecting"

    this.connectionPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.status = "error"
        this.connectionPromise = null
        reject(new Error(`Connection timeout to ${this.url}`))
      }, timeout)

      const ws = new WebSocket(this.url)

      ws.onopen = () => {
        clearTimeout(timeoutId)
        this.status = "connected"
        this.ws = ws
        this.connectionPromise = null
        this.emit("connect")
        resolve()
      }

      ws.onerror = () => {
        clearTimeout(timeoutId)
        this.status = "error"
        this.connectionPromise = null
        const error = new Error(`WebSocket error connecting to ${this.url}`)
        this.emit("error", error)
        reject(error)
      }

      ws.onclose = () => {
        this.status = "disconnected"
        this.ws = null
        this.emit("disconnect")
        // Notify all subscriptions
        for (const [, sub] of this.subscriptions) {
          sub.callbacks.onclose?.("relay disconnected")
        }
        this.subscriptions.clear()
      }

      ws.onmessage = (event) => {
        this.handleMessage(event.data as string)
      }
    })

    return this.connectionPromise
  }

  /**
   * Subscribe to events matching filters.
   *
   * @param filters - Event filters
   * @param callbacks - Event callbacks
   * @returns Subscription handle
   */
  subscribe(filters: Filter[], callbacks: SubscriptionCallbacks): Subscription {
    const id = generateSubId()

    this.subscriptions.set(id, { filters, callbacks, eoseReceived: false })

    // Send REQ if connected
    if (this.ws && this.status === "connected") {
      this.ws.send(JSON.stringify(["REQ", id, ...filters]))
    }

    return {
      id,
      filters,
      close: () => {
        this.subscriptions.delete(id)
        if (this.ws && this.status === "connected") {
          try {
            this.ws.send(JSON.stringify(["CLOSE", id]))
          } catch {
            // Ignore send errors
          }
        }
      },
    }
  }

  /**
   * Publish an event to the relay.
   *
   * @param event - Signed event to publish
   * @param timeout - Publish timeout in ms (default: 10000)
   * @returns Promise resolving to OK reason or rejecting on error
   */
  async publish(event: NostrEvent, timeout = 10000): Promise<string> {
    if (!this.ws || this.status !== "connected") {
      throw new Error("Not connected to relay")
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingPublishes.delete(event.id)
        reject(new Error(`Publish timeout to ${this.url}`))
      }, timeout)

      this.pendingPublishes.set(event.id, {
        resolve: (reason) => {
          clearTimeout(timeoutId)
          resolve(reason)
        },
        reject: (error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
      })

      this.ws!.send(JSON.stringify(["EVENT", event]))
    })
  }

  /**
   * Close the relay connection.
   */
  close(): void {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore close errors
      }
      this.ws = null
    }
    this.status = "disconnected"
    this.subscriptions.clear()
    this.pendingPublishes.clear()
    this.seenEvents.clear()
  }

  /**
   * Add event listener.
   */
  on<T extends RelayEventType>(event: T, handler: RelayEventHandler<T>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler as RelayEventHandler<RelayEventType>)
  }

  /**
   * Remove event listener.
   */
  off<T extends RelayEventType>(event: T, handler: RelayEventHandler<T>): void {
    this.eventHandlers.get(event)?.delete(handler as RelayEventHandler<RelayEventType>)
  }

  private emit<T extends RelayEventType>(event: T, ...args: Parameters<RelayEventHandler<T>>): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          ;(handler as (...args: unknown[]) => void)(...args)
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data)
      const type = msg[0]

      switch (type) {
        case "EVENT": {
          const subId = msg[1] as string
          const event = msg[2] as NostrEvent
          const sub = this.subscriptions.get(subId)

          if (sub) {
            // Verify signature if enabled
            if (this.verifyEvents && !verifyEvent(event)) {
              return
            }

            // Deduplicate
            if (this.seenEvents.has(event.id)) {
              return
            }
            this.seenEvents.add(event.id)

            // Limit dedup set size
            if (this.seenEvents.size > 5000) {
              const toRemove = Array.from(this.seenEvents).slice(0, 2500)
              for (const id of toRemove) {
                this.seenEvents.delete(id)
              }
            }

            sub.callbacks.onevent?.(event)
          }
          break
        }

        case "EOSE": {
          const subId = msg[1] as string
          const sub = this.subscriptions.get(subId)
          if (sub && !sub.eoseReceived) {
            sub.eoseReceived = true
            sub.callbacks.oneose?.()
          }
          break
        }

        case "OK": {
          const eventId = msg[1] as string
          const accepted = msg[2] as boolean
          const reason = msg[3] as string

          const resolver = this.pendingPublishes.get(eventId)
          if (resolver) {
            this.pendingPublishes.delete(eventId)
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
          const sub = this.subscriptions.get(subId)
          if (sub) {
            sub.callbacks.onclose?.(reason)
            this.subscriptions.delete(subId)
          }
          break
        }

        case "NOTICE": {
          const message = msg[1] as string
          this.emit("notice", message)
          break
        }
      }
    } catch {
      // Ignore parse errors
    }
  }
}

// =============================================================================
// Utilities
// =============================================================================

function normalizeURL(url: string): string {
  let normalized = url.trim()
  if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
    normalized = `wss://${normalized}`
  }
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function generateSubId(): string {
  return Math.random().toString(36).substring(2, 15)
}

/**
 * Connect to a relay and return the Relay instance.
 * Convenience function for quick connections.
 *
 * @param url - Relay URL
 * @param timeout - Connection timeout in ms
 * @returns Connected Relay instance
 */
export async function connectRelay(url: string, timeout = 10000): Promise<Relay> {
  const relay = new Relay(url)
  await relay.connect(timeout)
  return relay
}
