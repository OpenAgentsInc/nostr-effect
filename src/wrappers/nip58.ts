/**
 * NIP-58: Badges
 *
 * Badge definitions, awards, profile badge displays, and badge sets.
 *
 * @example
 * ```typescript
 * import {
 *   generateBadgeDefinitionEventTemplate,
 *   generateBadgeAwardEventTemplate,
 *   generateProfileBadgesEventTemplate,
 *   generateBadgeSetEventTemplate,
 *   validateBadgeDefinitionEvent,
 * } from 'nostr-effect/nip58'
 *
 * // Create a badge definition
 * const template = generateBadgeDefinitionEventTemplate({
 *   d: 'my-badge',
 *   name: 'My Badge',
 *   description: 'A cool badge'
 * })
 * ```
 */

import { makeNip58Service } from "../client/Nip58Service.js"

const service = makeNip58Service()

// Re-export constants
export {
  BADGE_DEFINITION_KIND,
  BADGE_AWARD_KIND,
  PROFILE_BADGES_KIND,
  BADGE_SET_KIND,
  LEGACY_PROFILE_BADGES_KIND,
  LEGACY_PROFILE_BADGES_D,
  type BadgeDefinition,
  type BadgeAward,
  type BadgeRef,
  type ProfileBadges,
  type BadgeSet,
} from "../client/Nip58Service.js"

/**
 * Generate an event template for a badge definition
 */
export const generateBadgeDefinitionEventTemplate = service.generateBadgeDefinitionEventTemplate

/**
 * Validate a badge definition event
 */
export const validateBadgeDefinitionEvent = service.validateBadgeDefinitionEvent

/**
 * Generate an event template for a badge award
 */
export const generateBadgeAwardEventTemplate = service.generateBadgeAwardEventTemplate

/**
 * Validate a badge award event
 */
export const validateBadgeAwardEvent = service.validateBadgeAwardEvent

/**
 * Generate an event template for profile badges (kind 10008)
 */
export const generateProfileBadgesEventTemplate = service.generateProfileBadgesEventTemplate

/**
 * Validate a profile badges event (kind 10008 or legacy 30008+d=profile_badges)
 */
export const validateProfileBadgesEvent = service.validateProfileBadgesEvent

/**
 * Generate an event template for a badge set (kind 30008)
 */
export const generateBadgeSetEventTemplate = service.generateBadgeSetEventTemplate

/**
 * Validate a badge set event
 */
export const validateBadgeSetEvent = service.validateBadgeSetEvent

/**
 * True if event is deprecated Profile Badges (30008 + d=profile_badges)
 */
export const isLegacyProfileBadgesEvent = service.isLegacyProfileBadgesEvent
