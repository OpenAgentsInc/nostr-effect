/**
 * NIP-AO: Agent Observability service tests
 *
 * Covers:
 * - telemetry round-trip (agent -> owner)
 * - control round-trip (owner -> agent)
 * - a third party cannot decrypt
 * - a tampered frame fails verification
 * - malformed routing tags are rejected
 * - optional NIP-59 gift-wrap round-trip
 * - ephemeral no-store behavior via the relay's NIP-16 handling
 * - the recommended subscription filter shape
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream, Option } from "effect"
import {
  AgentObservabilityService,
  AgentObservabilityServiceLive,
} from "./AgentObservabilityService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { OBSERVER_FRAME_KIND, type ControlMessage, type ObserverEvent } from "../core/NipAO.js"
import { Schema } from "effect"
import { Filter } from "../core/Schema.js"

const decodeFilter = Schema.decodeSync(Filter)

const sampleTelemetry: ObserverEvent = {
  seq: 42,
  timestamp: "2026-04-29T12:00:41.500Z",
  kind: "acp_write",
  agentIndex: 0,
  channelId: "52a85618-0f8f-4542-94ec-599e6e1c6f2e",
  sessionId: "a1b2c3d4",
  turnId: "e5f6g7h8",
  payload: {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "shell", arguments: { command: "ls -la" } },
  },
}

const sampleControl: ControlMessage = {
  type: "cancel_turn",
  channelId: "52a85618-0f8f-4542-94ec-599e6e1c6f2e",
}

describe("AgentObservabilityService", () => {
  const unitLayers = () => Layer.merge(AgentObservabilityServiceLive, CryptoServiceLive)

  describe("telemetry frames (agent -> owner)", () => {
    test("round-trips a telemetry frame the owner can read", async () => {
      const program = Effect.gen(function* () {
        const ao = yield* AgentObservabilityService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const agentPk = yield* crypto.getPublicKey(agentSk)
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)

        const frame = yield* ao.buildTelemetryFrame({
          event: sampleTelemetry,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })

        // Wire shape
        expect(frame.kind).toBe(OBSERVER_FRAME_KIND)
        expect(frame.pubkey).toBe(agentPk)
        expect(frame.tags).toContainEqual(["p", ownerPk])
        expect(frame.tags).toContainEqual(["agent", agentPk])
        expect(frame.tags).toContainEqual(["frame", "telemetry"])
        // content must be encrypted, not the plaintext
        expect(frame.content).not.toContain("acp_write")

        const payload = yield* ao.readFrame(frame, ownerSk)
        expect(payload.direction).toBe("telemetry")
        if (payload.direction === "telemetry") {
          expect(payload.event).toEqual(sampleTelemetry)
        }
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })

    test("includes an h tag when a NIP-29 group id is supplied", async () => {
      const program = Effect.gen(function* () {
        const ao = yield* AgentObservabilityService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)

        const frame = yield* ao.buildTelemetryFrame({
          event: sampleTelemetry,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
          groupId: "group-123",
        })

        expect(frame.tags).toContainEqual(["h", "group-123"])
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })

  describe("control frames (owner -> agent)", () => {
    test("round-trips a control frame the agent can read", async () => {
      const program = Effect.gen(function* () {
        const ao = yield* AgentObservabilityService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const agentPk = yield* crypto.getPublicKey(agentSk)
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)

        const frame = yield* ao.buildControlFrame({
          message: sampleControl,
          ownerPrivateKey: ownerSk,
          agentPublicKey: agentPk,
        })

        expect(frame.kind).toBe(OBSERVER_FRAME_KIND)
        expect(frame.pubkey).toBe(ownerPk)
        expect(frame.tags).toContainEqual(["p", agentPk])
        expect(frame.tags).toContainEqual(["agent", agentPk])
        expect(frame.tags).toContainEqual(["frame", "control"])

        const payload = yield* ao.readFrame(frame, agentSk)
        expect(payload.direction).toBe("control")
        if (payload.direction === "control") {
          expect(payload.message).toEqual(sampleControl)
        }
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })

  describe("security", () => {
    test("a third party cannot decrypt a telemetry frame", async () => {
      const program = Effect.gen(function* () {
        const ao = yield* AgentObservabilityService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)
        const strangerSk = yield* crypto.generatePrivateKey()

        const frame = yield* ao.buildTelemetryFrame({
          event: sampleTelemetry,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })

        const result = yield* ao.readFrame(frame, strangerSk).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })

    test("a tampered frame fails verification", async () => {
      const program = Effect.gen(function* () {
        const ao = yield* AgentObservabilityService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)

        const frame = yield* ao.buildTelemetryFrame({
          event: sampleTelemetry,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })

        const tampered = { ...frame, content: frame.content.slice(0, -2) + "AA" }
        const result = yield* ao.readFrame(tampered, ownerSk).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })

    test("rejects a frame with malformed routing tags", async () => {
      const program = Effect.gen(function* () {
        const ao = yield* AgentObservabilityService
        const crypto = yield* CryptoService

        const ownerSk = yield* crypto.generatePrivateKey()
        const agentPk = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        // Missing the required `agent` and `frame` tags.
        const malformed = {
          pubkey: agentPk,
          content: "irrelevant",
          tags: [["p", agentPk]] as readonly (readonly string[])[],
        }

        const result = yield* ao.readFrame(malformed, ownerSk).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })

  describe("NIP-59 gift wrap (optional metadata privacy)", () => {
    test("wraps then unwraps a telemetry frame the owner can read", async () => {
      const program = Effect.gen(function* () {
        const ao = yield* AgentObservabilityService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const agentPk = yield* crypto.getPublicKey(agentSk)
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)

        const frame = yield* ao.buildTelemetryFrame({
          event: sampleTelemetry,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })

        const wrapped = yield* ao.wrapFrame(frame, agentSk, ownerPk)

        // Outer gift wrap is kind 1059 and hides the routing tags: the agent
        // pubkey and frame direction must not appear on the visible wire.
        expect(wrapped.kind as number).toBe(1059)
        const outerTagsJson = JSON.stringify(wrapped.tags)
        expect(outerTagsJson).not.toContain(agentPk)
        expect(outerTagsJson).not.toContain("telemetry")

        const rumor = yield* ao.unwrapFrame(wrapped, ownerSk)
        expect(rumor.pubkey).toBe(agentPk)

        const payload = yield* ao.readFrame(rumor, ownerSk)
        expect(payload.direction).toBe("telemetry")
        if (payload.direction === "telemetry") {
          expect(payload.event).toEqual(sampleTelemetry)
        }
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })

  describe("subscription filter", () => {
    test("produces the recommended live filter", async () => {
      const program = Effect.gen(function* () {
        const ao = yield* AgentObservabilityService
        const crypto = yield* CryptoService

        const ownerPk = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())
        const since = 1_777_464_000
        const filter = ao.subscriptionFilter(ownerPk, since)

        expect(filter.kinds).toEqual([OBSERVER_FRAME_KIND as unknown as number])
        expect(filter["#p"]).toEqual([ownerPk])
        expect(filter.since).toBe(since)
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })
})

describe("AgentObservabilityService — ephemeral no-store", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 31000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const relayLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.mergeAll(RelayLayer, ServiceLayer, AgentObservabilityServiceLive)
  }

  test("a published kind 24200 frame is broadcast but never stored", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      const ao = yield* AgentObservabilityService
      yield* relayService.connect()

      const agentSk = yield* crypto.generatePrivateKey()
      const agentPk = yield* crypto.getPublicKey(agentSk)
      const ownerPk = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

      const frame = yield* ao.buildTelemetryFrame({
        event: sampleTelemetry,
        agentPrivateKey: agentSk,
        ownerPublicKey: ownerPk,
      })

      // Relay accepts the ephemeral event...
      const pub = yield* relayService.publish(frame)
      expect(pub.accepted).toBe(true)

      // ...but a later REQ must not return it (no-store).
      const sub = yield* relayService.subscribe([
        decodeFilter({ kinds: [OBSERVER_FRAME_KIND], authors: [agentPk] }),
      ])
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(400).pipe(Effect.as(Option.none()))
      )
      yield* sub.unsubscribe()
      expect(Option.isNone(maybe)).toBe(true)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(relayLayers())))
  })
})
