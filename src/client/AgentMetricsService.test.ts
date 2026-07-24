/**
 * NIP-AM: Agent Turn Metrics service tests
 *
 * Covers:
 * - encrypt/decrypt round-trip (agent -> owner)
 * - tag layout (exactly one p, one agent == pubkey)
 * - a third party cannot decrypt
 * - a tampered event fails verification
 * - malformed routing tags are rejected
 * - agent tag mismatch is rejected
 * - unknown payload fields are ignored
 * - cumulative requires sessionId + turnSeq
 * - created_at defaults from payload timestamp
 * - the recommended subscription filter shape
 */
import { test, expect, describe } from "vite-plus/test"
import { Effect, Layer } from "effect"
import {
  AgentMetricsService,
  AgentMetricsServiceLive,
} from "./AgentMetricsService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import {
  TURN_METRIC_KIND,
  turnMetricFromJson,
  turnMetricToJson,
  parseTurnMetricTags,
  buildTurnMetricTags,
  normalizeStopReason,
  type TurnMetric,
} from "../core/NipAM.js"

const sampleMetric: TurnMetric = {
  harness: "goose",
  model: "claude-sonnet-4-5",
  channelId: "52a85618-0f8f-4542-94ec-599e6e1c6f2e",
  sessionId: "a1b2c3d4",
  turnId: "e5f6g7h8",
  turnSeq: 17,
  timestamp: "2026-07-01T20:11:03.213Z",
  turn: {
    inputTokens: 1234,
    outputTokens: 567,
    totalTokens: 1801,
    costUsd: 0.0123,
  },
  cumulative: {
    inputTokens: 45210,
    outputTokens: 9876,
    totalTokens: 55086,
    costUsd: 0.41,
  },
  deltaReliable: true,
  stopReason: "end_turn",
}

const minimalMetric: TurnMetric = {
  harness: "goose",
  timestamp: "2026-07-01T20:11:03.213Z",
}

describe("NipAM codecs", () => {
  test("round-trips a full turn metric through JSON", () => {
    const json = turnMetricToJson(sampleMetric)
    expect(json).toContain("goose")
    expect(turnMetricFromJson(json)).toEqual(sampleMetric)
  })

  test("round-trips a minimal harness+timestamp payload", () => {
    expect(turnMetricFromJson(turnMetricToJson(minimalMetric))).toEqual(minimalMetric)
  })

  test("ignores unknown payload fields on decode", () => {
    const raw = JSON.stringify({
      harness: "goose",
      timestamp: "2026-07-01T20:11:03.213Z",
      futureField: { nested: true },
      turn: { inputTokens: 10, mystery: 99 },
    })
    const decoded = turnMetricFromJson(raw)
    expect(decoded.harness).toBe("goose")
    expect(decoded.timestamp).toBe("2026-07-01T20:11:03.213Z")
    expect(decoded.turn).toEqual({ inputTokens: 10 })
    expect((decoded as Record<string, unknown>).futureField).toBeUndefined()
  })

  test("rejects missing required harness", () => {
    expect(() => turnMetricFromJson(JSON.stringify({ timestamp: "x" }))).toThrow()
  })

  test("rejects cumulative without sessionId/turnSeq", () => {
    expect(() =>
      turnMetricToJson({
        harness: "goose",
        timestamp: "2026-07-01T20:11:03.213Z",
        cumulative: { inputTokens: 1 },
      })
    ).toThrow(/sessionId/)

    expect(() =>
      turnMetricFromJson(
        JSON.stringify({
          harness: "goose",
          timestamp: "2026-07-01T20:11:03.213Z",
          sessionId: "s1",
          cumulative: { inputTokens: 1 },
        })
      )
    ).toThrow(/turnSeq/)
  })

  test("rejects negative token counts", () => {
    expect(() =>
      turnMetricFromJson(
        JSON.stringify({
          harness: "goose",
          timestamp: "2026-07-01T20:11:03.213Z",
          turn: { inputTokens: -1 },
        })
      )
    ).toThrow()
  })

  test("normalizeStopReason maps unknown values to unknown", () => {
    expect(normalizeStopReason("end_turn")).toBe("end_turn")
    expect(normalizeStopReason("new_future_reason")).toBe("unknown")
    expect(normalizeStopReason(undefined)).toBeUndefined()
  })
})

describe("NipAM tags", () => {
  test("build/parse round-trip", () => {
    const owner = "aa".repeat(32)
    const agent = "bb".repeat(32)
    const tags = buildTurnMetricTags({
      owner: owner as never,
      agent: agent as never,
    })
    expect(tags).toContainEqual(["p", owner])
    expect(tags).toContainEqual(["agent", agent])
    expect(tags).toHaveLength(2)
    expect(parseTurnMetricTags(tags)).toEqual({
      owner: owner as never,
      agent: agent as never,
    })
  })

  test("rejects missing or duplicated tags", () => {
    expect(parseTurnMetricTags([["p", "aa"]])).toBeNull()
    expect(
      parseTurnMetricTags([
        ["p", "aa"],
        ["p", "bb"],
        ["agent", "cc"],
      ])
    ).toBeNull()
    expect(
      parseTurnMetricTags([
        ["p", "aa"],
        ["agent", "bb"],
        ["agent", "cc"],
      ])
    ).toBeNull()
    expect(parseTurnMetricTags([])).toBeNull()
  })
})

describe("AgentMetricsService", () => {
  const unitLayers = () => Layer.merge(AgentMetricsServiceLive, CryptoServiceLive)

  describe("encrypt/decrypt round-trip", () => {
    test("owner can read a turn metric published by the agent", async () => {
      const program = Effect.gen(function* () {
        const am = yield* AgentMetricsService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const agentPk = yield* crypto.getPublicKey(agentSk)
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)

        const event = yield* am.buildTurnMetric({
          metric: sampleMetric,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })

        // Wire shape
        expect(event.kind).toBe(TURN_METRIC_KIND)
        expect(event.pubkey).toBe(agentPk)
        expect(event.tags).toContainEqual(["p", ownerPk])
        expect(event.tags).toContainEqual(["agent", agentPk])
        // Exactly one of each required tag
        expect(event.tags.filter((t) => t[0] === "p")).toHaveLength(1)
        expect(event.tags.filter((t) => t[0] === "agent")).toHaveLength(1)
        // content must be encrypted, not the plaintext
        expect(event.content).not.toContain("goose")
        expect(event.content).not.toContain("claude-sonnet")
        // created_at SHOULD equal payload timestamp truncated to seconds
        expect(event.created_at as number).toBe(
          Math.floor(Date.parse(sampleMetric.timestamp) / 1000)
        )

        const decoded = yield* am.readTurnMetric(event, ownerSk)
        expect(decoded).toEqual(sampleMetric)
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })

    test("round-trips a minimal payload with nullable fields", async () => {
      const program = Effect.gen(function* () {
        const am = yield* AgentMetricsService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)

        const metric: TurnMetric = {
          harness: "acp",
          model: null,
          channelId: null,
          sessionId: null,
          turnId: null,
          turnSeq: null,
          timestamp: "2026-07-01T12:00:00.000Z",
          turn: {
            inputTokens: null,
            outputTokens: 42,
            totalTokens: null,
            costUsd: null,
          },
          deltaReliable: false,
        }

        const event = yield* am.buildTurnMetric({
          metric,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })
        const decoded = yield* am.readTurnMetric(event, ownerSk)
        expect(decoded).toEqual(metric)
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })

  describe("tag validation", () => {
    test("rejects an event with malformed routing tags", async () => {
      const program = Effect.gen(function* () {
        const am = yield* AgentMetricsService
        const crypto = yield* CryptoService

        const ownerSk = yield* crypto.generatePrivateKey()
        const agentPk = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        // Missing the required `agent` tag.
        const malformed = {
          pubkey: agentPk,
          content: "irrelevant",
          tags: [["p", agentPk]] as readonly (readonly string[])[],
        }

        const result = yield* am.readTurnMetric(malformed, ownerSk).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })

    test("rejects an event whose agent tag does not equal pubkey", async () => {
      const program = Effect.gen(function* () {
        const am = yield* AgentMetricsService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)
        const otherPk = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

        const event = yield* am.buildTurnMetric({
          metric: minimalMetric,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })

        // Tamper the agent tag so it no longer matches pubkey.
        const mismatched = {
          ...event,
          tags: [
            ["p", ownerPk],
            ["agent", otherPk],
          ] as readonly (readonly string[])[],
        }

        const result = yield* am.readTurnMetric(mismatched, ownerSk).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })

  describe("security", () => {
    test("a third party cannot decrypt a turn metric", async () => {
      const program = Effect.gen(function* () {
        const am = yield* AgentMetricsService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)
        const strangerSk = yield* crypto.generatePrivateKey()

        const event = yield* am.buildTurnMetric({
          metric: sampleMetric,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })

        const result = yield* am.readTurnMetric(event, strangerSk).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })

    test("a tampered event fails verification", async () => {
      const program = Effect.gen(function* () {
        const am = yield* AgentMetricsService
        const crypto = yield* CryptoService

        const agentSk = yield* crypto.generatePrivateKey()
        const ownerSk = yield* crypto.generatePrivateKey()
        const ownerPk = yield* crypto.getPublicKey(ownerSk)

        const event = yield* am.buildTurnMetric({
          metric: sampleMetric,
          agentPrivateKey: agentSk,
          ownerPublicKey: ownerPk,
        })

        const tampered = { ...event, content: event.content.slice(0, -2) + "AA" }
        const result = yield* am.readTurnMetric(tampered, ownerSk).pipe(Effect.result)
        expect(result._tag).toBe("Failure")
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })

  describe("subscription filter", () => {
    test("produces the recommended owner-scoped filter", async () => {
      const program = Effect.gen(function* () {
        const am = yield* AgentMetricsService
        const crypto = yield* CryptoService

        const ownerPk = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())
        const since = 1_777_464_000
        const filter = am.subscriptionFilter(ownerPk, since)

        expect(filter.kinds).toEqual([TURN_METRIC_KIND as unknown as number])
        expect(filter["#p"]).toEqual([ownerPk])
        expect(filter.since).toBe(since)
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })

    test("omits since when not provided", async () => {
      const program = Effect.gen(function* () {
        const am = yield* AgentMetricsService
        const crypto = yield* CryptoService

        const ownerPk = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())
        const filter = am.subscriptionFilter(ownerPk)

        expect(filter.kinds).toEqual([TURN_METRIC_KIND as unknown as number])
        expect(filter["#p"]).toEqual([ownerPk])
        expect(filter.since).toBeUndefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(unitLayers())))
    })
  })
})
