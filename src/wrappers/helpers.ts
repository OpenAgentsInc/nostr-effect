/**
 * Helper Utilities
 *
 * Utility functions for async operations and event verification.
 *
 * @example
 * ```typescript
 * import { yieldThread, alwaysTrue } from 'nostr-effect/helpers'
 *
 * // Yield control to allow other tasks to run
 * await yieldThread()
 *
 * // Verification function that always returns true (for testing)
 * const verifyEvent = alwaysTrue
 * ```
 */

/** Event type */
export interface Event {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
  [verifiedSymbol]?: boolean
}

/** Verified event type */
export interface VerifiedEvent extends Event {
  [verifiedSymbol]: true
}

/** Symbol for marking events as verified */
export const verifiedSymbol = Symbol("verified")

/**
 * Yield control to the event loop
 * Uses MessageChannel when available, otherwise falls back to setImmediate or setTimeout
 */
export async function yieldThread(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // Check if MessageChannel is available
      if (typeof MessageChannel !== "undefined") {
        const ch = new MessageChannel()
        const handler = () => {
          ch.port1.removeEventListener("message", handler)
          resolve()
        }
        ch.port1.addEventListener("message", handler)
        ch.port2.postMessage(0)
        ch.port1.start()
      } else {
        // setImmediate may not be defined in all environments
        if (typeof setImmediate !== "undefined") {
          ;(setImmediate as (fn: () => void) => void)(resolve)
        } else if (typeof setTimeout !== "undefined") {
          setTimeout(resolve, 0)
        } else {
          // Last resort - resolve immediately
          resolve()
        }
      }
    } catch (e) {
      console.error("during yield: ", e)
      reject(e)
    }
  })
}

/**
 * Verification function that always returns true
 * Useful for testing or when signature verification is not needed
 */
export function alwaysTrue(event: Event): event is VerifiedEvent {
  ;(event as VerifiedEvent)[verifiedSymbol] = true
  return true
}
