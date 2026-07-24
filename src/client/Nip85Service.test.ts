/**
 * NIP-85: Trusted Assertions tests
 */
import { describe, test, expect } from "vite-plus/test"
import {
  makeNip85Service,
  ASSERTION_USER_KIND,
  ASSERTION_EVENT_KIND,
  ASSERTION_ADDRESS_KIND,
  ASSERTION_EXTERNAL_KIND,
  TRUSTED_PROVIDERS_KIND,
} from "./Nip85Service.js"
import type { NostrEvent, EventKind, EventId, PublicKey, UnixTimestamp, Signature, Tag } from "../core/Schema.js"

const createTestEvent = (kind: EventKind, tags: string[][], content = ""): NostrEvent => ({
  id: "a".repeat(64) as EventId,
  pubkey: "b".repeat(64) as PublicKey,
  created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
  kind,
  tags: tags as unknown as readonly Tag[],
  content,
  sig: "c".repeat(128) as Signature,
})

describe("NIP-85: Trusted Assertions", () => {
  const service = makeNip85Service()

  test("kinds match NIP-85", () => {
    expect(Number(ASSERTION_USER_KIND)).toBe(30382)
    expect(Number(ASSERTION_EVENT_KIND)).toBe(30383)
    expect(Number(ASSERTION_ADDRESS_KIND)).toBe(30384)
    expect(Number(ASSERTION_EXTERNAL_KIND)).toBe(30385)
    expect(Number(TRUSTED_PROVIDERS_KIND)).toBe(10040)
  })

  test("generateUserAssertionTemplate builds d + rank + p", () => {
    const pk = "e88a691e98d9987c964521dff60025f60700378a4879180dcbbb4a5027850411"
    const tpl = service.generateUserAssertionTemplate(pk, { rank: "89", followers: "42" })
    expect(Number(tpl.kind)).toBe(30382)
    expect(tpl.tags).toContainEqual(["d", pk])
    expect(tpl.tags).toContainEqual(["rank", "89"])
    expect(tpl.tags).toContainEqual(["followers", "42"])
    expect(tpl.tags).toContainEqual(["p", pk])
    expect(tpl.content).toBe("")
  })

  test("generateEventAssertionTemplate uses event id as d", () => {
    const id = "a".repeat(64)
    const tpl = service.generateEventAssertionTemplate(id, { rank: "10", zap_cnt: "3" })
    expect(Number(tpl.kind)).toBe(30383)
    expect(tpl.tags).toContainEqual(["d", id])
    expect(tpl.tags).toContainEqual(["e", id])
    expect(tpl.tags).toContainEqual(["rank", "10"])
  })

  test("generateAddressAssertionTemplate", () => {
    const addr = "30023:pubkey:article"
    const tpl = service.generateAddressAssertionTemplate(addr, { comment_cnt: "5" })
    expect(Number(tpl.kind)).toBe(30384)
    expect(tpl.tags).toContainEqual(["d", addr])
    expect(tpl.tags).toContainEqual(["a", addr])
  })

  test("generateExternalAssertionTemplate includes k tags", () => {
    const tpl = service.generateExternalAssertionTemplate("isbn:978", { rank: "50" }, ["isbn"])
    expect(Number(tpl.kind)).toBe(30385)
    expect(tpl.tags).toContainEqual(["d", "isbn:978"])
    expect(tpl.tags).toContainEqual(["k", "isbn"])
    expect(tpl.tags).toContainEqual(["rank", "50"])
  })

  test("parseAssertionMetrics skips structural tags", () => {
    const event = createTestEvent(ASSERTION_USER_KIND, [
      ["d", "pk"],
      ["p", "pk"],
      ["rank", "89"],
      ["t", "nostr"],
    ])
    const metrics = service.parseAssertionMetrics(event)
    expect(metrics).toEqual({ rank: "89", t: "nostr" })
  })

  test("validateAssertionEvent", () => {
    expect(
      service.validateAssertionEvent(createTestEvent(ASSERTION_USER_KIND, [["d", "pk"], ["rank", "1"]]))
    ).toBe(true)
    expect(service.validateAssertionEvent(createTestEvent(ASSERTION_USER_KIND, []))).toBe(false)
    expect(service.validateAssertionEvent(createTestEvent(1 as EventKind, [["d", "x"]]))).toBe(false)
  })

  test("provider preferences template and parse", () => {
    const prefs = [
      {
        kindTag: "30382:rank",
        serviceKey: "4fd5e210530e4f6b2cb083795834bfe5108324f1ed9f00ab73b9e8fcfe5f12fe",
        relay: "wss://nip85.nostr.band",
      },
      {
        kindTag: "30382:zap_amt_sent",
        serviceKey: "4fd5e210530e4f6b2cb083795834bfe5108324f1ed9f00ab73b9e8fcfe5f12fe",
        relay: "wss://nip85.nostr.band",
      },
    ]
    const tpl = service.generateProviderPreferencesTemplate({ preferences: prefs })
    expect(Number(tpl.kind)).toBe(10040)
    expect(tpl.tags).toEqual([
      [
        "30382:rank",
        "4fd5e210530e4f6b2cb083795834bfe5108324f1ed9f00ab73b9e8fcfe5f12fe",
        "wss://nip85.nostr.band",
      ],
      [
        "30382:zap_amt_sent",
        "4fd5e210530e4f6b2cb083795834bfe5108324f1ed9f00ab73b9e8fcfe5f12fe",
        "wss://nip85.nostr.band",
      ],
    ])

    const event = createTestEvent(TRUSTED_PROVIDERS_KIND, tpl.tags.map((t) => [...t]))
    expect(service.validateProviderPreferencesEvent(event)).toBe(true)
    expect(service.parseProviderPreferences(event)).toEqual(prefs)
  })

  test("provider preferences can carry encrypted content placeholder", () => {
    const tpl = service.generateProviderPreferencesTemplate({
      preferences: [],
      encryptedContent: "nip44ciphertext",
    })
    expect(tpl.content).toBe("nip44ciphertext")
  })
})
