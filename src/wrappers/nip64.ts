/**
 * NIP-64: Chess (Portable Game Notation)
 * Spec: ~/code/nips/64.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

/** Kind for chess PGN notes */
export const ChessKind = 64

export interface BuildChessParams {
  /** PGN content (import/export format) */
  readonly content: string
  /** Optional tags (e.g., ["alt", "... description ..."]) */
  readonly tags?: readonly string[][]
  /** Optional unix timestamp */
  readonly created_at?: number
}

/** Build a chess PGN event (kind 64) */
export function buildChessEvent(p: BuildChessParams): EventTemplate {
  return {
    kind: ChessKind,
    content: p.content,
    tags: (p.tags ?? []).map((t) => t.slice()),
    created_at: p.created_at ?? Math.floor(Date.now() / 1000),
  }
}

/** Sign a chess PGN event (kind 64) */
export function signChessEvent(p: BuildChessParams, sk: Uint8Array): Event {
  return finalizeEvent(buildChessEvent(p), sk)
}

