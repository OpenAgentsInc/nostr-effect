/**
 * NIP-75: Zap Goals
 *
 * Create and validate zap goal events for fundraising.
 *
 * @example
 * ```typescript
 * import { generateGoalEventTemplate, validateZapGoalEvent } from 'nostr-effect/nip75'
 *
 * // Create a zap goal
 * const template = generateGoalEventTemplate({
 *   content: 'Help fund my project!',
 *   amount: '1000000',
 *   relays: ['wss://relay.example.com']
 * })
 * ```
 */

// Re-export all from core implementation
export {
  ZAP_GOAL_KIND,
  generateGoalEventTemplate,
  validateZapGoalEvent,
  type Goal,
  type EventTemplate,
} from "../core/Nip75.js"
