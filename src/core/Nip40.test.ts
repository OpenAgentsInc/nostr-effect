/**
 * NIP-40: Expiration Timestamp Tests
 */
import { describe, test, expect, mock } from "bun:test"
import {
  getExpiration,
  isEventExpired,
  waitForExpire,
  onExpire,
  createExpirationTag,
  hasExpiration,
} from "./Nip40.js"

// Helper to build test events
function buildEvent(overrides: { tags?: string[][] } = {}) {
  return {
    tags: overrides.tags ?? [],
  }
}

describe("NIP-40: Expiration Timestamp", () => {
  describe("getExpiration", () => {
    test("returns the expiration as a Date object", () => {
      const event = buildEvent({ tags: [["expiration", "123"]] })
      const result = getExpiration(event)
      expect(result).toEqual(new Date(123000))
    })

    test("returns undefined if no expiration tag", () => {
      const event = buildEvent({ tags: [] })
      const result = getExpiration(event)
      expect(result).toBeUndefined()
    })
  })

  describe("isEventExpired", () => {
    test("returns true when the event has expired", () => {
      const event = buildEvent({ tags: [["expiration", "123"]] })
      const result = isEventExpired(event)
      expect(result).toBe(true)
    })

    test("returns false when the event has not expired", () => {
      const future = Math.floor(Date.now() / 1000) + 10
      const event = buildEvent({ tags: [["expiration", future.toString()]] })
      const result = isEventExpired(event)
      expect(result).toBe(false)
    })

    test("returns false when no expiration tag", () => {
      const event = buildEvent({ tags: [] })
      const result = isEventExpired(event)
      expect(result).toBe(false)
    })
  })

  describe("waitForExpire", () => {
    test("returns a promise that resolves when the event expires", async () => {
      const event = buildEvent({ tags: [["expiration", "123"]] })
      const result = await waitForExpire(event)
      expect(result).toEqual(event)
    })

    test("throws error if event has no expiration", async () => {
      const event = buildEvent({ tags: [] })
      await expect(waitForExpire(event)).rejects.toThrow("Event has no expiration")
    })
  })

  describe("onExpire", () => {
    test("calls the callback when the event expires", async () => {
      const event = buildEvent({ tags: [["expiration", "123"]] })
      const callback = mock(() => {})
      onExpire(event, callback)
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(callback).toHaveBeenCalled()
    })

    test("does not throw for events without expiration", async () => {
      const event = buildEvent({ tags: [] })
      const callback = mock(() => {})
      // Should not throw
      onExpire(event, callback)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe("createExpirationTag", () => {
    test("creates a valid expiration tag", () => {
      const tag = createExpirationTag(1234567890)
      expect(tag).toEqual(["expiration", "1234567890"])
    })
  })

  describe("hasExpiration", () => {
    test("returns true if event has expiration tag", () => {
      const event = buildEvent({ tags: [["expiration", "123"]] })
      expect(hasExpiration(event)).toBe(true)
    })

    test("returns false if event has no expiration tag", () => {
      const event = buildEvent({ tags: [["p", "pubkey"]] })
      expect(hasExpiration(event)).toBe(false)
    })
  })
})
