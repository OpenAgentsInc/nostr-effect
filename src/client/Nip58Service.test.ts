/**
 * NIP-58: Badges Tests
 * Tests ported from nostr-tools for 100% parity
 */
import { describe, test, expect } from "bun:test"
import {
  makeNip58Service,
  BADGE_DEFINITION_KIND,
  BADGE_AWARD_KIND,
  PROFILE_BADGES_KIND,
  type BadgeDefinition,
  type BadgeAward,
  type ProfileBadges,
} from "./Nip58Service.js"
import type { NostrEvent, EventKind, EventId, PublicKey, UnixTimestamp, Signature, Tag } from "../core/Schema.js"

const createTestEvent = (kind: EventKind, tags: string[][]): NostrEvent => ({
  id: "abc123" as EventId,
  pubkey: "pubkey123" as PublicKey,
  created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
  kind,
  tags: tags as unknown as readonly Tag[],
  content: "",
  sig: "sig123" as Signature,
})

describe("NIP-58: Badges", () => {
  const service = makeNip58Service()

  describe("BadgeDefinition", () => {
    test("has required property 'd'", () => {
      const badge: BadgeDefinition = { d: "badge-id" }
      expect(badge.d).toBe("badge-id")
    })

    test("has optional property 'name'", () => {
      const badge: BadgeDefinition = { d: "badge-id", name: "Badge Name" }
      expect(badge.name).toBe("Badge Name")
    })

    test("has optional property 'description'", () => {
      const badge: BadgeDefinition = { d: "badge-id", description: "Badge Description" }
      expect(badge.description).toBe("Badge Description")
    })

    test("has optional property 'image'", () => {
      const badge: BadgeDefinition = {
        d: "badge-id",
        image: ["https://example.com/badge.png", "1024x1024"],
      }
      expect(badge.image).toEqual(["https://example.com/badge.png", "1024x1024"])
    })

    test("has optional property 'thumbs'", () => {
      const badge: BadgeDefinition = {
        d: "badge-id",
        thumbs: [
          ["https://example.com/thumb.png", "100x100"],
          ["https://example.com/thumb2.png", "200x200"],
        ],
      }
      expect(badge.thumbs).toEqual([
        ["https://example.com/thumb.png", "100x100"],
        ["https://example.com/thumb2.png", "200x200"],
      ])
    })
  })

  describe("BadgeAward", () => {
    test("has required property 'a'", () => {
      const badgeAward: BadgeAward = {
        a: "badge-definition-address",
        p: [
          ["pubkey1", "relay1"],
          ["pubkey2", "relay2"],
        ],
      }
      expect(badgeAward.a).toBe("badge-definition-address")
    })

    test("has required property 'p'", () => {
      const badgeAward: BadgeAward = {
        a: "badge-definition-address",
        p: [
          ["pubkey1", "relay1"],
          ["pubkey2", "relay2"],
        ],
      }
      expect(badgeAward.p).toEqual([
        ["pubkey1", "relay1"],
        ["pubkey2", "relay2"],
      ])
    })
  })

  describe("ProfileBadges", () => {
    test("has required property 'd'", () => {
      const profileBadges: ProfileBadges = { d: "profile_badges", badges: [] }
      expect(profileBadges.d).toBe("profile_badges")
    })

    test("has required property 'badges'", () => {
      const profileBadges: ProfileBadges = { d: "profile_badges", badges: [] }
      expect(profileBadges.badges).toEqual([])
    })

    test("badges array contains objects with required properties", () => {
      const profileBadges: ProfileBadges = {
        d: "profile_badges",
        badges: [{ a: "badge-definition-address", e: ["badge-award-event-id"] }],
      }
      expect(profileBadges.badges[0]!.a).toBe("badge-definition-address")
      expect(profileBadges.badges[0]!.e).toEqual(["badge-award-event-id"])
    })
  })

  describe("generateBadgeDefinitionEventTemplate", () => {
    test("generates EventTemplate with mandatory tags", () => {
      const badge: BadgeDefinition = { d: "badge-id" }
      const eventTemplate = service.generateBadgeDefinitionEventTemplate(badge)
      expect(eventTemplate.tags).toEqual([["d", "badge-id"]])
    })

    test("generates EventTemplate with optional tags", () => {
      const badge: BadgeDefinition = {
        d: "badge-id",
        name: "Badge Name",
        description: "Badge Description",
        image: ["https://example.com/badge.png", "1024x1024"],
        thumbs: [
          ["https://example.com/thumb.png", "100x100"],
          ["https://example.com/thumb2.png", "200x200"],
        ],
      }
      const eventTemplate = service.generateBadgeDefinitionEventTemplate(badge)
      expect(eventTemplate.tags).toEqual([
        ["d", "badge-id"],
        ["name", "Badge Name"],
        ["description", "Badge Description"],
        ["image", "https://example.com/badge.png", "1024x1024"],
        ["thumb", "https://example.com/thumb.png", "100x100"],
        ["thumb", "https://example.com/thumb2.png", "200x200"],
      ])
    })
  })

  describe("validateBadgeDefinitionEvent", () => {
    test("returns true for valid BadgeDefinition event", () => {
      const event = createTestEvent(BADGE_DEFINITION_KIND, [
        ["d", "badge-id"],
        ["name", "Badge Name"],
      ])
      expect(service.validateBadgeDefinitionEvent(event)).toBe(true)
    })

    test("returns false for invalid BadgeDefinition event", () => {
      const event = createTestEvent(BADGE_DEFINITION_KIND, [])
      expect(service.validateBadgeDefinitionEvent(event)).toBe(false)
    })
  })

  describe("generateBadgeAwardEventTemplate", () => {
    test("generates EventTemplate with mandatory tags", () => {
      const badgeAward: BadgeAward = {
        a: "badge-definition-address",
        p: [
          ["pubkey1", "relay1"],
          ["pubkey2", "relay2"],
        ],
      }
      const eventTemplate = service.generateBadgeAwardEventTemplate(badgeAward)
      expect(eventTemplate.tags).toEqual([
        ["a", "badge-definition-address"],
        ["p", "pubkey1", "relay1"],
        ["p", "pubkey2", "relay2"],
      ])
    })
  })

  describe("validateBadgeAwardEvent", () => {
    test("returns true for valid BadgeAward event", () => {
      const event = createTestEvent(BADGE_AWARD_KIND, [
        ["a", "badge-definition-address"],
        ["p", "pubkey1", "relay1"],
      ])
      expect(service.validateBadgeAwardEvent(event)).toBe(true)
    })

    test("returns false for invalid BadgeAward event", () => {
      const event = createTestEvent(BADGE_AWARD_KIND, [])
      expect(service.validateBadgeAwardEvent(event)).toBe(false)
    })
  })

  describe("generateProfileBadgesEventTemplate", () => {
    test("generates EventTemplate with mandatory tags", () => {
      const profileBadges: ProfileBadges = { d: "profile_badges", badges: [] }
      const eventTemplate = service.generateProfileBadgesEventTemplate(profileBadges)
      expect(eventTemplate.tags).toEqual([["d", "profile_badges"]])
    })

    test("generates EventTemplate with optional tags", () => {
      const profileBadges: ProfileBadges = {
        d: "profile_badges",
        badges: [{ a: "badge-definition-address", e: ["badge-award-event-id"] }],
      }
      const eventTemplate = service.generateProfileBadgesEventTemplate(profileBadges)
      expect(eventTemplate.tags).toEqual([
        ["d", "profile_badges"],
        ["a", "badge-definition-address"],
        ["e", "badge-award-event-id"],
      ])
    })

    test("generates EventTemplate with multiple badges", () => {
      const profileBadges: ProfileBadges = {
        d: "profile_badges",
        badges: [
          { a: "badge-definition-address1", e: ["badge-award-event-id1", "badge-award-event-id2"] },
          { a: "badge-definition-address2", e: ["badge-award-event-id3"] },
        ],
      }
      const eventTemplate = service.generateProfileBadgesEventTemplate(profileBadges)
      expect(eventTemplate.tags).toEqual([
        ["d", "profile_badges"],
        ["a", "badge-definition-address1"],
        ["e", "badge-award-event-id1", "badge-award-event-id2"],
        ["a", "badge-definition-address2"],
        ["e", "badge-award-event-id3"],
      ])
    })
  })

  describe("validateProfileBadgesEvent", () => {
    test("returns true for valid ProfileBadges event", () => {
      const event = createTestEvent(PROFILE_BADGES_KIND, [
        ["d", "profile_badges"],
        ["a", "badge-definition-address"],
        ["e", "badge-award-event-id"],
      ])
      expect(service.validateProfileBadgesEvent(event)).toBe(true)
    })

    test("returns false for invalid ProfileBadges event", () => {
      const event = createTestEvent(PROFILE_BADGES_KIND, [])
      expect(service.validateProfileBadgesEvent(event)).toBe(false)
    })
  })
})
