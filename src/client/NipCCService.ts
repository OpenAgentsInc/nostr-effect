/**
 * NIP-CC: Geocaching Events
 * Kind 37516 addressable geocache listings.
 * @see https://github.com/nostr-protocol/nips/blob/master/CC.md
 */
import { Effect, Context } from "effect"
import type { EventKind, UnixTimestamp, NostrEvent } from "../core/Schema.js"

export const GEOCACHE_LISTING_KIND = 37516 as EventKind

export type GeocacheSize = "micro" | "small" | "regular" | "large" | "other"

export interface GeocacheListingParams {
  readonly d: string
  readonly name: string
  /** Geohashes (include multiple precision levels 3–9 for proximity search) */
  readonly geohashes: readonly string[]
  /** Difficulty 1–5 */
  readonly difficulty: number
  /** Terrain 1–5 */
  readonly terrain: number
  readonly size: GeocacheSize
  readonly content: string
  readonly type?: string
  readonly modifiers?: readonly string[]
  readonly hint?: string
  readonly mission?: string
  readonly image?: string
  readonly relays?: readonly string[]
  readonly verificationPubkey?: string
}

export interface GeocacheEventTemplate {
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly created_at: UnixTimestamp
}

export interface NipCCService {
  readonly generateGeocacheListingTemplate: (params: GeocacheListingParams) => GeocacheEventTemplate
  readonly validateGeocacheListing: (event: NostrEvent) => boolean
  readonly parseGeocacheListing: (event: NostrEvent) => {
    readonly d: string
    readonly name: string
    readonly geohashes: readonly string[]
    readonly difficulty: number
    readonly terrain: number
    readonly size: string
    readonly type: string
  } | null
}

export const NipCCService = Context.Service<NipCCService>("NipCCService")

export const makeNipCCService = (): NipCCService => {
  const generateGeocacheListingTemplate: NipCCService["generateGeocacheListingTemplate"] = (
    params
  ) => {
    if (params.difficulty < 1 || params.difficulty > 5) {
      throw new Error("difficulty must be 1–5")
    }
    if (params.terrain < 1 || params.terrain > 5) {
      throw new Error("terrain must be 1–5")
    }
    const tags: string[][] = [
      ["d", params.d],
      ["name", params.name],
      ["D", String(params.difficulty)],
      ["T", String(params.terrain)],
      ["S", params.size],
    ]
    for (const g of params.geohashes) tags.push(["g", g])
    if (params.type) tags.push(["t", params.type])
    if (params.modifiers) for (const n of params.modifiers) tags.push(["n", n])
    if (params.hint) tags.push(["hint", params.hint])
    if (params.mission) tags.push(["mission", params.mission])
    if (params.image) tags.push(["image", params.image])
    if (params.relays) for (const r of params.relays) tags.push(["r", r])
    if (params.verificationPubkey) tags.push(["verification", params.verificationPubkey])

    return {
      kind: GEOCACHE_LISTING_KIND,
      tags: tags as readonly (readonly string[])[],
      content: params.content,
      created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    }
  }

  const validateGeocacheListing: NipCCService["validateGeocacheListing"] = (event) => {
    if (Number(event.kind) !== Number(GEOCACHE_LISTING_KIND)) return false
    const has = (n: string) => event.tags.some((t) => t[0] === n && !!t[1])
    return has("d") && has("name") && has("g") && has("D") && has("T") && has("S")
  }

  const parseGeocacheListing: NipCCService["parseGeocacheListing"] = (event) => {
    if (!validateGeocacheListing(event)) return null
    const get = (n: string) => event.tags.find((t) => t[0] === n)?.[1] ?? ""
    return {
      d: get("d"),
      name: get("name"),
      geohashes: event.tags.filter((t) => t[0] === "g" && t[1]).map((t) => t[1]!),
      difficulty: Number(get("D")),
      terrain: Number(get("T")),
      size: get("S"),
      type: get("t") || "traditional",
    }
  }

  return NipCCService.of({
    generateGeocacheListingTemplate,
    validateGeocacheListing,
    parseGeocacheListing,
  })
}

export const NipCCServiceLive = Effect.succeed(makeNipCCService())
