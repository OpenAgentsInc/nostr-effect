/**
 * NIP-A4: Public Messages
 * Kind 24 plaintext public messages to one or more receivers via `p` tags.
 * @see https://github.com/nostr-protocol/nips/blob/master/A4.md
 */
import { Effect, Context } from "effect"
import type { EventKind, UnixTimestamp, NostrEvent } from "../core/Schema.js"

export const PUBLIC_MESSAGE_KIND = 24 as EventKind

export interface PublicMessageReceiver {
  readonly pubkey: string
  readonly relay?: string
}

export interface PublicMessageParams {
  readonly content: string
  readonly receivers: readonly PublicMessageReceiver[]
  /** NIP-40 expiration (unix seconds) */
  readonly expiration?: number
  /** NIP-18 quote tags */
  readonly quotes?: readonly {
    readonly idOrAddress: string
    readonly relay?: string
    readonly pubkey?: string
  }[]
  readonly extraTags?: readonly (readonly string[])[]
}

export interface NipA4EventTemplate {
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly created_at: UnixTimestamp
}

export interface NipA4Service {
  readonly generatePublicMessageTemplate: (params: PublicMessageParams) => NipA4EventTemplate
  readonly validatePublicMessageEvent: (event: NostrEvent) => boolean
  readonly parseReceivers: (event: NostrEvent) => readonly PublicMessageReceiver[]
}

export const NipA4Service = Context.Service<NipA4Service>("NipA4Service")

export const makeNipA4Service = (): NipA4Service => {
  const generatePublicMessageTemplate: NipA4Service["generatePublicMessageTemplate"] = ({
    content,
    receivers,
    expiration,
    quotes,
    extraTags,
  }) => {
    const tags: string[][] = []
    for (const r of receivers) {
      tags.push(r.relay ? ["p", r.pubkey, r.relay] : ["p", r.pubkey])
    }
    if (expiration !== undefined) tags.push(["expiration", String(expiration)])
    if (quotes) {
      for (const q of quotes) {
        const t = ["q", q.idOrAddress]
        if (q.relay) t.push(q.relay)
        if (q.pubkey) t.push(q.pubkey)
        tags.push(t)
      }
    }
    if (extraTags) {
      for (const t of extraTags) tags.push([...t])
    }
    return {
      kind: PUBLIC_MESSAGE_KIND,
      tags: tags as readonly (readonly string[])[],
      content,
      created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    }
  }

  const validatePublicMessageEvent: NipA4Service["validatePublicMessageEvent"] = (event) => {
    if (Number(event.kind) !== Number(PUBLIC_MESSAGE_KIND)) return false
    // e tags must not be used
    if (event.tags.some((t) => t[0] === "e")) return false
    return event.tags.some((t) => t[0] === "p" && typeof t[1] === "string" && t[1].length > 0)
  }

  const parseReceivers: NipA4Service["parseReceivers"] = (event) =>
    event.tags
      .filter((t) => t[0] === "p" && t[1])
      .map((t) => {
        const r: PublicMessageReceiver = { pubkey: t[1]! }
        if (t[2]) (r as { relay: string }).relay = t[2]
        return r
      })

  return NipA4Service.of({
    generatePublicMessageTemplate,
    validatePublicMessageEvent,
    parseReceivers,
  })
}

export const NipA4ServiceLive = Effect.succeed(makeNipA4Service())
