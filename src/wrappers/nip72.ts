/**
 * NIP-72: Moderated Communities (Reddit Style)
 *
 * Spec: ~/code/nips/72.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

// Kinds
export const CommunityDefinitionKind = 34550
export const CommunityPostKind = 1111 // NIP-22 post kind for communities
export const CommunityApprovalKind = 4550

// -----------------------------------------------------------------------------
// Community Definition
// -----------------------------------------------------------------------------

export interface CommunityModerator {
  readonly pubkey: string
  readonly relay?: string
}

export interface CommunityRelay {
  readonly url: string
  readonly marker?: string // "author" | "requests" | "approvals" | etc.
}

export interface CommunityDefinitionTemplate {
  readonly d: string
  readonly name?: string
  readonly description?: string
  readonly image?: { url: string; size?: string }
  readonly moderators?: readonly CommunityModerator[]
  readonly relays?: readonly CommunityRelay[]
  readonly content?: string
  readonly created_at?: number
  readonly extraTags?: readonly string[][]
}

export function buildCommunityDefinition(t: CommunityDefinitionTemplate): EventTemplate {
  const tags: string[][] = [["d", t.d]]
  if (t.name) tags.push(["name", t.name])
  if (t.description) tags.push(["description", t.description])
  if (t.image) tags.push(["image", t.image.url, ...(t.image.size ? [t.image.size] : [])])
  if (t.moderators) {
    for (const m of t.moderators) {
      const tag: string[] = ["p", m.pubkey]
      if (m.relay) tag.push(m.relay)
      tag.push("moderator")
      tags.push(tag)
    }
  }
  if (t.relays) {
    for (const r of t.relays) {
      const tag: string[] = ["relay", r.url]
      if (r.marker) tag.push(r.marker)
      tags.push(tag)
    }
  }
  if (t.extraTags) tags.push(...t.extraTags.map((x) => x.slice()))
  return {
    kind: CommunityDefinitionKind,
    content: t.content ?? "",
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signCommunityDefinition(t: CommunityDefinitionTemplate, sk: Uint8Array): Event {
  return finalizeEvent(buildCommunityDefinition(t), sk)
}

// -----------------------------------------------------------------------------
// Post to Community (NIP-22 kind 1111)
// -----------------------------------------------------------------------------

export interface CommunityPointer {
  readonly ownerPubkey: string // community definition author pubkey
  readonly d: string
  readonly relay?: string
}

export interface CommunityTopPostTemplate {
  readonly community: CommunityPointer
  readonly content: string
  readonly created_at?: number
}

export function buildTopLevelCommunityPost(t: CommunityTopPostTemplate): EventTemplate {
  const a = `${CommunityDefinitionKind}:${t.community.ownerPubkey}:${t.community.d}`
  const tags: string[][] = [
    ["A", a, ...(t.community.relay ? [t.community.relay] : [])],
    ["a", a, ...(t.community.relay ? [t.community.relay] : [])],
    ["P", t.community.ownerPubkey, ...(t.community.relay ? [t.community.relay] : [])],
    ["p", t.community.ownerPubkey, ...(t.community.relay ? [t.community.relay] : [])],
    ["K", String(CommunityDefinitionKind)],
    ["k", String(CommunityDefinitionKind)],
  ]
  return {
    kind: CommunityPostKind,
    content: t.content,
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export interface CommunityReplyTemplate {
  readonly community: CommunityPointer
  readonly parentEventId: string
  readonly parentAuthorPubkey: string
  readonly parentKind: number // most likely 1111
  readonly content: string
  readonly created_at?: number
}

export function buildReplyCommunityPost(t: CommunityReplyTemplate): EventTemplate {
  const a = `${CommunityDefinitionKind}:${t.community.ownerPubkey}:${t.community.d}`
  const tags: string[][] = [
    ["A", a, ...(t.community.relay ? [t.community.relay] : [])],
    ["P", t.community.ownerPubkey, ...(t.community.relay ? [t.community.relay] : [])],
    ["K", String(CommunityDefinitionKind)],
    ["e", t.parentEventId, ...(t.community.relay ? [t.community.relay] : [])],
    ["p", t.parentAuthorPubkey, ...(t.community.relay ? [t.community.relay] : [])],
    ["k", String(t.parentKind)],
  ]
  return {
    kind: CommunityPostKind,
    content: t.content,
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signCommunityPost(t: CommunityTopPostTemplate | CommunityReplyTemplate, sk: Uint8Array): Event {
  const tmpl = (t as any).parentEventId ? buildReplyCommunityPost(t as CommunityReplyTemplate) : buildTopLevelCommunityPost(t as CommunityTopPostTemplate)
  return finalizeEvent(tmpl, sk)
}

// -----------------------------------------------------------------------------
// Approval (kind 4550)
// -----------------------------------------------------------------------------

export interface CommunityApprovalTemplate {
  readonly community: CommunityPointer
  readonly post: Event
  readonly postAuthorPubkey: string
  readonly postRequestKind: number // e.g., 1111
  readonly content?: string // optional override; defaults to JSON of post
  readonly created_at?: number
}

export function buildCommunityApproval(t: CommunityApprovalTemplate): EventTemplate {
  const a = `${CommunityDefinitionKind}:${t.community.ownerPubkey}:${t.community.d}`
  const tags: string[][] = [
    ["a", a, ...(t.community.relay ? [t.community.relay] : [])],
    ["e", t.post.id, ...(t.community.relay ? [t.community.relay] : [])],
    ["p", t.postAuthorPubkey, ...(t.community.relay ? [t.community.relay] : [])],
    ["k", String(t.postRequestKind)],
  ]
  const content = t.content ?? JSON.stringify(t.post)
  return {
    kind: CommunityApprovalKind,
    content,
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signCommunityApproval(t: CommunityApprovalTemplate, sk: Uint8Array): Event {
  return finalizeEvent(buildCommunityApproval(t), sk)
}

