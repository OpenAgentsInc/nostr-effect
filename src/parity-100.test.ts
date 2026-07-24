/**
 * Final parity-100 coverage for remaining polish items
 */
import { describe, test, expect } from "vite-plus/test"
import {
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  buildDeleteEventTemplate,
  buildCreateInviteTemplate,
  buildUpdatePinListTemplate,
  buildCreateGroupTemplate,
  buildDeleteGroupTemplate,
  buildEditMetadataTemplate,
  parseGroupInviteCode,
  livekitTokenEndpoint,
  livekitCapabilityEndpoint,
  GROUP_MODERATION_ACTIONS,
  parsePinnedEvents,
  parseGroupRoles,
} from "./client/Nip29Service.js"
import { normalizeRelayInformation } from "./core/Nip11.js"
import { rankSearchResults, scoreSearchResult } from "./relay/core/FilterMatcher.js"
import { createEmojiTag, getEmojiSetAddress } from "./core/Nip30.js"
import { createQuoteTag } from "./wrappers/nip18.js"
import {
  generateSaAgentProfileTemplate,
  generateSklManifestTemplate,
  generateAcEnvelopeTemplate,
  generateTrnNetworkContractTemplate,
  OPENAGENTS_DRAFT_KINDS,
  SA_AGENT_PROFILE_KIND,
  SKL_MANIFEST_KIND,
  AC_ENVELOPE_KIND,
  TRN_NETWORK_CONTRACT_KIND,
} from "./core/OpenAgentsDrafts.js"
import type { NostrEvent, EventId, PublicKey, UnixTimestamp, Signature, Tag, EventKind } from "./core/Schema.js"
import { Nip29Module } from "./relay/core/nip/modules/Nip29Module.js"
import { DefaultModules } from "./relay/core/nip/modules/index.js"

const mk = (content: string, created_at = 100): NostrEvent =>
  ({
    id: content.padEnd(64, "0").slice(0, 64) as EventId,
    pubkey: "b".repeat(64) as PublicKey,
    created_at: created_at as UnixTimestamp,
    kind: 1 as EventKind,
    tags: [] as unknown as readonly Tag[],
    content,
    sig: "c".repeat(128) as Signature,
  }) as NostrEvent

describe("parity-100 NIP-29 moderation matrix", () => {
  test("all moderation actions defined", () => {
    expect(Object.keys(GROUP_MODERATION_ACTIONS).map(Number).sort()).toEqual([
      9000, 9001, 9002, 9005, 9007, 9008, 9009, 9010,
    ])
  })

  test("builders emit h tag and action-specific tags", () => {
    expect(buildPutUserTemplate("g", "pk", ["admin"]).kind).toBe(9000)
    expect(buildRemoveUserTemplate("g", "pk").tags).toContainEqual(["p", "pk"])
    expect(buildDeleteEventTemplate("g", "eid").tags).toContainEqual(["e", "eid"])
    expect(buildCreateInviteTemplate("g", "CODE").tags).toContainEqual(["code", "CODE"])
    expect(buildCreateGroupTemplate("g").kind).toBe(9007)
    expect(buildDeleteGroupTemplate("g").kind).toBe(9008)
    expect(buildEditMetadataTemplate("g", [["name", "X"]]).tags).toContainEqual(["name", "X"])
    const pins = buildUpdatePinListTemplate("g", [
      { type: "e", value: "e1" },
      { type: "a", value: "30023:pk:d" },
    ])
    expect(pins.kind).toBe(9010)
    expect(pins.tags.some((t) => t[0] === "e" && t[1] === "e1")).toBe(true)
    expect(pins.tags.some((t) => t[0] === "a")).toBe(true)
  })

  test("invite parse and livekit endpoints", () => {
    expect(parseGroupInviteCode("g1?invite=abc")).toEqual({ id: "g1", invite: "abc" })
    expect(livekitTokenEndpoint("https://relay.example", "g1")).toBe(
      "https://relay.example/.well-known/nip29/livekit/g1"
    )
    expect(livekitCapabilityEndpoint("https://relay.example/")).toBe(
      "https://relay.example/.well-known/nip29/livekit"
    )
  })

  test("parse pins and roles", () => {
    const pinEv = mk("x")
    ;(pinEv as any).tags = [
      ["e", "id1", "wss://r"],
      ["a", "30023:pk:d"],
    ]
    expect(parsePinnedEvents(pinEv)).toHaveLength(2)
    const roleEv = mk("y")
    ;(roleEv as any).tags = [["role", "admin", "can do things"]]
    expect(parseGroupRoles(roleEv)[0]?.role).toBe("admin")
  })

  test("Nip29Module in DefaultModules", () => {
    expect(Nip29Module.nips).toContain(29)
    expect(DefaultModules.some((m) => m.id === "nip-29")).toBe(true)
  })
})

describe("parity-100 NIP-11 normalize", () => {
  test("captures banner self terms", () => {
    const info = normalizeRelayInformation({
      name: "R",
      banner: "https://b",
      self: "aa".repeat(32),
      terms_of_service: "https://tos",
      supported_nips: [1, 11, 29],
      limitation: { auth_required: true },
    })
    expect(info.banner).toBe("https://b")
    expect(info.self).toBe("aa".repeat(32))
    expect(info.terms_of_service).toBe("https://tos")
    expect(info.limitation?.auth_required).toBe(true)
  })
})

describe("parity-100 NIP-50 ranking", () => {
  test("rankSearchResults prefers denser matches", () => {
    const events = [
      mk("hello", 1),
      mk("hello hello world hello", 2),
      mk("world only", 3),
    ]
    const ranked = rankSearchResults(events, "hello")
    expect(ranked[0]!.content).toContain("hello hello")
    expect(scoreSearchResult(events[2]!, "hello")).toBe(-1)
  })
})

describe("parity-100 NIP-18/30", () => {
  test("quote tag and emoji set address", () => {
    expect(createQuoteTag("eid", "wss://r", "pk")).toEqual(["q", "eid", "wss://r", "pk"])
    const tag = createEmojiTag("wave", "https://e/w.png", "30030:pk:default")
    expect(tag).toEqual(["emoji", "wave", "https://e/w.png", "30030:pk:default"])
    expect(getEmojiSetAddress(tag)).toBe("30030:pk:default")
  })
})

describe("parity-100 OpenAgents drafts", () => {
  test("templates and kind registry", () => {
    expect(Number(generateSaAgentProfileTemplate({ name: "Bot" }).kind)).toBe(
      Number(SA_AGENT_PROFILE_KIND)
    )
    expect(Number(generateSklManifestTemplate({ d: "s1", version: "1.0.0", name: "Skill" }).kind)).toBe(
      Number(SKL_MANIFEST_KIND)
    )
    expect(
      Number(generateAcEnvelopeTemplate({ envelopeId: "e1", maxSats: 100, status: "open" }).kind)
    ).toBe(Number(AC_ENVELOPE_KIND))
    expect(
      Number(generateTrnNetworkContractTemplate({ d: "net", name: "Train" }).kind)
    ).toBe(Number(TRN_NETWORK_CONTRACT_KIND))
    expect(OPENAGENTS_DRAFT_KINDS.SA.length).toBeGreaterThan(5)
    expect(OPENAGENTS_DRAFT_KINDS.LBR.length).toBe(3)
    expect(OPENAGENTS_DRAFT_KINDS.DS.length).toBe(2)
  })
})
