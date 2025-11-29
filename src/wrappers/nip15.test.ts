/**
 * Tests for NIP-15 Nostr Marketplace
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import {
  StallKind,
  ProductKind,
  MarketUIKind,
  AuctionKind,
  BidKind,
  BidConfirmationKind,
  signStallEvent,
  signProductEvent,
  signMarketUIEvent,
  signAuctionEvent,
  signBidEvent,
  signBidConfirmationEvent,
} from "./nip15.js"

describe("NIP-15: Marketplace", () => {
  test("stall (30017) has d tag equal to id", () => {
    const sk = generateSecretKey()
    const stall = signStallEvent({
      id: "stall-abc",
      name: "My Stall",
      currency: "USD",
      shipping: [{ id: "zone-us", name: "US", cost: 10, regions: ["US"] }],
    }, sk)
    expect(stall.kind).toBe(StallKind)
    expect(verifyEvent(stall)).toBe(true)
    const d = stall.tags.find((t) => t[0] === "d")
    expect(d?.[1]).toBe("stall-abc")
  })

  test("product (30018) includes categories and d tag", () => {
    const sk = generateSecretKey()
    const product = signProductEvent({
      id: "prod-xyz",
      stall_id: "stall-abc",
      name: "Gadget",
      currency: "USD",
      price: 199.99,
      quantity: 5,
    }, sk, { categories: ["electronics", "gadgets"] })
    expect(product.kind).toBe(ProductKind)
    expect(verifyEvent(product)).toBe(true)
    const d = product.tags.find((t) => t[0] === "d")
    const ts = product.tags.filter((t) => t[0] === "t").map((t) => t[1])
    expect(d?.[1]).toBe("prod-xyz")
    expect(ts).toContain("electronics")
    expect(ts).toContain("gadgets")
  })

  test("market UI (30019) content JSON", () => {
    const sk = generateSecretKey()
    const evt = signMarketUIEvent({
      name: "Cool Market",
      about: "A curated bazaar",
      ui: { picture: "https://pic/logo.png", theme: "classic", darkMode: true },
      merchants: ["a".repeat(64), "b".repeat(64)],
    }, sk)
    expect(evt.kind).toBe(MarketUIKind)
    expect(verifyEvent(evt)).toBe(true)
    expect(() => JSON.parse(evt.content)).not.toThrow()
  })

  test("auction (30020) and bid (1021) + bid confirmation (1022)", () => {
    const skMerchant = generateSecretKey()
    const skBidder = generateSecretKey()

    const auction = signAuctionEvent({
      id: "auc-1",
      stall_id: "stall-abc",
      name: "Rare Artifact",
      starting_bid: 10000,
      duration: 3600,
    }, skMerchant, { categories: ["collectibles"] })

    expect(auction.kind).toBe(AuctionKind)
    const d = auction.tags.find((t) => t[0] === "d")
    expect(d?.[1]).toBe("auc-1")

    const bid = signBidEvent({ auctionEventId: auction.id, amount: 15000 }, skBidder)
    expect(bid.kind).toBe(BidKind)
    expect(bid.content).toBe("15000")
    const e = bid.tags.find((t) => t[0] === "e")
    expect(e?.[1]).toBe(auction.id)

    const confirm = signBidConfirmationEvent({
      bidEventId: bid.id,
      auctionEventId: auction.id,
      content: { status: "accepted", duration_extended: 120 },
    }, skMerchant)

    expect(confirm.kind).toBe(BidConfirmationKind)
    const es = confirm.tags.filter((t) => t[0] === "e").map((t) => t[1])
    expect(es).toContain(bid.id)
    expect(es).toContain(auction.id)
    const parsed = JSON.parse(confirm.content)
    expect(parsed.status).toBe("accepted")
    expect(parsed.duration_extended).toBe(120)

    expect(verifyEvent(auction)).toBe(true)
    expect(verifyEvent(bid)).toBe(true)
    expect(verifyEvent(confirm)).toBe(true)
  })
})

