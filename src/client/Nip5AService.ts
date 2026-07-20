/**
 * NIP-5A: Static Websites (nsites)
 * Root site kind 15128; named sites kind 35128 with d tag.
 * @see https://github.com/nostr-protocol/nips/blob/master/5A.md
 */
import { Effect, Context } from "effect"
import type { EventKind, UnixTimestamp, NostrEvent } from "../core/Schema.js"

export const NSITE_ROOT_KIND = 15128 as EventKind
export const NSITE_NAMED_KIND = 35128 as EventKind

/** Canonical named-site d-tag pattern */
export const NSITE_D_PATTERN = /^[a-z0-9-]{1,13}$/

export interface NsitePath {
  /** Absolute path ending with filename.ext */
  readonly path: string
  /** sha256 hex of file content */
  readonly hash: string
}

export interface NsiteManifestParams {
  readonly paths: readonly NsitePath[]
  /** Named site id (kind 35128 only); 1–13 chars [a-z0-9-] */
  readonly d?: string
  readonly aggregateHash?: string
  readonly servers?: readonly string[]
  readonly title?: string
  readonly description?: string
  readonly source?: string
  readonly parentAddress?: string
  readonly originAddress?: string
}

export interface NsiteEventTemplate {
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly created_at: UnixTimestamp
}

export interface Nip5AService {
  readonly generateRootSiteTemplate: (params: Omit<NsiteManifestParams, "d">) => NsiteEventTemplate
  readonly generateNamedSiteTemplate: (params: NsiteManifestParams & { readonly d: string }) => NsiteEventTemplate
  readonly validateNsiteEvent: (event: NostrEvent) => boolean
  readonly parsePaths: (event: NostrEvent) => readonly NsitePath[]
}

export const Nip5AService = Context.Service<Nip5AService>("Nip5AService")

const buildTags = (params: NsiteManifestParams, named: boolean): string[][] => {
  const tags: string[][] = []
  if (named && params.d) tags.push(["d", params.d])
  for (const p of params.paths) {
    tags.push(["path", p.path, p.hash])
  }
  if (params.aggregateHash) tags.push(["x", params.aggregateHash, "aggregate"])
  if (params.servers) {
    for (const s of params.servers) tags.push(["server", s])
  }
  if (params.title) tags.push(["title", params.title])
  if (params.description) tags.push(["description", params.description])
  if (params.source) tags.push(["source", params.source])
  if (params.parentAddress) tags.push(["a", params.parentAddress])
  if (params.originAddress) tags.push(["A", params.originAddress])
  return tags
}

export const makeNip5AService = (): Nip5AService => {
  const generateRootSiteTemplate: Nip5AService["generateRootSiteTemplate"] = (params) => ({
    kind: NSITE_ROOT_KIND,
    tags: buildTags(params, false) as readonly (readonly string[])[],
    content: "",
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
  })

  const generateNamedSiteTemplate: Nip5AService["generateNamedSiteTemplate"] = (params) => {
    if (!NSITE_D_PATTERN.test(params.d) || params.d.endsWith("-")) {
      throw new Error(
        `Invalid nsite d tag "${params.d}": must match ^[a-z0-9-]{1,13}$ and not end with -`
      )
    }
    return {
      kind: NSITE_NAMED_KIND,
      tags: buildTags(params, true) as readonly (readonly string[])[],
      content: "",
      created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    }
  }

  const validateNsiteEvent: Nip5AService["validateNsiteEvent"] = (event) => {
    const k = Number(event.kind)
    if (k !== Number(NSITE_ROOT_KIND) && k !== Number(NSITE_NAMED_KIND)) return false
    const paths = event.tags.filter((t) => t[0] === "path" && t[1] && t[2])
    if (paths.length === 0) return false
    if (k === Number(NSITE_NAMED_KIND)) {
      const d = event.tags.find((t) => t[0] === "d")?.[1]
      if (!d || !NSITE_D_PATTERN.test(d) || d.endsWith("-")) return false
    }
    if (k === Number(NSITE_ROOT_KIND) && event.tags.some((t) => t[0] === "d")) return false
    return true
  }

  const parsePaths: Nip5AService["parsePaths"] = (event) =>
    event.tags
      .filter((t) => t[0] === "path" && t[1] && t[2])
      .map((t) => ({ path: t[1]!, hash: t[2]! }))

  return Nip5AService.of({
    generateRootSiteTemplate,
    generateNamedSiteTemplate,
    validateNsiteEvent,
    parsePaths,
  })
}

export const Nip5AServiceLive = Effect.succeed(makeNip5AService())
