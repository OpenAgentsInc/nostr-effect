/**
 * NIP-75: Zap Goals Tests
 */
import { describe, test, expect } from "bun:test"
import {
  generateGoalEventTemplate,
  validateZapGoalEvent,
  ZAP_GOAL_KIND,
  type Goal,
} from "./Nip75.js"
import type { NostrEvent, EventKind, UnixTimestamp, PublicKey, EventId, Signature, Tag } from "./Schema.js"

// Helper to create a mock event
function createMockEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "test-id" as EventId,
    pubkey: "test-pubkey" as PublicKey,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: ZAP_GOAL_KIND,
    tags: [] as unknown as readonly Tag[],
    content: "",
    sig: "test-sig" as Signature,
    ...overrides,
  }
}

describe("NIP-75: Zap Goals", () => {
  describe("Goal Type", () => {
    test("should create a proper Goal object", () => {
      const goal: Goal = {
        content: "Fundraising for a new project",
        amount: "100000000",
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
        closedAt: 1671150419,
        image: "https://example.com/goal-image.jpg",
        summary: "Help us reach our fundraising goal!",
        r: "https://example.com/additional-info",
        a: "fef2a50f7d9d3d5a5f38ee761bc087ec16198d3f0140df6d1e8193abf7c2b146",
        zapTags: [
          ["zap", "beneficiary1"],
          ["zap", "beneficiary2"],
        ],
      }

      expect(goal.content).toBe("Fundraising for a new project")
      expect(goal.amount).toBe("100000000")
      expect(goal.relays).toEqual(["wss://relay1.example.com", "wss://relay2.example.com"])
      expect(goal.closedAt).toBe(1671150419)
      expect(goal.image).toBe("https://example.com/goal-image.jpg")
      expect(goal.summary).toBe("Help us reach our fundraising goal!")
      expect(goal.r).toBe("https://example.com/additional-info")
      expect(goal.a).toBe("fef2a50f7d9d3d5a5f38ee761bc087ec16198d3f0140df6d1e8193abf7c2b146")
      expect(goal.zapTags).toEqual([
        ["zap", "beneficiary1"],
        ["zap", "beneficiary2"],
      ])
    })
  })

  describe("generateGoalEventTemplate", () => {
    test("should generate an EventTemplate for a fundraising goal", () => {
      const goal: Goal = {
        content: "Fundraising for a new project",
        amount: "100000000",
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
        closedAt: 1671150419,
        image: "https://example.com/goal-image.jpg",
        summary: "Help us reach our fundraising goal!",
        r: "https://example.com/additional-info",
        zapTags: [
          ["zap", "beneficiary1"],
          ["zap", "beneficiary2"],
        ],
      }

      const eventTemplate = generateGoalEventTemplate(goal)

      expect(eventTemplate.kind).toBe(ZAP_GOAL_KIND)
      expect(eventTemplate.content).toBe("Fundraising for a new project")
      expect(eventTemplate.tags).toEqual([
        ["amount", "100000000"],
        ["relays", "wss://relay1.example.com", "wss://relay2.example.com"],
        ["closed_at", "1671150419"],
        ["image", "https://example.com/goal-image.jpg"],
        ["summary", "Help us reach our fundraising goal!"],
        ["r", "https://example.com/additional-info"],
        ["zap", "beneficiary1"],
        ["zap", "beneficiary2"],
      ])
    })

    test("should generate an EventTemplate without optional properties", () => {
      const goal: Goal = {
        content: "Fundraising for a new project",
        amount: "100000000",
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
      }

      const eventTemplate = generateGoalEventTemplate(goal)

      expect(eventTemplate.kind).toBe(ZAP_GOAL_KIND)
      expect(eventTemplate.content).toBe("Fundraising for a new project")
      expect(eventTemplate.tags).toEqual([
        ["amount", "100000000"],
        ["relays", "wss://relay1.example.com", "wss://relay2.example.com"],
      ])
    })
  })

  describe("validateZapGoalEvent", () => {
    test("should validate a proper Goal event", () => {
      const event = createMockEvent({
        kind: ZAP_GOAL_KIND,
        content: "Fundraising for a new project",
        tags: [
          ["amount", "100000000"],
          ["relays", "wss://relay1.example.com", "wss://relay2.example.com"],
          ["closed_at", "1671150419"],
        ] as unknown as readonly Tag[],
      })

      expect(validateZapGoalEvent(event)).toBe(true)
    })

    test("should not validate an event with incorrect kind", () => {
      const event = createMockEvent({
        kind: 0 as EventKind,
        content: "Fundraising for a new project",
        tags: [
          ["amount", "100000000"],
          ["relays", "wss://relay1.example.com"],
        ] as unknown as readonly Tag[],
      })

      expect(validateZapGoalEvent(event)).toBe(false)
    })

    test("should not validate an event with missing amount tag", () => {
      const event = createMockEvent({
        kind: ZAP_GOAL_KIND,
        content: "Fundraising for a new project",
        tags: [
          ["relays", "wss://relay1.example.com"],
        ] as unknown as readonly Tag[],
      })

      expect(validateZapGoalEvent(event)).toBe(false)
    })

    test("should not validate an event with missing relays tag", () => {
      const event = createMockEvent({
        kind: ZAP_GOAL_KIND,
        content: "Fundraising for a new project",
        tags: [
          ["amount", "100000000"],
        ] as unknown as readonly Tag[],
      })

      expect(validateZapGoalEvent(event)).toBe(false)
    })
  })
})
