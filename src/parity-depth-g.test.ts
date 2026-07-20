/**
 * Depth batch G: LiveKit JWT, Blossom BUD-03, OpenAgents builders
 */
import { describe, test, expect } from "bun:test"
import { mintLivekitJwt } from "./relay/backends/bun/BunServer.js"
import {
  BLOSSOM_USER_SERVER_LIST_KIND,
  buildUserServerListTags,
  parseUserServerList,
  createUserServerListTemplate,
} from "./client/BlossomService.js"
import {
  generateSaTickRequestTemplate,
  generateAcSpendAuthorizationTemplate,
  generateTrnWindowTemplate,
  SA_TICK_REQUEST_KIND,
  AC_SPEND_AUTHORIZATION_KIND,
  TRN_WINDOW_KIND,
} from "./core/OpenAgentsDrafts.js"
import { livekitTokenEndpoint, livekitCapabilityEndpoint } from "./client/Nip29Service.js"

describe("NIP-29 LiveKit JWT mint", () => {
  test("sub starts with lowercase hex pubkey", () => {
    const pubkey = "ab".repeat(32)
    const token = mintLivekitJwt({
      pubkey,
      groupId: "general",
      secret: "test-secret",
    })
    const parts = token.split(".")
    expect(parts).toHaveLength(3)
    const payloadJson = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))
    const payload = JSON.parse(payloadJson) as { sub: string; video: { room: string } }
    expect(payload.sub.startsWith(pubkey.toLowerCase())).toBe(true)
    expect(payload.sub.slice(0, 64)).toBe(pubkey.toLowerCase())
    expect(payload.video.room).toBe("general")
  })

  test("client endpoint helpers match well-known paths", () => {
    expect(livekitCapabilityEndpoint("https://r.example")).toContain("/.well-known/nip29/livekit")
    expect(livekitTokenEndpoint("https://r.example", "g1")).toContain(
      "/.well-known/nip29/livekit/g1"
    )
  })
})

describe("Blossom BUD-03 User Server List", () => {
  test("build and parse kind 10063", () => {
    expect(Number(BLOSSOM_USER_SERVER_LIST_KIND)).toBe(10063)
    const tags = buildUserServerListTags([
      "https://cdn.example/",
      "https://blossom.example.com",
    ])
    expect(tags).toEqual([
      ["server", "https://cdn.example"],
      ["server", "https://blossom.example.com"],
    ])
    const tpl = createUserServerListTemplate(["https://a.example"])
    expect(Number(tpl.kind)).toBe(10063)
    const servers = parseUserServerList({
      kind: 10063,
      tags: tpl.tags,
    })
    expect(servers).toEqual(["https://a.example"])
  })
})

describe("OpenAgents draft deeper builders", () => {
  test("SA tick request with envelope budget", () => {
    const tpl = generateSaTickRequestTemplate({
      agentPubkey: "aa".repeat(32),
      budgetSats: 50,
      spendRail: "envelope",
      envelopeId: "env-1",
      guardian: "bb".repeat(32),
      approvalThreshold: 100,
    })
    expect(Number(tpl.kind)).toBe(Number(SA_TICK_REQUEST_KIND))
    expect(tpl.tags).toContainEqual(["budget", "50", "envelope", "env-1"])
    expect(tpl.tags).toContainEqual(["guardian", "bb".repeat(32)])
  })

  test("AC spend authorization", () => {
    const tpl = generateAcSpendAuthorizationTemplate({
      envelopeId: "env-1",
      amountSats: 10,
      providerPubkey: "cc".repeat(32),
    })
    expect(Number(tpl.kind)).toBe(Number(AC_SPEND_AUTHORIZATION_KIND))
    expect(tpl.tags).toContainEqual(["envelope", "env-1"])
    expect(tpl.tags).toContainEqual(["amount", "10"])
  })

  test("TRN window", () => {
    const tpl = generateTrnWindowTemplate({ d: "w1", networkId: "net", round: 3 })
    expect(Number(tpl.kind)).toBe(Number(TRN_WINDOW_KIND))
    expect(tpl.tags).toContainEqual(["network", "net"])
    expect(tpl.tags).toContainEqual(["round", "3"])
  })
})
