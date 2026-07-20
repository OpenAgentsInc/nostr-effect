/**
 * NIP-85: Trusted Assertions
 * https://github.com/nostr-protocol/nips/blob/master/85.md
 *
 * Addressable assertion events (30382–30385) and provider preference list (10040).
 */
import { Effect, Context } from "effect"
import type { NostrEvent, EventKind, UnixTimestamp } from "../core/Schema.js"

/** Kind 30382: User (pubkey) assertions */
export const ASSERTION_USER_KIND = 30382 as EventKind

/** Kind 30383: Regular event assertions */
export const ASSERTION_EVENT_KIND = 30383 as EventKind

/** Kind 30384: Addressable event assertions */
export const ASSERTION_ADDRESS_KIND = 30384 as EventKind

/** Kind 30385: NIP-73 external identifier assertions */
export const ASSERTION_EXTERNAL_KIND = 30385 as EventKind

/** Kind 10040: Preferred trusted service providers */
export const TRUSTED_PROVIDERS_KIND = 10040 as EventKind

export type AssertionKind =
  | typeof ASSERTION_USER_KIND
  | typeof ASSERTION_EVENT_KIND
  | typeof ASSERTION_ADDRESS_KIND
  | typeof ASSERTION_EXTERNAL_KIND

/** Metric/result tags on assertion events (name → value) */
export type AssertionMetrics = Readonly<Record<string, string>>

export interface ProviderPreference {
  /** Combined kind:tag key, e.g. "30382:rank" */
  readonly kindTag: string
  /** Service provider pubkey */
  readonly serviceKey: string
  /** Relay hint for fetching assertions */
  readonly relay: string
}

export interface EventTemplate {
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly created_at: UnixTimestamp
}

const now = (): UnixTimestamp => Math.floor(Date.now() / 1000) as UnixTimestamp

const metricsToTags = (metrics: AssertionMetrics): string[][] => {
  const tags: string[][] = []
  for (const [name, value] of Object.entries(metrics)) {
    if (name === "d") continue
    tags.push([name, value])
  }
  return tags
}

export interface Nip85Service {
  /** Build addressable assertion event template (any of 30382–30385) */
  readonly generateAssertionEventTemplate: (params: {
    readonly kind: AssertionKind
    /** d-tag subject: pubkey | event id | address | i-tag */
    readonly d: string
    readonly metrics?: AssertionMetrics
    /** Optional NIP-73 k tags (for kind 30385) */
    readonly kTags?: readonly string[]
    /** Optional p/e/a relay-hint tags matching d */
    readonly subjectHints?: readonly (readonly string[])[]
  }) => EventTemplate

  readonly generateUserAssertionTemplate: (
    pubkey: string,
    metrics?: AssertionMetrics
  ) => EventTemplate

  readonly generateEventAssertionTemplate: (
    eventId: string,
    metrics?: AssertionMetrics
  ) => EventTemplate

  readonly generateAddressAssertionTemplate: (
    address: string,
    metrics?: AssertionMetrics
  ) => EventTemplate

  readonly generateExternalAssertionTemplate: (
    iTag: string,
    metrics?: AssertionMetrics,
    kTags?: readonly string[]
  ) => EventTemplate

  /** Parse metric tags from an assertion (excludes d and structural tags) */
  readonly parseAssertionMetrics: (event: NostrEvent) => AssertionMetrics

  /** Validate structure of an assertion event */
  readonly validateAssertionEvent: (event: NostrEvent) => boolean

  /** Kind 10040 provider preference list (public tags) */
  readonly generateProviderPreferencesTemplate: (params: {
    readonly preferences: readonly ProviderPreference[]
    /** Optional encrypted private preferences JSON already encrypted with NIP-44 */
    readonly encryptedContent?: string
  }) => EventTemplate

  readonly parseProviderPreferences: (event: NostrEvent) => readonly ProviderPreference[]

  readonly validateProviderPreferencesEvent: (event: NostrEvent) => boolean
}

export const Nip85Service = Context.Service<Nip85Service>("Nip85Service")

export const makeNip85Service = (): Nip85Service => {
  const generateAssertionEventTemplate: Nip85Service["generateAssertionEventTemplate"] = ({
    kind,
    d,
    metrics,
    kTags,
    subjectHints,
  }) => {
    const tags: string[][] = [["d", d]]
    if (metrics) tags.push(...metricsToTags(metrics))
    if (kTags) {
      for (const k of kTags) tags.push(["k", k])
    }
    if (subjectHints) {
      for (const hint of subjectHints) tags.push([...hint])
    }
    return {
      kind,
      tags: tags as readonly (readonly string[])[],
      content: "",
      created_at: now(),
    }
  }

  const generateUserAssertionTemplate: Nip85Service["generateUserAssertionTemplate"] = (
    pubkey,
    metrics
  ) =>
    generateAssertionEventTemplate({
      kind: ASSERTION_USER_KIND,
      d: pubkey,
      ...(metrics !== undefined ? { metrics } : {}),
      subjectHints: [["p", pubkey]],
    })

  const generateEventAssertionTemplate: Nip85Service["generateEventAssertionTemplate"] = (
    eventId,
    metrics
  ) =>
    generateAssertionEventTemplate({
      kind: ASSERTION_EVENT_KIND,
      d: eventId,
      ...(metrics !== undefined ? { metrics } : {}),
      subjectHints: [["e", eventId]],
    })

  const generateAddressAssertionTemplate: Nip85Service["generateAddressAssertionTemplate"] = (
    address,
    metrics
  ) =>
    generateAssertionEventTemplate({
      kind: ASSERTION_ADDRESS_KIND,
      d: address,
      ...(metrics !== undefined ? { metrics } : {}),
      subjectHints: [["a", address]],
    })

  const generateExternalAssertionTemplate: Nip85Service["generateExternalAssertionTemplate"] = (
    iTag,
    metrics,
    kTags
  ) =>
    generateAssertionEventTemplate({
      kind: ASSERTION_EXTERNAL_KIND,
      d: iTag,
      ...(metrics !== undefined ? { metrics } : {}),
      ...(kTags !== undefined ? { kTags } : {}),
    })

  const parseAssertionMetrics: Nip85Service["parseAssertionMetrics"] = (event) => {
    const skip = new Set(["d", "p", "e", "a", "k"])
    const out: Record<string, string> = {}
    for (const tag of event.tags) {
      const name = tag[0]
      const value = tag[1]
      if (!name || value === undefined || skip.has(name)) continue
      // First value wins for multi-value tags of same name (e.g. multiple `t`)
      if (out[name] === undefined) out[name] = value
    }
    return out
  }

  const validateAssertionEvent: Nip85Service["validateAssertionEvent"] = (event) => {
    const k = Number(event.kind)
    if (k < 30382 || k > 30385) return false
    return event.tags.some((t) => t[0] === "d" && typeof t[1] === "string" && t[1].length > 0)
  }

  const generateProviderPreferencesTemplate: Nip85Service["generateProviderPreferencesTemplate"] =
    ({ preferences, encryptedContent }) => {
      const tags: string[][] = preferences.map((p) => [p.kindTag, p.serviceKey, p.relay])
      return {
        kind: TRUSTED_PROVIDERS_KIND,
        tags: tags as readonly (readonly string[])[],
        content: encryptedContent ?? "",
        created_at: now(),
      }
    }

  const parseProviderPreferences: Nip85Service["parseProviderPreferences"] = (event) => {
    const prefs: ProviderPreference[] = []
    for (const tag of event.tags) {
      if (!tag[0] || !tag[1] || !tag[2]) continue
      // Preference tags look like "30382:rank"
      if (!/^\d+:[\w_]+$/.test(tag[0])) continue
      prefs.push({
        kindTag: tag[0],
        serviceKey: tag[1],
        relay: tag[2],
      })
    }
    return prefs
  }

  const validateProviderPreferencesEvent: Nip85Service["validateProviderPreferencesEvent"] = (
    event
  ) => Number(event.kind) === Number(TRUSTED_PROVIDERS_KIND)

  return Nip85Service.of({
    generateAssertionEventTemplate,
    generateUserAssertionTemplate,
    generateEventAssertionTemplate,
    generateAddressAssertionTemplate,
    generateExternalAssertionTemplate,
    parseAssertionMetrics,
    validateAssertionEvent,
    generateProviderPreferencesTemplate,
    parseProviderPreferences,
    validateProviderPreferencesEvent,
  })
}

export const Nip85ServiceLive = Effect.succeed(makeNip85Service())
