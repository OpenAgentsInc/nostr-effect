/**
 * NIP-75: Zap Goals
 * https://github.com/nostr-protocol/nips/blob/master/75.md
 *
 * Fundraising goals for zaps
 */
import type { EventKind, UnixTimestamp, NostrEvent } from "./Schema.js"

/** Kind 9041: Zap Goal */
export const ZAP_GOAL_KIND = 9041 as EventKind

/**
 * Represents a fundraising goal
 */
export interface Goal {
  /** A human-readable description of the fundraising goal */
  content: string
  /** The target amount in millisatoshis */
  amount: string
  /** Relays where zaps will be sent and tallied from */
  relays: string[]
  /** Optional timestamp when the goal is considered closed */
  closedAt?: number
  /** Optional URL to an image */
  image?: string
  /** Optional brief summary */
  summary?: string
  /** Optional URL with additional information */
  r?: string
  /** Optional parameterized replaceable event reference */
  a?: string
  /** Optional beneficiary pubkeys for multi-recipient zaps */
  zapTags?: string[][]
}

/** Event template for signing */
export interface EventTemplate {
  created_at: UnixTimestamp
  kind: EventKind
  content: string
  tags: string[][]
}

/**
 * Generate an EventTemplate for a fundraising goal
 */
export function generateGoalEventTemplate(goal: Goal): EventTemplate {
  const tags: string[][] = [
    ["amount", goal.amount],
    ["relays", ...goal.relays],
  ]

  // Append optional tags
  if (goal.closedAt) {
    tags.push(["closed_at", goal.closedAt.toString()])
  }
  if (goal.image) {
    tags.push(["image", goal.image])
  }
  if (goal.summary) {
    tags.push(["summary", goal.summary])
  }
  if (goal.r) {
    tags.push(["r", goal.r])
  }
  if (goal.a) {
    tags.push(["a", goal.a])
  }
  if (goal.zapTags) {
    tags.push(...goal.zapTags)
  }

  return {
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: ZAP_GOAL_KIND,
    content: goal.content,
    tags,
  }
}

/**
 * Validate a zap goal event
 */
export function validateZapGoalEvent(event: NostrEvent): boolean {
  if (event.kind !== ZAP_GOAL_KIND) return false

  const requiredTags = ["amount", "relays"] as const
  for (const tag of requiredTags) {
    if (!event.tags.find(([t]) => t === tag)) return false
  }

  return true
}
