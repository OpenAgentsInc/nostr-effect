/**
 * NIP-43: Relay Access Metadata and Requests
 *
 * Spec: ~/code/nips/43.md
 *
 * Helpers for membership list, add/remove member events (relay-signed),
 * and client-side join/leave requests.
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

// Kinds from NIP-43
export const MembershipListKind = 13534
export const AddMemberKind = 8000
export const RemoveMemberKind = 8001
export const JoinRequestKind = 28934
export const InviteRequestKind = 28935
export const LeaveRequestKind = 28936

// -----------------------------------------------------------------------------
// Relay-signed events
// -----------------------------------------------------------------------------

export interface MembershipListTemplate {
  readonly members: readonly string[]
  readonly content?: string
  readonly created_at?: number
}

export function buildMembershipList({ members, content, created_at }: MembershipListTemplate): EventTemplate {
  const tags: string[][] = [["-"]]
  for (const m of members) tags.push(["member", m])
  return {
    kind: MembershipListKind,
    content: content ?? "",
    created_at: created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export interface AddMemberTemplate {
  readonly pubkey: string
  readonly content?: string
  readonly created_at?: number
}

export function buildAddMember({ pubkey, content, created_at }: AddMemberTemplate): EventTemplate {
  return {
    kind: AddMemberKind,
    content: content ?? "",
    created_at: created_at ?? Math.floor(Date.now() / 1000),
    tags: [["-"], ["p", pubkey]],
  }
}

export interface RemoveMemberTemplate {
  readonly pubkey: string
  readonly content?: string
  readonly created_at?: number
}

export function buildRemoveMember({ pubkey, content, created_at }: RemoveMemberTemplate): EventTemplate {
  return {
    kind: RemoveMemberKind,
    content: content ?? "",
    created_at: created_at ?? Math.floor(Date.now() / 1000),
    tags: [["-"], ["p", pubkey]],
  }
}

// -----------------------------------------------------------------------------
// Client-signed requests
// -----------------------------------------------------------------------------

export interface JoinRequestTemplate {
  readonly claim: string
  readonly content?: string
  readonly created_at?: number
}

export function buildJoinRequest({ claim, content, created_at }: JoinRequestTemplate): EventTemplate {
  return {
    kind: JoinRequestKind,
    content: content ?? "",
    created_at: created_at ?? Math.floor(Date.now() / 1000),
    tags: [["-"], ["claim", claim]],
  }
}

export interface LeaveRequestTemplate {
  readonly content?: string
  readonly created_at?: number
}

export function buildLeaveRequest({ content, created_at }: LeaveRequestTemplate = {}): EventTemplate {
  return {
    kind: LeaveRequestKind,
    content: content ?? "",
    created_at: created_at ?? Math.floor(Date.now() / 1000),
    tags: [["-"]],
  }
}

// -----------------------------------------------------------------------------
// Signing
// -----------------------------------------------------------------------------

export function sign(template: EventTemplate, secretKey: Uint8Array): Event {
  return finalizeEvent(template, secretKey)
}

