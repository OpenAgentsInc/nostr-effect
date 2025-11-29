/**
 * NIP-56: Reporting (kind 1984)
 *
 * Helpers to build and sign reports for users, notes, and blobs.
 * Spec: ~/code/nips/56.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

export type ReportType =
  | "nudity"
  | "malware"
  | "profanity"
  | "illegal"
  | "spam"
  | "impersonation"
  | "other"

export interface BaseReportTemplate {
  created_at?: number
  content?: string
  extraTags?: string[][]
}

export interface ProfileReport extends BaseReportTemplate {
  kind: 1984
  pubkey: string
  report: ReportType
}

export interface NoteReport extends BaseReportTemplate {
  kind: 1984
  eventId: string
  pubkey?: string
  report: ReportType
}

export interface BlobReport extends BaseReportTemplate {
  kind: 1984
  blobHash: string
  eventId?: string
  server?: string
  report: ReportType
}

export function buildProfileReportTemplate(input: ProfileReport): EventTemplate {
  const tags: string[][] = [["p", input.pubkey, input.report]]
  if (input.extraTags) tags.push(...input.extraTags)
  return {
    kind: 1984,
    created_at: input.created_at ?? Math.floor(Date.now() / 1000),
    content: input.content ?? "",
    tags,
  }
}

export function buildNoteReportTemplate(input: NoteReport): EventTemplate {
  const tags: string[][] = [["e", input.eventId, input.report]]
  if (input.pubkey) tags.push(["p", input.pubkey])
  if (input.extraTags) tags.push(...input.extraTags)
  return {
    kind: 1984,
    created_at: input.created_at ?? Math.floor(Date.now() / 1000),
    content: input.content ?? "",
    tags,
  }
}

export function buildBlobReportTemplate(input: BlobReport): EventTemplate {
  const tags: string[][] = [["x", input.blobHash, input.report]]
  if (input.eventId) tags.push(["e", input.eventId, input.report])
  if (input.server) tags.push(["server", input.server])
  if (input.extraTags) tags.push(...input.extraTags)
  return {
    kind: 1984,
    created_at: input.created_at ?? Math.floor(Date.now() / 1000),
    content: input.content ?? "",
    tags,
  }
}

export function signReport(template: EventTemplate, secretKey: Uint8Array): Event {
  return finalizeEvent(template, secretKey)
}

