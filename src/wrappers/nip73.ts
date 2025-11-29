/**
 * NIP-73: External Content IDs
 * Spec: ~/code/nips/73.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

export type ExternalKind =
  | "web"
  | "isbn"
  | "geo"
  | "isan"
  | "doi"
  | "#"
  | "podcast:guid"
  | "podcast:item:guid"
  | "podcast:publisher:guid"
  | `${string}:tx`
  | `${string}:address`

export interface ExternalId {
  readonly k: ExternalKind
  readonly i: string
  readonly urlHint?: string
}

export interface ExternalIdEventTemplate {
  readonly kind: number
  readonly content?: string
  readonly externals: readonly ExternalId[]
  readonly created_at?: number
  readonly extraTags?: readonly string[][]
}

const normalizeUrl = (url: string): string => {
  try {
    const u = new URL(url)
    u.hash = ""
    return u.toString().replace(/\/$/, "")
  } catch {
    return url
  }
}

/** Build i/k tag pair */
export function buildIAndKTags(ext: ExternalId): string[][] {
  const iVal = ext.k === "web" ? normalizeUrl(ext.i) : ext.i
  const itag: string[] = ["i", iVal]
  if (ext.urlHint) itag.push(ext.urlHint)
  const ktag: string[] = ["k", ext.k]
  return [itag, ktag]
}

/** Build a template with i/k pairs */
export function buildExternalIdEvent(t: ExternalIdEventTemplate): EventTemplate {
  const tags: string[][] = []
  for (const e of t.externals) tags.push(...buildIAndKTags(e))
  if (t.extraTags) tags.push(...t.extraTags.map((x) => x.slice()))
  return {
    kind: t.kind,
    content: t.content ?? "",
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signExternalIdEvent(t: ExternalIdEventTemplate, sk: Uint8Array): Event {
  return finalizeEvent(buildExternalIdEvent(t), sk)
}

