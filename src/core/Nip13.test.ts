/**
 * NIP-13: Proof of Work Tests
 * Tests ported from nostr-tools for 100% parity
 */
import { describe, test, expect } from "bun:test"
import { getPow, minePow } from "./Nip13.js"
import type { PublicKey, UnixTimestamp, EventKind } from "./Schema.js"

describe("NIP-13: Proof of Work", () => {
  test("identifies proof-of-work difficulty", () => {
    const testCases: [string, number][] = [
      ["000006d8c378af1779d2feebc7603a125d99eca0ccf1085959b307f64e5dd358", 21],
      ["6bf5b4f434813c64b523d2b0e6efe18f3bd0cbbd0a5effd8ece9e00fd2531996", 1],
      ["00003479309ecdb46b1c04ce129d2709378518588bed6776e60474ebde3159ae", 18],
      ["01a76167d41add96be4959d9e618b7a35f26551d62c43c11e5e64094c6b53c83", 7],
      ["ac4f44bae06a45ebe88cfbd3c66358750159650a26c0d79e8ccaa92457fca4f6", 0],
      ["0000000000000000006cfbd3c66358750159650a26c0d79e8ccaa92457fca4f6", 73],
    ]

    for (const [id, expectedDiff] of testCases) {
      expect(getPow(id)).toEqual(expectedDiff)
    }
  })

  test("mines POW for an event", () => {
    const difficulty = 10

    const event = minePow(
      {
        kind: 1 as EventKind,
        tags: [],
        content: "Hello, world!",
        created_at: 0 as UnixTimestamp,
        pubkey: "79c2cae114ea28a981e7559b4fe7854a473521a8d22a66bbab9fa248eb820ff6" as PublicKey,
      },
      difficulty
    )

    expect(getPow(event.id)).toBeGreaterThanOrEqual(difficulty)
  })

  test("includes nonce tag with difficulty", () => {
    const difficulty = 8

    const event = minePow(
      {
        kind: 1 as EventKind,
        tags: [],
        content: "Test",
        created_at: 0 as UnixTimestamp,
        pubkey: "79c2cae114ea28a981e7559b4fe7854a473521a8d22a66bbab9fa248eb820ff6" as PublicKey,
      },
      difficulty
    )

    const nonceTag = event.tags.find((t) => t[0] === "nonce")
    expect(nonceTag).toBeDefined()
    expect(nonceTag![2]).toBe(difficulty.toString())
  })
})
