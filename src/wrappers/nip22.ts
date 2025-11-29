/**
 * NIP-22: Comment (kind 1111)
 * Spec: ~/code/nips/22.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

export const CommentKind = 1111

export type RootTagType = "A" | "E" | "I"
export type ParentTagType = "a" | "e" | "i"

export interface RootPointer {
  readonly type: RootTagType
  readonly value: string
  readonly relay?: string
  /** For E-tag form: pubkey of root event as 4th value */
  readonly pubkey?: string
}

export interface ParentPointer {
  readonly type: ParentTagType
  readonly value: string
  readonly relay?: string
  /** For e-tag form: pubkey of parent event as 4th value */
  readonly pubkey?: string
}

export interface AuthorRef {
  readonly pubkey: string
  readonly relay?: string
}

export interface BuildCommentParams {
  readonly content: string
  readonly root: RootPointer
  readonly parent: ParentPointer
  readonly rootKind: number
  readonly parentKind: number
  /** Root author (P tag) is strongly encouraged by spec */
  readonly rootAuthor?: AuthorRef
  /** Parent author (p tag) is encouraged when replying */
  readonly parentAuthor?: AuthorRef
  /** Optional NIP-21 citation pointers: q tags */
  readonly citations?: readonly { value: string; relay?: string; pubkey?: string }[]
  /** Extra tags to append */
  readonly extraTags?: readonly string[][]
  readonly created_at?: number
}

const pushPointer = (tags: string[][], type: string, value: string, relay?: string, pubkey?: string) => {
  const t: string[] = [type, value]
  if (relay) t.push(relay)
  if (pubkey) t.push(pubkey)
  tags.push(t)
}

/** Build a NIP-22 comment event template */
export function buildCommentEvent(p: BuildCommentParams): EventTemplate {
  const tags: string[][] = []

  // Root scope pointer (A/E/I)
  pushPointer(tags, p.root.type, p.root.value, p.root.relay, p.root.pubkey)
  // Root kind (K)
  tags.push(["K", String(p.rootKind)])
  // Root author (P)
  if (p.rootAuthor) {
    const t: string[] = ["P", p.rootAuthor.pubkey]
    if (p.rootAuthor.relay) t.push(p.rootAuthor.relay)
    tags.push(t)
  }

  // Parent pointer (a/e/i)
  pushPointer(tags, p.parent.type, p.parent.value, p.parent.relay, p.parent.pubkey)
  // Parent kind (k)
  tags.push(["k", String(p.parentKind)])
  // Parent author (p)
  if (p.parentAuthor) {
    const t: string[] = ["p", p.parentAuthor.pubkey]
    if (p.parentAuthor.relay) t.push(p.parentAuthor.relay)
    tags.push(t)
  }

  // q tags (NIP-21 citation)
  if (p.citations) {
    for (const q of p.citations) {
      const t: string[] = ["q", q.value]
      if (q.relay) t.push(q.relay)
      if (q.pubkey) t.push(q.pubkey)
      tags.push(t)
    }
  }

  // Extra tags at the end
  if (p.extraTags) tags.push(...p.extraTags.map((t) => t.slice()))

  return {
    kind: CommentKind,
    content: p.content,
    tags,
    created_at: p.created_at ?? Math.floor(Date.now() / 1000),
  }
}

/** Sign a NIP-22 comment event */
export function signCommentEvent(p: BuildCommentParams, sk: Uint8Array): Event {
  return finalizeEvent(buildCommentEvent(p), sk)
}

