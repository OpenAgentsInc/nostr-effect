/**
 * NIP-15: Nostr Marketplace
 * Spec: ~/code/nips/15.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

// Kinds
export const StallKind = 30017
export const ProductKind = 30018
export const MarketUIKind = 30019
export const AuctionKind = 30020
export const BidKind = 1021
export const BidConfirmationKind = 1022

// =============================================================================
// Types (content payloads per NIP-15)
// =============================================================================

export interface StallShippingZone {
  readonly id: string
  readonly name?: string
  readonly cost: number
  readonly regions: readonly string[]
}

export interface StallContent {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly currency: string
  readonly shipping: readonly StallShippingZone[]
}

export interface ProductSpecKV extends Array<string> {
  0: string
  1: string
}

export interface ProductShippingExtra {
  readonly id: string
  readonly cost: number
}

export interface ProductContent {
  readonly id: string
  readonly stall_id: string
  readonly name: string
  readonly description?: string
  readonly images?: readonly string[]
  readonly currency: string
  readonly price: number
  readonly quantity: number | null
  readonly specs?: readonly ProductSpecKV[]
  readonly shipping?: readonly ProductShippingExtra[]
}

export interface MarketUIContent {
  readonly name?: string
  readonly about?: string
  readonly ui?: {
    readonly picture?: string
    readonly banner?: string
    readonly theme?: string
    readonly darkMode?: boolean
  }
  readonly merchants?: readonly string[]
}

export interface AuctionContent {
  readonly id: string
  readonly stall_id: string
  readonly name: string
  readonly description?: string
  readonly images?: readonly string[]
  readonly starting_bid: number
  readonly start_date?: number
  readonly duration: number
  readonly specs?: readonly ProductSpecKV[]
  readonly shipping?: readonly ProductShippingExtra[]
}

export type BidStatus = "accepted" | "rejected" | "pending" | "winner"

export interface BidConfirmationContent {
  readonly status: BidStatus
  readonly message?: string
  readonly duration_extended?: number
}

// =============================================================================
// Builders
// =============================================================================

const now = () => Math.floor(Date.now() / 1000)

export function buildStallEvent(
  content: StallContent,
  options?: { created_at?: number }
): EventTemplate {
  const tags: string[][] = [["d", content.id]]
  return {
    kind: StallKind,
    content: JSON.stringify(content),
    tags,
    created_at: options?.created_at ?? now(),
  }
}

export function signStallEvent(content: StallContent, sk: Uint8Array, opts?: { created_at?: number }): Event {
  return finalizeEvent(buildStallEvent(content, opts), sk)
}

export function buildProductEvent(
  content: ProductContent,
  options?: { categories?: readonly string[]; created_at?: number }
): EventTemplate {
  const tags: string[][] = [["d", content.id]]
  if (options?.categories) for (const cat of options.categories) tags.push(["t", cat])
  return {
    kind: ProductKind,
    content: JSON.stringify(content),
    tags,
    created_at: options?.created_at ?? now(),
  }
}

export function signProductEvent(content: ProductContent, sk: Uint8Array, opts?: { categories?: readonly string[]; created_at?: number }): Event {
  return finalizeEvent(buildProductEvent(content, opts), sk)
}

export function buildMarketUIEvent(content: MarketUIContent, options?: { created_at?: number }): EventTemplate {
  return {
    kind: MarketUIKind,
    content: JSON.stringify(content),
    tags: [],
    created_at: options?.created_at ?? now(),
  }
}

export function signMarketUIEvent(content: MarketUIContent, sk: Uint8Array, opts?: { created_at?: number }): Event {
  return finalizeEvent(buildMarketUIEvent(content, opts), sk)
}

export function buildAuctionEvent(
  content: AuctionContent,
  options?: { categories?: readonly string[]; created_at?: number }
): EventTemplate {
  const tags: string[][] = [["d", content.id]]
  if (options?.categories) for (const cat of options.categories) tags.push(["t", cat])
  return {
    kind: AuctionKind,
    content: JSON.stringify(content),
    tags,
    created_at: options?.created_at ?? now(),
  }
}

export function signAuctionEvent(content: AuctionContent, sk: Uint8Array, opts?: { categories?: readonly string[]; created_at?: number }): Event {
  return finalizeEvent(buildAuctionEvent(content, opts), sk)
}

export function buildBidEvent(params: { auctionEventId: string; amount: number; created_at?: number }): EventTemplate {
  return {
    kind: BidKind,
    content: String(params.amount),
    tags: [["e", params.auctionEventId]],
    created_at: params.created_at ?? now(),
  }
}

export function signBidEvent(params: { auctionEventId: string; amount: number; created_at?: number }, sk: Uint8Array): Event {
  return finalizeEvent(buildBidEvent(params), sk)
}

export function buildBidConfirmationEvent(params: {
  bidEventId: string
  auctionEventId: string
  content: BidConfirmationContent
  created_at?: number
}): EventTemplate {
  return {
    kind: BidConfirmationKind,
    content: JSON.stringify(params.content),
    tags: [["e", params.bidEventId], ["e", params.auctionEventId]],
    created_at: params.created_at ?? now(),
  }
}

export function signBidConfirmationEvent(
  params: { bidEventId: string; auctionEventId: string; content: BidConfirmationContent; created_at?: number },
  sk: Uint8Array
): Event {
  return finalizeEvent(buildBidConfirmationEvent(params), sk)
}

