/**
 * Tests for pool.ts SimplePool
 *
 * These tests verify multi-relay subscription and event delivery.
 */
import { describe, test, expect } from "bun:test"
import { SimplePool } from "./pool.js"

// Use real relays for integration test
const TEST_RELAYS = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
]

describe("SimplePool", () => {
  describe("multi-relay subscription", () => {
    test("connects to multiple relays", async () => {
      const pool = new SimplePool()

      // Try to connect to all relays
      const connections = await Promise.allSettled(
        TEST_RELAYS.map((url) => pool.ensureRelay(url, { connectionTimeout: 5000 }))
      )

      const connected = connections.filter((c) => c.status === "fulfilled").length
      console.log(`Connected to ${connected}/${TEST_RELAYS.length} relays`)

      // Check connection status
      const status = pool.listConnectionStatus()
      console.log("Connection status:", Object.fromEntries(status))

      pool.destroy()

      // At least one relay should connect
      expect(connected).toBeGreaterThan(0)
    }, { timeout: 20000 })

    test("receives events from multiple relays via subscribe", async () => {
      const pool = new SimplePool()
      const receivedEvents: Array<{ id: string; relay: string | undefined }> = []
      const relayEventCounts = new Map<string, number>()

      // Initialize counts
      TEST_RELAYS.forEach((r) => relayEventCounts.set(r.replace(/\/$/, ""), 0))

      await new Promise<void>((resolve) => {
        let eoseCount = 0
        const targetEose = TEST_RELAYS.length

        const sub = pool.subscribe(
          TEST_RELAYS,
          { kinds: [1], limit: 5 },
          {
            onevent(event, relay) {
              console.log(`Event ${event.id.slice(0, 8)} from ${relay}`)
              receivedEvents.push({ id: event.id, relay })
              if (relay) {
                const count = relayEventCounts.get(relay) ?? 0
                relayEventCounts.set(relay, count + 1)
              }
            },
            oneose() {
              eoseCount++
              console.log(`EOSE received (${eoseCount}/${targetEose})`)
              if (eoseCount >= 1) {
                // Give a bit more time for events from other relays
                setTimeout(() => {
                  sub.close()
                  resolve()
                }, 2000)
              }
            },
          }
        )

        // Timeout after 15 seconds
        setTimeout(() => {
          sub.close()
          resolve()
        }, 15000)
      })

      console.log(`Total events received: ${receivedEvents.length}`)
      console.log("Events per relay:", Object.fromEntries(relayEventCounts))

      // Check connection status
      const status = pool.listConnectionStatus()
      console.log("Final connection status:", Object.fromEntries(status))

      pool.destroy()

      // Should receive some events
      expect(receivedEvents.length).toBeGreaterThan(0)

      // Verify relay info is provided
      const eventsWithRelay = receivedEvents.filter(e => e.relay)
      expect(eventsWithRelay.length).toBe(receivedEvents.length)
    }, { timeout: 20000 })

    test("querySync returns events from multiple relays", async () => {
      const pool = new SimplePool()

      const events = await pool.querySync(TEST_RELAYS, { kinds: [1], limit: 10 }, { maxWait: 15000 })

      console.log(`querySync returned ${events.length} events`)

      // Check connection status
      const status = pool.listConnectionStatus()
      console.log("Connection status:", Object.fromEntries(status))

      pool.destroy()

      expect(events.length).toBeGreaterThan(0)
    }, { timeout: 20000 })
  })

  describe("event deduplication", () => {
    test("deduplicates events with same id", async () => {
      const pool = new SimplePool()
      const receivedIds: string[] = []

      // Subscribe to multiple relays - same event might come from multiple
      await new Promise<void>((resolve) => {
        const sub = pool.subscribe(
          TEST_RELAYS,
          { kinds: [1], limit: 20 },
          {
            onevent(event) {
              receivedIds.push(event.id)
            },
            oneose() {
              setTimeout(() => {
                sub.close()
                resolve()
              }, 3000)
            },
          }
        )

        setTimeout(() => {
          sub.close()
          resolve()
        }, 15000)
      })

      // Check for duplicates
      const uniqueIds = new Set(receivedIds)
      console.log(`Received ${receivedIds.length} events, ${uniqueIds.size} unique`)

      pool.destroy()

      // Should have no duplicates
      expect(receivedIds.length).toBe(uniqueIds.size)
    }, { timeout: 20000 })
  })

  describe("connection handling", () => {
    test("handles connection failures gracefully", async () => {
      const pool = new SimplePool()

      // Include a bad relay
      const relays = ["wss://nonexistent.relay.invalid", ...TEST_RELAYS.slice(0, 1)]

      const events = await pool.querySync(relays, { kinds: [1], limit: 5 }, { maxWait: 15000 })

      console.log(`Got ${events.length} events despite bad relay`)

      pool.destroy()

      // Should still get events from good relays
      expect(events.length).toBeGreaterThan(0)
    }, { timeout: 20000 })

    test("listConnectionStatus shows correct states", async () => {
      const pool = new SimplePool()

      // Connect to one relay
      await pool.ensureRelay(TEST_RELAYS[0]!, { connectionTimeout: 5000 })

      const status = pool.listConnectionStatus()
      console.log("Status after connect:", Object.fromEntries(status))

      // Should show connected
      expect(status.get(TEST_RELAYS[0]!.replace(/\/$/, ""))).toBe(true)

      pool.destroy()
    }, { timeout: 10000 })
  })
})
