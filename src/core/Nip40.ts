/**
 * NIP-40: Expiration Timestamp
 * https://github.com/nostr-protocol/nips/blob/master/40.md
 *
 * Event expiration handling
 */

/** Event type for expiration utilities (flexible tag type for compatibility) */
interface Event {
  tags: readonly (readonly string[])[] | string[][]
}

/**
 * Get the expiration of the event as a Date object, if any
 */
export function getExpiration(event: Event): Date | undefined {
  const tag = event.tags.find(([name]) => name === "expiration")
  if (tag && tag[1]) {
    return new Date(parseInt(tag[1]) * 1000)
  }
  return undefined
}

/**
 * Check if the event has expired
 */
export function isEventExpired(event: Event): boolean {
  const expiration = getExpiration(event)
  if (expiration) {
    return Date.now() > expiration.getTime()
  }
  return false
}

/**
 * Returns a promise that resolves when the event expires
 */
export async function waitForExpire(event: Event): Promise<Event> {
  const expiration = getExpiration(event)
  if (expiration) {
    const diff = expiration.getTime() - Date.now()
    if (diff > 0) {
      await sleep(diff)
      return event
    }
    return event
  }
  throw new Error("Event has no expiration")
}

/**
 * Calls the callback when the event expires
 */
export function onExpire(event: Event, callback: (event: Event) => void): void {
  waitForExpire(event)
    .then(callback)
    .catch(() => {})
}

/**
 * Resolves when the given number of milliseconds have elapsed
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create an expiration tag for an event
 * @param timestamp - Unix timestamp in seconds when the event expires
 */
export function createExpirationTag(timestamp: number): readonly string[] {
  return ["expiration", String(timestamp)] as const
}

/**
 * Check if an event has an expiration tag
 */
export function hasExpiration(event: Event): boolean {
  return event.tags.some(([name]) => name === "expiration")
}
