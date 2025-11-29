/**
 * NIP-58: Badges
 * https://github.com/nostr-protocol/nips/blob/master/58.md
 *
 * Badge definitions, awards, and profile badge displays
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

/** Kind 30008: Profile Badges */
export const PROFILE_BADGES_KIND = 30008 as EventKind

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
  readonly p: readonly (readonly [string, string])[]
}

/**
 * Profile badges structure
 */
export interface ProfileBadges {
  /** Must be "profile_badges" */
  readonly d: "profile_badges"
  /** List of badges to display */
  readonly badges: readonly {
    /** Badge definition address */
    readonly a: string
    /** Badge award event IDs with relays */
    readonly e: readonly string[]
  }[]
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
   * Generate an event template for profile badges
   */
  readonly generateProfileBadgesEventTemplate: (profile: ProfileBadges) => {
    readonly kind: EventKind
    readonly tags: readonly (readonly string[])[]
    readonly content: string
    readonly created_at: UnixTimestamp
  }

  /**
   * Validate a profile badges event
   */
  readonly validateProfileBadgesEvent: (event: NostrEvent) => boolean
}

export const Nip58Service = Context.GenericTag<Nip58Service>("Nip58Service")

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
        created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
      }
    }

  const validateBadgeDefinitionEvent: Nip58Service["validateBadgeDefinitionEvent"] = (event) => {
    if (event.kind !== BADGE_DEFINITION_KIND) return false
    return event.tags.some((t) => t[0] === "d")
  }

  const generateBadgeAwardEventTemplate: Nip58Service["generateBadgeAwardEventTemplate"] = ({
    a,
    p,
  }) => {
    const tags: string[][] = [["a", a]]

    for (const [pubkey, relay] of p) {
      tags.push(["p", pubkey, relay])
    }

    return {
      kind: BADGE_AWARD_KIND,
      tags: tags as readonly (readonly string[])[],
      content: "",
      created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    }
  }

  const validateBadgeAwardEvent: Nip58Service["validateBadgeAwardEvent"] = (event) => {
    if (event.kind !== BADGE_AWARD_KIND) return false
    const hasA = event.tags.some((t) => t[0] === "a")
    const hasP = event.tags.some((t) => t[0] === "p")
    return hasA && hasP
  }

  const generateProfileBadgesEventTemplate: Nip58Service["generateProfileBadgesEventTemplate"] = ({
    badges,
  }) => {
    const tags: string[][] = [["d", "profile_badges"]]

    for (const badge of badges) {
      tags.push(["a", badge.a])
      tags.push(["e", ...badge.e])
    }

    return {
      kind: PROFILE_BADGES_KIND,
      tags: tags as readonly (readonly string[])[],
      content: "",
      created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    }
  }

  const validateProfileBadgesEvent: Nip58Service["validateProfileBadgesEvent"] = (event) => {
    if (event.kind !== PROFILE_BADGES_KIND) return false
    return event.tags.some((t) => t[0] === "d")
  }

  return Nip58Service.of({
    generateBadgeDefinitionEventTemplate,
    validateBadgeDefinitionEvent,
    generateBadgeAwardEventTemplate,
    validateBadgeAwardEvent,
    generateProfileBadgesEventTemplate,
    validateProfileBadgesEvent,
  })
}

export const Nip58ServiceLive = Effect.succeed(makeNip58Service())
