/**
 * NIP-58: Badges
 * https://github.com/nostr-protocol/nips/blob/master/58.md
 *
 * Badge definitions, awards, profile badge displays, and badge sets.
 *
 * Kind map (current upstream):
 * - 30009 Badge Definition (addressable)
 * - 8 Badge Award
 * - 10008 Profile Badges (replaceable standard list; NIP-51 style)
 * - 30008 Badge Set (addressable)
 *
 * Deprecated: kind 30008 with d=`profile_badges` was the old Profile Badges
 * format; clients should treat those as equivalent to kind 10008 and migrate.
 */
import { Effect, Context } from "effect"
import type {
  NostrEvent,
  EventKind,
  UnixTimestamp,
} from "../core/Schema.js"

/** Kind 30009: Badge Definition */
export const BADGE_DEFINITION_KIND = 30009 as EventKind

/** Kind 8: Badge Award */
export const BADGE_AWARD_KIND = 8 as EventKind

/** Kind 10008: Profile Badges (replaceable list) */
export const PROFILE_BADGES_KIND = 10008 as EventKind

/**
 * Kind 30008: Badge Sets (addressable).
 * Also used historically for Profile Badges with d=`profile_badges` (deprecated).
 */
export const BADGE_SET_KIND = 30008 as EventKind

/** @deprecated Use BADGE_SET_KIND; 30008 is now Badge Sets, not Profile Badges */
export const LEGACY_PROFILE_BADGES_KIND = 30008 as EventKind

/** d-tag value used by the deprecated 30008 Profile Badges events */
export const LEGACY_PROFILE_BADGES_D = "profile_badges" as const

/**
 * Badge definition structure
 */
export interface BadgeDefinition {
  /** Unique identifier for the badge */
  readonly d: string
  /** Short name for the badge */
  readonly name?: string
  /** Description of the badge */
  readonly description?: string
  /** Image URL and dimensions [url, "widthxheight"] */
  readonly image?: readonly [string, string]
  /** Thumbnail images [[url, "widthxheight"], ...] */
  readonly thumbs?: readonly (readonly [string, string])[]
}

/**
 * Badge award structure
 */
export interface BadgeAward {
  /** Reference to Badge Definition event address */
  readonly a: string
  /** Recipients [[pubkey, relay], ...] */
  readonly p: readonly (readonly [string, string?])[]
}

/**
 * Ordered badge reference: definition `a` + award `e` (with optional relay)
 */
export interface BadgeRef {
  /** Badge definition address (`30009:pubkey:d`) */
  readonly a: string
  /** Badge award event id + optional relay URL(s) */
  readonly e: readonly string[]
}

/**
 * Profile badges structure (kind 10008 replaceable list)
 */
export interface ProfileBadges {
  /** List of badges to display (ordered a/e pairs) */
  readonly badges: readonly BadgeRef[]
  /**
   * Optional Badge Set pointers (`a` tags only) referencing kind 30008 sets.
   * Profile Badges may also contain bare `a` tags for sets.
   */
  readonly setPointers?: readonly string[]
}

/**
 * Badge set structure (kind 30008 addressable set)
 */
export interface BadgeSet {
  /** Unique set identifier (`d` tag) */
  readonly d: string
  /** Human-readable title for the set */
  readonly title?: string
  /** Ordered badges in the set */
  readonly badges: readonly BadgeRef[]
}

export interface Nip58Service {
  /**
   * Generate an event template for a badge definition
   */
  readonly generateBadgeDefinitionEventTemplate: (badge: BadgeDefinition) => {
    readonly kind: EventKind
    readonly tags: readonly (readonly string[])[]
    readonly content: string
    readonly created_at: UnixTimestamp
  }

  /**
   * Validate a badge definition event
   */
  readonly validateBadgeDefinitionEvent: (event: NostrEvent) => boolean

  /**
   * Generate an event template for a badge award
   */
  readonly generateBadgeAwardEventTemplate: (award: BadgeAward) => {
    readonly kind: EventKind
    readonly tags: readonly (readonly string[])[]
    readonly content: string
    readonly created_at: UnixTimestamp
  }

  /**
   * Validate a badge award event
   */
  readonly validateBadgeAwardEvent: (event: NostrEvent) => boolean

  /**
   * Generate an event template for profile badges (kind 10008)
   */
  readonly generateProfileBadgesEventTemplate: (profile: ProfileBadges) => {
    readonly kind: EventKind
    readonly tags: readonly (readonly string[])[]
    readonly content: string
    readonly created_at: UnixTimestamp
  }

  /**
   * Validate a profile badges event (kind 10008, or legacy 30008+d=profile_badges)
   */
  readonly validateProfileBadgesEvent: (event: NostrEvent) => boolean

  /**
   * Generate an event template for a badge set (kind 30008)
   */
  readonly generateBadgeSetEventTemplate: (set: BadgeSet) => {
    readonly kind: EventKind
    readonly tags: readonly (readonly string[])[]
    readonly content: string
    readonly created_at: UnixTimestamp
  }

  /**
   * Validate a badge set event (kind 30008, not the legacy profile_badges d-tag)
   */
  readonly validateBadgeSetEvent: (event: NostrEvent) => boolean

  /**
   * True if this is a legacy Profile Badges event (30008 + d=profile_badges)
   */
  readonly isLegacyProfileBadgesEvent: (event: NostrEvent) => boolean
}

export const Nip58Service = Context.Service<Nip58Service>("Nip58Service")

const now = (): UnixTimestamp => Math.floor(Date.now() / 1000) as UnixTimestamp

const pushBadgePairs = (tags: string[][], badges: readonly BadgeRef[]): void => {
  for (const badge of badges) {
    tags.push(["a", badge.a])
    tags.push(["e", ...badge.e])
  }
}

/**
 * Create the Nip58Service implementation
 */
export const makeNip58Service = (): Nip58Service => {
  const generateBadgeDefinitionEventTemplate: Nip58Service["generateBadgeDefinitionEventTemplate"] =
    ({ d, name, description, image, thumbs }) => {
      const tags: string[][] = [["d", d]]

      if (name) tags.push(["name", name])
      if (description) tags.push(["description", description])
      if (image) tags.push(["image", ...image])
      if (thumbs) {
        for (const thumb of thumbs) {
          tags.push(["thumb", ...thumb])
        }
      }

      return {
        kind: BADGE_DEFINITION_KIND,
        tags: tags as readonly (readonly string[])[],
        content: "",
        created_at: now(),
      }
    }

  const validateBadgeDefinitionEvent: Nip58Service["validateBadgeDefinitionEvent"] = (event) => {
    if (event.kind !== BADGE_DEFINITION_KIND) return false
    return event.tags.some((t) => t[0] === "d" && typeof t[1] === "string" && t[1].length > 0)
  }

  const generateBadgeAwardEventTemplate: Nip58Service["generateBadgeAwardEventTemplate"] = ({
    a,
    p,
  }) => {
    const tags: string[][] = [["a", a]]

    for (const recipient of p) {
      const [pubkey, relay] = recipient
      if (relay) tags.push(["p", pubkey, relay])
      else tags.push(["p", pubkey])
    }

    return {
      kind: BADGE_AWARD_KIND,
      tags: tags as readonly (readonly string[])[],
      content: "",
      created_at: now(),
    }
  }

  const validateBadgeAwardEvent: Nip58Service["validateBadgeAwardEvent"] = (event) => {
    if (event.kind !== BADGE_AWARD_KIND) return false
    const hasA = event.tags.some((t) => t[0] === "a" && typeof t[1] === "string")
    const hasP = event.tags.some((t) => t[0] === "p" && typeof t[1] === "string")
    return hasA && hasP
  }

  const isLegacyProfileBadgesEvent: Nip58Service["isLegacyProfileBadgesEvent"] = (event) => {
    if (event.kind !== LEGACY_PROFILE_BADGES_KIND) return false
    return event.tags.some((t) => t[0] === "d" && t[1] === LEGACY_PROFILE_BADGES_D)
  }

  const generateProfileBadgesEventTemplate: Nip58Service["generateProfileBadgesEventTemplate"] = ({
    badges,
    setPointers,
  }) => {
    // Kind 10008 is a NIP-51 standard list — no d tag required
    const tags: string[][] = []
    pushBadgePairs(tags, badges)
    if (setPointers) {
      for (const pointer of setPointers) {
        tags.push(["a", pointer])
      }
    }

    return {
      kind: PROFILE_BADGES_KIND,
      tags: tags as readonly (readonly string[])[],
      content: "",
      created_at: now(),
    }
  }

  const validateProfileBadgesEvent: Nip58Service["validateProfileBadgesEvent"] = (event) => {
    // Current format: kind 10008 replaceable list
    if (event.kind === PROFILE_BADGES_KIND) return true
    // Deprecated format: kind 30008 with d=profile_badges
    return isLegacyProfileBadgesEvent(event)
  }

  const generateBadgeSetEventTemplate: Nip58Service["generateBadgeSetEventTemplate"] = ({
    d,
    title,
    badges,
  }) => {
    const tags: string[][] = [["d", d]]
    if (title) tags.push(["title", title])
    pushBadgePairs(tags, badges)

    return {
      kind: BADGE_SET_KIND,
      tags: tags as readonly (readonly string[])[],
      content: "",
      created_at: now(),
    }
  }

  const validateBadgeSetEvent: Nip58Service["validateBadgeSetEvent"] = (event) => {
    if (event.kind !== BADGE_SET_KIND) return false
    // Exclude deprecated profile_badges pseudo-sets
    if (isLegacyProfileBadgesEvent(event)) return false
    return event.tags.some((t) => t[0] === "d" && typeof t[1] === "string" && t[1].length > 0)
  }

  return Nip58Service.of({
    generateBadgeDefinitionEventTemplate,
    validateBadgeDefinitionEvent,
    generateBadgeAwardEventTemplate,
    validateBadgeAwardEvent,
    generateProfileBadgesEventTemplate,
    validateProfileBadgesEvent,
    generateBadgeSetEventTemplate,
    validateBadgeSetEvent,
    isLegacyProfileBadgesEvent,
  })
}

export const Nip58ServiceLive = Effect.succeed(makeNip58Service())
