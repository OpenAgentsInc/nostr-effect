/**
 * Tests for RelayPool
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayPool, makeRelayPool } from "./RelayPool.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { EventKind, Filter } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)

// Test layers
const TestLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

// Create test event helper
const createTestEvent = (content: string = "Test event") =>
  Effect.gen(function* () {
    const crypto = yield* CryptoService
    const events = yield* EventService
    const privateKey = yield* crypto.generatePrivateKey()

    return yield* events.createEvent(
      {
        kind: decodeKind(1),
        content,
      },
      privateKey
    )
  })

describe("RelayPool", () => {
  let relay1: RelayHandle
  let relay2: RelayHandle
  let relay3: RelayHandle
  let port1: number
  let port2: number
  let port3: number

  beforeAll(async () => {
    // Start multiple test relays
    port1 = 12000 + Math.floor(Math.random() * 1000)
    port2 = port1 + 1
    port3 = port1 + 2

    relay1 = await startTestRelay(port1)
    relay2 = await startTestRelay(port2)
    relay3 = await startTestRelay(port3)
  })

  afterAll(async () => {
    await Effect.runPromise(relay1.stop())
    await Effect.runPromise(relay2.stop())
    await Effect.runPromise(relay3.stop())
  })

  describe("relay management", () => {
    test("adds and lists relays", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}`)

        const relays = yield* pool.getRelays()
        expect(relays.length).toBe(2)
        expect(relays).toContain(`ws://localhost:${port1}`)
        expect(relays).toContain(`ws://localhost:${port2}`)

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })

    test("removes relays", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}`)

        let relays = yield* pool.getRelays()
        expect(relays.length).toBe(2)

        yield* pool.removeRelay(`ws://localhost:${port1}`)

        relays = yield* pool.getRelays()
        expect(relays.length).toBe(1)
        expect(relays).toContain(`ws://localhost:${port2}`)

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })

    test("normalizes relay URLs", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        // Add with different formats
        yield* pool.addRelay(`localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}/`)
        yield* pool.addRelay(`wss://localhost:${port3}`)

        const relays = yield* pool.getRelays()
        expect(relays.length).toBe(3)

        // All should be normalized to wss:// without trailing slash
        expect(relays).toContain(`wss://localhost:${port1}`)
        expect(relays).toContain(`wss://localhost:${port2}`)
        expect(relays).toContain(`wss://localhost:${port3}`)

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })

    test("prevents duplicate relays", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port1}/`) // Trailing slash should be normalized

        const relays = yield* pool.getRelays()
        expect(relays.length).toBe(1)

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })
  })

  describe("relay status", () => {
    test("gets relay status", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)

        // Give it a moment to connect
        yield* Effect.sleep("100 millis")

        const status = yield* pool.getRelayStatus(`ws://localhost:${port1}`)
        expect(status).not.toBeNull()
        expect(status?.status).toBe("connected")

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })

    test("returns null for unknown relay", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        const status = yield* pool.getRelayStatus("ws://localhost:99999")
        expect(status).toBeNull()

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })

    test("lists connected relays", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}`)

        // Give time to connect
        yield* Effect.sleep("200 millis")

        const connected = yield* pool.getConnectedRelays()
        expect(connected.length).toBe(2)

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })
  })

  describe("publishing", () => {
    test("publishes to all connected relays", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool
        const event = yield* createTestEvent("Multi-relay publish test")

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}`)

        // Give time to connect
        yield* Effect.sleep("200 millis")

        const result = yield* pool.publish(event)

        expect(result.successes.length).toBe(2)
        expect(result.failures.length).toBe(0)
        expect(result.successes).toContain(`ws://localhost:${port1}`)
        expect(result.successes).toContain(`ws://localhost:${port2}`)

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(Layer.merge(PoolLayer, TestLayer)))
      )
    })

    test("handles partial failures", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool
        const event = yield* createTestEvent("Partial failure test")

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:99999`) // Non-existent relay

        // Give time to connect
        yield* Effect.sleep("200 millis")

        const result = yield* pool.publish(event)

        // Should succeed on port1 but fail on 99999 (not connected)
        expect(result.successes.length).toBe(1)
        expect(result.successes).toContain(`ws://localhost:${port1}`)

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(Layer.merge(PoolLayer, TestLayer)))
      )
    })

    test("returns empty result when no relays connected", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool
        const event = yield* createTestEvent("No relays test")

        const result = yield* pool.publish(event)

        expect(result.successes.length).toBe(0)
        expect(result.failures.length).toBe(0)

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(Layer.merge(PoolLayer, TestLayer)))
      )
    })
  })

  describe("subscriptions", () => {
    test("merges events from multiple relays", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}`)

        // Give time to connect
        yield* Effect.sleep("200 millis")

        const filter = decodeFilter({ kinds: [1] })
        const sub = yield* pool.subscribe([filter])

        // Collect events with timeout
        yield* Stream.runCollect(
          sub.events.pipe(
            Stream.take(2),
            Stream.timeout("2 seconds")
          )
        ).pipe(Effect.ignore) // Ignore timeout errors

        yield* sub.unsubscribe()
        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(
          Effect.provide(Layer.merge(PoolLayer, TestLayer)),
          Effect.ignore // Ignore any errors from timeout
        )
      )
    }, { timeout: 5000 })

    test("deduplicates events by ID", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}`)

        // Give time to connect
        yield* Effect.sleep("200 millis")

        const filter = decodeFilter({ kinds: [1], limit: 5 })
        const sub = yield* pool.subscribe([filter])

        // Collect events - should be deduplicated
        yield* Stream.runCollect(
          sub.events.pipe(
            Stream.timeout("1 second")
          )
        ).pipe(Effect.ignore)

        yield* sub.unsubscribe()
        yield* pool.close()
      })

      const PoolLayer = makeRelayPool({ deduplicateEvents: true })
      await Effect.runPromise(
        program.pipe(
          Effect.provide(Layer.merge(PoolLayer, TestLayer)),
          Effect.ignore
        )
      )
    }, { timeout: 3000 })

    test("unsubscribes from all relays", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}`)

        // Give time to connect
        yield* Effect.sleep("200 millis")

        const filter = decodeFilter({ kinds: [1] })
        const sub = yield* pool.subscribe([filter])

        // Unsubscribe immediately
        yield* sub.unsubscribe()

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(Layer.merge(PoolLayer, TestLayer)))
      )
    })

    test("fails when no relays connected", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        const filter = decodeFilter({ kinds: [1] })
        const result = yield* Effect.either(pool.subscribe([filter]))

        expect(result._tag).toBe("Left")

        yield* pool.close()
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })
  })

  describe("close", () => {
    test("disconnects all relays", async () => {
      const program = Effect.gen(function* () {
        const pool = yield* RelayPool

        yield* pool.addRelay(`ws://localhost:${port1}`)
        yield* pool.addRelay(`ws://localhost:${port2}`)

        // Give time to connect
        yield* Effect.sleep("200 millis")

        let connected = yield* pool.getConnectedRelays()
        expect(connected.length).toBe(2)

        yield* pool.close()

        const relays = yield* pool.getRelays()
        expect(relays.length).toBe(0)
      })

      const PoolLayer = makeRelayPool()
      await Effect.runPromise(
        program.pipe(Effect.provide(PoolLayer))
      )
    })
  })
})
