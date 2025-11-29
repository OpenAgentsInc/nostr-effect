/**
 * NIP-58: Badges
 *
 * Badge definitions, awards, and profile badge displays.
 *
 * @example
 * ```typescript
 * import {
 *   generateBadgeDefinitionEventTemplate,
 *   generateBadgeAwardEventTemplate,
 *   validateBadgeDefinitionEvent
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
  type BadgeDefinition,
  type BadgeAward,
  type ProfileBadges,
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
 * Generate an event template for profile badges
 */
export const generateProfileBadgesEventTemplate = service.generateProfileBadgesEventTemplate

/**
 * Validate a profile badges event
 */
export const validateProfileBadgesEvent = service.validateProfileBadgesEvent
