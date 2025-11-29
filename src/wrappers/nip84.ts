/**
 * NIP-84: Highlights (kind 9802)
 * Spec: ~/code/nips/84.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

export interface HighlightTemplate {
  /** refer to a note/event being highlighted */
  readonly eventId?: string
  /** refer to a URL */
  readonly url?: string
  /** freeform content */
  readonly content?: string
  readonly created_at?: number
  /** optional labels (NIP-32) */
  readonly labels?: readonly string[]
}

export function buildHighlight({ eventId, url, content, created_at, labels }: HighlightTemplate): EventTemplate {
  const tags: string[][] = []
  if (eventId) tags.push(["e", eventId])
  if (url) tags.push(["r", url])
  if (labels && labels.length > 0) {
    for (const l of labels) tags.push(["l", l])
  }
  return {
    kind: 9802,
    content: content ?? "",
    created_at: created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signHighlight(t: HighlightTemplate, sk: Uint8Array): Event {
  return finalizeEvent(buildHighlight(t), sk)
}

