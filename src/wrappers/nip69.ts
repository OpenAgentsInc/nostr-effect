/**
 * NIP-69: Peer-to-peer Order events (kind 38383)
 * Spec: ~/code/nips/69.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

export const P2POrderKind = 38383

export type OrderType = "sell" | "buy"
export type OrderStatus = "pending" | "canceled" | "in-progress" | "success" | "expired"

export interface P2POrderTemplate {
  readonly idD: string // d tag (unique identifier)
  readonly type: OrderType // k tag
  readonly currency: string // f tag (ISO 4217)
  readonly status: OrderStatus // s tag
  readonly amountSats: string // amt tag (string per spec)
  readonly fiatAmount: string | readonly [string, string] // fa tag (single or range)
  readonly paymentMethods?: readonly string[] // pm tag (comma-joined if many)
  readonly premiumPct?: string // premium tag (percentage string)
  readonly sourceUrl?: string // source tag
  readonly ratingJson?: string // rating tag JSON
  readonly network?: string // network tag
  readonly layer?: string // layer tag
  readonly name?: string // name tag
  readonly geohash?: string // g tag
  readonly bond?: string // bond tag
  readonly expiresAt?: string // expires_at tag (timestamp)
  readonly expiration?: string // expiration tag (NIP-40 timestamp)
  readonly platform?: string // y tag
  readonly document?: string // z tag (typically "order")
  readonly content?: string
  readonly created_at?: number
}

export function buildP2POrder(t: P2POrderTemplate): EventTemplate {
  const tags: string[][] = []

  // Mandatory
  tags.push(["d", t.idD])
  tags.push(["k", t.type])
  tags.push(["f", t.currency])
  tags.push(["s", t.status])
  tags.push(["amt", String(t.amountSats)])

  // Fiat amount (single or range)
  if (Array.isArray(t.fiatAmount)) tags.push(["fa", t.fiatAmount[0]!, t.fiatAmount[1]!])
  else tags.push(["fa", String(t.fiatAmount)])

  if (t.paymentMethods && t.paymentMethods.length > 0) tags.push(["pm", t.paymentMethods.join(", ")])
  if (t.premiumPct) tags.push(["premium", t.premiumPct])
  if (t.ratingJson) tags.push(["rating", t.ratingJson])
  if (t.sourceUrl) tags.push(["source", t.sourceUrl])
  if (t.network) tags.push(["network", t.network])
  if (t.layer) tags.push(["layer", t.layer])
  if (t.name) tags.push(["name", t.name])
  if (t.geohash) tags.push(["g", t.geohash])
  if (t.bond) tags.push(["bond", t.bond])
  if (t.expiresAt) tags.push(["expires_at", t.expiresAt])
  if (t.expiration) tags.push(["expiration", t.expiration])
  if (t.platform) tags.push(["y", t.platform])
  if (t.document) tags.push(["z", t.document])

  return {
    kind: P2POrderKind,
    content: t.content ?? "",
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signP2POrder(t: P2POrderTemplate, sk: Uint8Array): Event {
  return finalizeEvent(buildP2POrder(t), sk)
}

