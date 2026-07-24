/**
 * NIP-58: Badges Tests
 * Tests ported from nostr-tools for 100% parity + kind 10008 / 30008 updates
 */
import { describe, test, expect } from "vite-plus/test"
import {
  makeNip58Service,
  BADGE_DEFINITION_KIND,
  BADGE_AWARD_KIND,
  PROFILE_BADGES_KIND,
  BADGE_SET_KIND,
  LEGACY_PROFILE_BADGES_KIND,
  LEGACY_PROFILE_BADGES_D,
  type BadgeDefinition,
  type BadgeAward,
  type ProfileBadges,
  type BadgeSet,
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

  describe("kinds", () => {
    test("Profile Badges is kind 10008", () => {
      expect(Number(PROFILE_BADGES_KIND)).toBe(10008)
    })

    test("Badge Sets is kind 30008", () => {
      expect(Number(BADGE_SET_KIND)).toBe(30008)
    })
  })

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
    test("has required property 'badges'", () => {
      const profileBadges: ProfileBadges = { badges: [] }
      expect(profileBadges.badges).toEqual([])
    })

    test("badges array contains objects with required properties", () => {
      const profileBadges: ProfileBadges = {
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
      expect(eventTemplate.kind).toBe(BADGE_DEFINITION_KIND)
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
    test("generates kind 10008 without d tag", () => {
      const profileBadges: ProfileBadges = { badges: [] }
      const eventTemplate = service.generateProfileBadgesEventTemplate(profileBadges)
      expect(Number(eventTemplate.kind)).toBe(10008)
      expect(eventTemplate.tags).toEqual([])
    })

    test("generates EventTemplate with badge a/e pairs", () => {
      const profileBadges: ProfileBadges = {
        badges: [{ a: "badge-definition-address", e: ["badge-award-event-id"] }],
      }
      const eventTemplate = service.generateProfileBadgesEventTemplate(profileBadges)
      expect(eventTemplate.tags).toEqual([
        ["a", "badge-definition-address"],
        ["e", "badge-award-event-id"],
      ])
    })

    test("generates EventTemplate with multiple badges", () => {
      const profileBadges: ProfileBadges = {
        badges: [
          { a: "badge-definition-address1", e: ["badge-award-event-id1", "badge-award-event-id2"] },
          { a: "badge-definition-address2", e: ["badge-award-event-id3"] },
        ],
      }
      const eventTemplate = service.generateProfileBadgesEventTemplate(profileBadges)
      expect(eventTemplate.tags).toEqual([
        ["a", "badge-definition-address1"],
        ["e", "badge-award-event-id1", "badge-award-event-id2"],
        ["a", "badge-definition-address2"],
        ["e", "badge-award-event-id3"],
      ])
    })

    test("includes optional badge set pointers", () => {
      const profileBadges: ProfileBadges = {
        badges: [],
        setPointers: ["30008:bob:favorites"],
      }
      const eventTemplate = service.generateProfileBadgesEventTemplate(profileBadges)
      expect(eventTemplate.tags).toEqual([["a", "30008:bob:favorites"]])
    })
  })

  describe("validateProfileBadgesEvent", () => {
    test("returns true for kind 10008", () => {
      const event = createTestEvent(PROFILE_BADGES_KIND, [
        ["a", "badge-definition-address"],
        ["e", "badge-award-event-id"],
      ])
      expect(service.validateProfileBadgesEvent(event)).toBe(true)
    })

    test("returns true for empty kind 10008 list", () => {
      const event = createTestEvent(PROFILE_BADGES_KIND, [])
      expect(service.validateProfileBadgesEvent(event)).toBe(true)
    })

    test("returns true for legacy 30008 + d=profile_badges", () => {
      const event = createTestEvent(LEGACY_PROFILE_BADGES_KIND, [
        ["d", LEGACY_PROFILE_BADGES_D],
        ["a", "badge-definition-address"],
        ["e", "badge-award-event-id"],
      ])
      expect(service.validateProfileBadgesEvent(event)).toBe(true)
      expect(service.isLegacyProfileBadgesEvent(event)).toBe(true)
    })

    test("returns false for unrelated kinds", () => {
      const event = createTestEvent(1 as EventKind, [])
      expect(service.validateProfileBadgesEvent(event)).toBe(false)
    })
  })

  describe("generateBadgeSetEventTemplate", () => {
    test("generates kind 30008 with d tag", () => {
      const set: BadgeSet = { d: "favorites", badges: [] }
      const eventTemplate = service.generateBadgeSetEventTemplate(set)
      expect(eventTemplate.kind).toBe(BADGE_SET_KIND)
      expect(eventTemplate.tags).toEqual([["d", "favorites"]])
    })

    test("includes title and badge pairs", () => {
      const set: BadgeSet = {
        d: "favorites",
        title: "Favorites",
        badges: [{ a: "30009:alice:bravery", e: ["award1", "wss://relay"] }],
      }
      const eventTemplate = service.generateBadgeSetEventTemplate(set)
      expect(eventTemplate.tags).toEqual([
        ["d", "favorites"],
        ["title", "Favorites"],
        ["a", "30009:alice:bravery"],
        ["e", "award1", "wss://relay"],
      ])
    })
  })

  describe("validateBadgeSetEvent", () => {
    test("returns true for valid badge set", () => {
      const event = createTestEvent(BADGE_SET_KIND, [
        ["d", "favorites"],
        ["a", "30009:alice:bravery"],
        ["e", "award1"],
      ])
      expect(service.validateBadgeSetEvent(event)).toBe(true)
    })

    test("returns false for legacy profile_badges d-tag", () => {
      const event = createTestEvent(BADGE_SET_KIND, [["d", LEGACY_PROFILE_BADGES_D]])
      expect(service.validateBadgeSetEvent(event)).toBe(false)
    })

    test("returns false without d tag", () => {
      const event = createTestEvent(BADGE_SET_KIND, [])
      expect(service.validateBadgeSetEvent(event)).toBe(false)
    })
  })
})
