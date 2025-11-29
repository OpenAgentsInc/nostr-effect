/**
 * NIP-03: OpenTimestamps Attestations for Events
 * Spec: ~/code/nips/03.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

export const OpenTimestampsKind = 1040

export interface BuildOtsParams {
  readonly targetEventId: string
  readonly targetKind: number
  readonly relayHint?: string
  /** base64-encoded .ots file data */
  readonly otsBase64: string
  readonly created_at?: number
}

/** Build an OpenTimestamps event (kind 1040) */
export function buildOpenTimestampsEvent(p: BuildOtsParams): EventTemplate {
  const eTag: string[] = ["e", p.targetEventId]
  if (p.relayHint) eTag.push(p.relayHint)
  const tags: string[][] = [eTag, ["k", String(p.targetKind)]]
  return {
    kind: OpenTimestampsKind,
    content: p.otsBase64,
    created_at: p.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signOpenTimestampsEvent(p: BuildOtsParams, sk: Uint8Array): Event {
  return finalizeEvent(buildOpenTimestampsEvent(p), sk)
}

