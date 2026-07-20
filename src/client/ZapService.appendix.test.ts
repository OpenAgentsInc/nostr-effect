/**
 * NIP-57 Appendix F/G tests
 */
import { describe, test, expect } from "bun:test"
import {
  validateZapReceipt,
  parseZapSplitTags,
  calculateZapSplits,
  getMillisatsAmountFromBolt11,
  getSatoshisAmountFromBolt11,
} from "./ZapService.js"
import type { NostrEvent, EventId, PublicKey, UnixTimestamp, Signature, Tag, EventKind } from "../core/Schema.js"

const mkEvent = (kind: number, tags: string[][], pubkey = "b".repeat(64)): NostrEvent =>
  ({
    id: "a".repeat(64) as EventId,
    pubkey: pubkey as PublicKey,
    created_at: 1 as UnixTimestamp,
    content: "",
    sig: "c".repeat(128) as Signature,
    kind: kind as EventKind,
    tags: tags as unknown as readonly Tag[],
  }) as NostrEvent

describe("NIP-57 Appendix F/G", () => {
  test("getMillisatsAmountFromBolt11 scales sats", () => {
    const bolt11 = "lnbc10n1p0xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    const sats = getSatoshisAmountFromBolt11(bolt11)
    expect(getMillisatsAmountFromBolt11(bolt11)).toBe(Math.round(sats * 1000))
  })

  test("validateZapReceipt checks pubkey and amount", () => {
    const provider = "d".repeat(64)
    const bolt11 = "lnbc10n1p0xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    const zapRequest = {
      kind: 9734,
      tags: [
        ["p", "e".repeat(64)],
        ["amount", "1000"],
        ["relays", "wss://r"],
        ["lnurl", "lnurl1xyz"],
      ],
    }
    const receipt = mkEvent(
      9735,
      [
        ["bolt11", bolt11],
        ["description", JSON.stringify(zapRequest)],
      ],
      provider
    )
    const wrongPk = validateZapReceipt(receipt, { lnurlNostrPubkey: "f".repeat(64) })
    expect(wrongPk).toBe("Zap receipt pubkey does not match LNURL nostrPubkey.")

    const result = validateZapReceipt(receipt, {
      lnurlNostrPubkey: provider,
      recipientLnurl: "lnurl1xyz",
    })
    expect(result === null || result === "Invoice amount does not match zap request amount.").toBe(true)
  })

  test("parseZapSplitTags equal weights when omitted", () => {
    const event = mkEvent(1, [
      ["zap", "aa".repeat(32), "wss://a"],
      ["zap", "bb".repeat(32), "wss://b"],
    ])
    const splits = parseZapSplitTags(event)
    expect(splits).toHaveLength(2)
    expect(splits[0]!.weight).toBe(1)
    expect(splits[1]!.weight).toBe(1)
  })

  test("parseZapSplitTags missing weight = 0 when some present", () => {
    const event = mkEvent(1, [
      ["zap", "aa".repeat(32), "wss://a", "2"],
      ["zap", "bb".repeat(32), "wss://b"],
    ])
    const splits = parseZapSplitTags(event)
    expect(splits[0]!.weight).toBe(2)
    expect(splits[1]!.weight).toBe(0)
  })

  test("calculateZapSplits allocates by weight", () => {
    const alloc = calculateZapSplits(1000, [
      { pubkey: "a", relay: "wss://a", weight: 1 },
      { pubkey: "b", relay: "wss://b", weight: 1 },
      { pubkey: "c", relay: "wss://c", weight: 2 },
    ])
    expect(alloc.map((x) => x.amountMsats)).toEqual([250, 250, 500])
    expect(alloc.reduce((s, x) => s + x.amountMsats, 0)).toBe(1000)
  })
})
