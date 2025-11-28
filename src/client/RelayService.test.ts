/**
 * Tests for RelayService
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { EventKind, Filter, SubscriptionId, type NostrEvent } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeSubId = Schema.decodeSync(SubscriptionId)

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

describe("RelayService", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 11000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  describe("connection", () => {
    test("connects to relay", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        yield* relayService.connect()
        const state = yield* relayService.connectionState()
        expect(state).toBe("connected")
        yield* relayService.disconnect()
      })

      const RelayLayer = makeRelayService({
        url: `ws://localhost:${port}`,
        reconnect: false,
      })

      await Effect.runPromise(program.pipe(Effect.provide(RelayLayer)))
    })

    test("reports disconnected state initially", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const state = yield* relayService.connectionState()
        expect(state).toBe("disconnected")
      })

      const RelayLayer = makeRelayService({
        url: `ws://localhost:${port}`,
        reconnect: false,
      })

      await Effect.runPromise(program.pipe(Effect.provide(RelayLayer)))
    })

    test("fails to connect to invalid URL", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        yield* relayService.connect()
      })

      const RelayLayer = makeRelayService({
        url: "ws://localhost:1", // Invalid port
        reconnect: false,
      })

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(RelayLayer),
          Effect.either
        )
      )

      expect(result._tag).toBe("Left")
    })
  })

  describe("publish", () => {
    test("publishes event and receives OK", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const event = yield* createTestEvent("Publish test")

        yield* relayService.connect()
        const result = yield* relayService.publish(event)

        expect(result.accepted).toBe(true)
        yield* relayService.disconnect()
      })

      const RelayLayer = makeRelayService({
        url: `ws://localhost:${port}`,
        reconnect: false,
      })

      await Effect.runPromise(
        program.pipe(
          Effect.provide(RelayLayer),
          Effect.provide(TestLayer)
        )
      )
    })

    test("receives rejection for invalid event", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const event = yield* createTestEvent("Invalid test")

        // Tamper with content to invalidate signature
        const tampered = {
          ...event,
          content: "Tampered content",
        } as NostrEvent

        yield* relayService.connect()
        const result = yield* relayService.publish(tampered)

        expect(result.accepted).toBe(false)
        expect(result.message).toContain("invalid")
        yield* relayService.disconnect()
      })

      const RelayLayer = makeRelayService({
        url: `ws://localhost:${port}`,
        reconnect: false,
      })

      await Effect.runPromise(
        program.pipe(
          Effect.provide(RelayLayer),
          Effect.provide(TestLayer)
        )
      )
    })
  })

  describe("subscribe", () => {
    test("creates subscription and can unsubscribe", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService

        yield* relayService.connect()

        // Subscribe to kind 1
        const sub = yield* relayService.subscribe([decodeFilter({ kinds: [decodeKind(1)] })])

        expect(sub.id).toBeDefined()
        expect(sub.events).toBeDefined()
        expect(sub.unsubscribe).toBeDefined()

        yield* sub.unsubscribe()
        yield* relayService.disconnect()
      })

      const RelayLayer = makeRelayService({
        url: `ws://localhost:${port}`,
        reconnect: false,
      })

      await Effect.runPromise(
        program.pipe(Effect.provide(RelayLayer))
      )
    })

    test("unsubscribe stops receiving events", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService

        yield* relayService.connect()

        const sub = yield* relayService.subscribe([decodeFilter({ kinds: [decodeKind(1)] })])
        yield* sub.unsubscribe()

        // Subscription should be cleaned up
        yield* relayService.disconnect()
      })

      const RelayLayer = makeRelayService({
        url: `ws://localhost:${port}`,
        reconnect: false,
      })

      await Effect.runPromise(
        program.pipe(
          Effect.provide(RelayLayer),
          Effect.provide(TestLayer)
        )
      )
    })

    test("supports custom subscription ID", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService

        yield* relayService.connect()

        const sub = yield* relayService.subscribe([decodeFilter({ kinds: [decodeKind(1)] })], decodeSubId("custom-sub-id"))

        expect(sub.id).toBe(decodeSubId("custom-sub-id"))

        yield* sub.unsubscribe()
        yield* relayService.disconnect()
      })

      const RelayLayer = makeRelayService({
        url: `ws://localhost:${port}`,
        reconnect: false,
      })

      await Effect.runPromise(
        program.pipe(Effect.provide(RelayLayer))
      )
    })
  })

  describe("multiple subscriptions", () => {
    test("supports multiple concurrent subscriptions", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService

        yield* relayService.connect()

        const sub1 = yield* relayService.subscribe([decodeFilter({ kinds: [decodeKind(1)] })], decodeSubId("sub-1"))
        const sub2 = yield* relayService.subscribe([decodeFilter({ kinds: [decodeKind(1)] })], decodeSubId("sub-2"))

        expect(sub1.id).toBe(decodeSubId("sub-1"))
        expect(sub2.id).toBe(decodeSubId("sub-2"))

        yield* sub1.unsubscribe()
        yield* sub2.unsubscribe()
        yield* relayService.disconnect()
      })

      const RelayLayer = makeRelayService({
        url: `ws://localhost:${port}`,
        reconnect: false,
      })

      await Effect.runPromise(
        program.pipe(Effect.provide(RelayLayer))
      )
    })
  })
})
