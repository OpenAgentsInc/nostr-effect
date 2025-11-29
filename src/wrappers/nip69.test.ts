/**
 * Tests for NIP-69 Peer-to-peer Order events (kind 38383)
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import { signP2POrder, P2POrderKind } from "./nip69.js"

describe("NIP-69 P2P Orders", () => {
  test("build and sign full order with rating and platform", () => {
    const sk = generateSecretKey()
    const order = signP2POrder({
      idD: "uuid-123",
      type: "sell",
      currency: "USD",
      status: "pending",
      amountSats: "0",
      fiatAmount: ["100", "200"],
      paymentMethods: ["bank transfer", "face to face"],
      premiumPct: "1",
      ratingJson: JSON.stringify({ total_reviews: 1, total_rating: 3.0, last_rating: 3, max_rate: 5, min_rate: 1 }),
      sourceUrl: "https://example.com/order/123",
      network: "mainnet",
      layer: "lightning",
      name: "Nakamoto",
      geohash: "u4pruydqqvj",
      bond: "0",
      expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
      expiration: String(Math.floor(Date.now() / 1000) + 7200),
      platform: "lnp2pbot",
      document: "order",
    }, sk)

    expect(order.kind).toBe(P2POrderKind)
    const d = order.tags.find((t) => t[0] === "d")
    const k = order.tags.find((t) => t[0] === "k")
    const f = order.tags.find((t) => t[0] === "f")
    const s = order.tags.find((t) => t[0] === "s")
    const amt = order.tags.find((t) => t[0] === "amt")
    const fa = order.tags.find((t) => t[0] === "fa")
    const pm = order.tags.find((t) => t[0] === "pm")
    const premium = order.tags.find((t) => t[0] === "premium")
    const rating = order.tags.find((t) => t[0] === "rating")
    const y = order.tags.find((t) => t[0] === "y")
    const z = order.tags.find((t) => t[0] === "z")

    expect(d?.[1]).toBe("uuid-123")
    expect(k?.[1]).toBe("sell")
    expect(f?.[1]).toBe("USD")
    expect(s?.[1]).toBe("pending")
    expect(amt?.[1]).toBe("0")
    expect(fa?.[1]).toBe("100")
    expect(fa?.[2]).toBe("200")
    expect(pm?.[1]).toContain("bank transfer")
    expect(premium?.[1]).toBe("1")
    expect(() => JSON.parse(rating?.[1] ?? "{}")).not.toThrow()
    expect(y?.[1]).toBe("lnp2pbot")
    expect(z?.[1]).toBe("order")
    expect(verifyEvent(order)).toBe(true)
  })
})
