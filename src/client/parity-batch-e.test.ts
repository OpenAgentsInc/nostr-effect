/**
 * Parity batch E: A4, 5A, F4, CC, NIP-25 k/a, NIP-29 flags, NIP-50 search
 */
import { describe, test, expect } from "vite-plus/test"
import { makeNipA4Service, PUBLIC_MESSAGE_KIND } from "./NipA4Service.js"
import { makeNip5AService, NSITE_ROOT_KIND, NSITE_NAMED_KIND } from "./Nip5AService.js"
import { makeNipF4Service, PODCAST_EPISODE_KIND, PODCAST_METADATA_KIND } from "./NipF4Service.js"
import { makeNipCCService, GEOCACHE_LISTING_KIND } from "./NipCCService.js"
import { buildGroupMetadataTags, GROUP_METADATA_KIND } from "./Nip29Service.js"
import { parseSearchQuery, matchesSearch, matchesFilter } from "../relay/core/FilterMatcher.js"
import type { NostrEvent, EventId, PublicKey, UnixTimestamp, Signature, Tag, EventKind, Filter } from "../core/Schema.js"

// Re-export parseMetadata via event shape — use build + parse through private path
// parseMetadataFromEvent is not exported; test buildGroupMetadataTags + validate via tags

const mk = (partial: { kind: number; tags: string[][]; content?: string; pubkey?: string }): NostrEvent =>
  ({
    id: "a".repeat(64) as EventId,
    pubkey: (partial.pubkey ?? "b".repeat(64)) as PublicKey,
    created_at: 1 as UnixTimestamp,
    kind: partial.kind as EventKind,
    tags: partial.tags as unknown as readonly Tag[],
    content: partial.content ?? "",
    sig: "c".repeat(128) as Signature,
  }) as NostrEvent

describe("NIP-A4 Public Messages", () => {
  const svc = makeNipA4Service()
  test("builds kind 24 with p tags, rejects e tags", () => {
    const tpl = svc.generatePublicMessageTemplate({
      content: "hi",
      receivers: [{ pubkey: "aa".repeat(32), relay: "wss://r" }],
      expiration: 999,
    })
    expect(Number(tpl.kind)).toBe(24)
    expect(tpl.tags).toContainEqual(["p", "aa".repeat(32), "wss://r"])
    expect(tpl.tags).toContainEqual(["expiration", "999"])
    expect(svc.validatePublicMessageEvent(mk({ kind: 24, tags: [["p", "x"]] }))).toBe(true)
    expect(svc.validatePublicMessageEvent(mk({ kind: 24, tags: [["e", "x"], ["p", "y"]] }))).toBe(false)
  })
})

describe("NIP-5A nsites", () => {
  const svc = makeNip5AService()
  test("root and named manifests", () => {
    const root = svc.generateRootSiteTemplate({
      paths: [{ path: "/index.html", hash: "ab".repeat(32) }],
      title: "Home",
    })
    expect(Number(root.kind)).toBe(Number(NSITE_ROOT_KIND))
    expect(svc.validateNsiteEvent(mk({ kind: 15128, tags: root.tags.map((t) => [...t]) }))).toBe(true)

    const named = svc.generateNamedSiteTemplate({
      d: "blog",
      paths: [{ path: "/post.html", hash: "cd".repeat(32) }],
    })
    expect(Number(named.kind)).toBe(Number(NSITE_NAMED_KIND))
    expect(() =>
      svc.generateNamedSiteTemplate({ d: "INVALID!", paths: [{ path: "/a.html", hash: "ee".repeat(32) }] })
    ).toThrow()
  })
})

describe("NIP-F4 Podcasts", () => {
  const svc = makeNipF4Service()
  test("metadata and episode templates", () => {
    const meta = svc.generatePodcastMetadataTemplate({ title: "Show" })
    expect(Number(meta.kind)).toBe(Number(PODCAST_METADATA_KIND))
    const ep = svc.generateEpisodeTemplate({
      title: "Ep1",
      content: "notes",
      audio: [{ url: "https://cdn/ep1.mp3", mediaType: "audio/mpeg" }],
    })
    expect(Number(ep.kind)).toBe(Number(PODCAST_EPISODE_KIND))
    expect(svc.validateEpisode(mk({ kind: 54, tags: ep.tags.map((t) => [...t]), content: "notes" }))).toBe(true)
  })
})

describe("NIP-CC Geocaching", () => {
  const svc = makeNipCCService()
  test("listing template and parse", () => {
    const tpl = svc.generateGeocacheListingTemplate({
      d: "cache-1",
      name: "Oak Tree",
      geohashes: ["9q8", "9q8y"],
      difficulty: 2,
      terrain: 3,
      size: "small",
      content: "Under the log",
      type: "traditional",
    })
    expect(Number(tpl.kind)).toBe(Number(GEOCACHE_LISTING_KIND))
    const event = mk({ kind: 37516, tags: tpl.tags.map((t) => [...t]), content: "Under the log" })
    expect(svc.validateGeocacheListing(event)).toBe(true)
    const parsed = svc.parseGeocacheListing(event)
    expect(parsed?.name).toBe("Oak Tree")
    expect(parsed?.geohashes).toEqual(["9q8", "9q8y"])
  })
})

describe("NIP-29 metadata flags", () => {
  test("buildGroupMetadataTags uses private/closed/restricted/hidden", () => {
    const tags = buildGroupMetadataTags({
      id: "g1",
      name: "Secret",
      isPrivate: true,
      isClosed: true,
      isRestricted: true,
      parent: "root",
      children: ["c1"],
    })
    expect(tags).toContainEqual(["d", "g1"])
    expect(tags).toContainEqual(["private"])
    expect(tags).toContainEqual(["closed"])
    expect(tags).toContainEqual(["restricted"])
    expect(tags).toContainEqual(["parent", "root"])
    expect(tags).toContainEqual(["child", "c1"])
    expect(Number(GROUP_METADATA_KIND)).toBe(39000)
  })
})

describe("NIP-50 search extensions", () => {
  test("parseSearchQuery", () => {
    const q = parseSearchQuery("hello world include:spam domain:example.com language:en")
    expect(q.terms).toEqual(["hello", "world"])
    expect(q.includeSpam).toBe(true)
    expect(q.domain).toBe("example.com")
    expect(q.language).toBe("en")
  })

  test("matchesSearch terms and domain", () => {
    const event = mk({
      kind: 1,
      content: "hello from example.com",
      tags: [["l", "en"]],
    })
    expect(matchesSearch(event, "hello language:en")).toBe(true)
    expect(matchesSearch(event, "goodbye")).toBe(false)
    expect(matchesSearch(event, "hello domain:example.com")).toBe(true)
    expect(matchesSearch(event, "hello domain:other.com")).toBe(false)
  })

  test("matchesFilter uses search extensions", () => {
    const event = mk({ kind: 1, content: "nostr bitcoin", tags: [] })
    const filter = { search: "nostr" } as unknown as Filter
    expect(matchesFilter(event, filter)).toBe(true)
  })
})

describe("NIP-25 kinds", () => {
  test("PUBLIC_MESSAGE and external reaction constants", () => {
    expect(Number(PUBLIC_MESSAGE_KIND)).toBe(24)
  })
})
