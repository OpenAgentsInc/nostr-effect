/**
 * NIP-18: Reposts
 * https://github.com/nostr-protocol/nips/blob/master/18.md
 *
 * Reposting events (kind 6 for text notes, kind 16 for generic reposts)
 */
import { Effect, Context } from "effect"
import type {
  NostrEvent,
  EventKind,
  UnixTimestamp,
  Tag,
  PrivateKey,
} from "../core/Schema.js"
import { EventService } from "../services/EventService.js"
import { CryptoService } from "../services/CryptoService.js"
import type { EventPointer } from "../core/Nip19.js"
import { verifyEvent as verifyEventSync } from "../wrappers/pure.js"

/** Kind 6: Repost of a kind 1 text note */
export const REPOST_KIND = 6 as EventKind

/** Kind 16: Generic repost of any event kind */
export const GENERIC_REPOST_KIND = 16 as EventKind

/** Kind 1: Short text note */
const SHORT_TEXT_NOTE_KIND = 1 as EventKind

export interface RepostEventTemplate {
  readonly tags?: readonly (readonly string[])[]
  readonly content?: ""
  readonly created_at: UnixTimestamp
}

export interface Nip18Service {
  readonly createRepost: (
    template: RepostEventTemplate,
    repostedEvent: NostrEvent,
    relayUrl: string,
    privateKey: PrivateKey
  ) => Effect.Effect<NostrEvent, Error>

  readonly getRepostedEventPointer: (event: NostrEvent) => EventPointer | undefined

  readonly getRepostedEvent: (
    event: NostrEvent,
    options?: { skipVerification?: boolean }
  ) => Effect.Effect<NostrEvent | undefined, Error>
}

export const Nip18Service = Context.GenericTag<Nip18Service>("Nip18Service")

/**
 * Get pointer to the reposted event from a repost (pure function)
 * Exported for use by wrappers
 */
export function getRepostedEventPointer(event: NostrEvent): EventPointer | undefined {
  if (event.kind !== REPOST_KIND && event.kind !== GENERIC_REPOST_KIND) {
    return undefined
  }

  let lastETag: readonly string[] | undefined
  let lastPTag: readonly string[] | undefined

  for (let i = event.tags.length - 1; i >= 0 && (lastETag === undefined || lastPTag === undefined); i--) {
    const tag = event.tags[i]
    if (tag && tag.length >= 2) {
      if (tag[0] === "e" && lastETag === undefined) {
        lastETag = tag
      } else if (tag[0] === "p" && lastPTag === undefined) {
        lastPTag = tag
      }
    }
  }

  if (lastETag === undefined) {
    return undefined
  }

  const relays = [lastETag[2], lastPTag?.[2]].filter((x): x is string => typeof x === "string")

  const result: EventPointer = {
    id: lastETag[1] as string,
  }

  if (relays.length > 0) {
    ;(result as { relays?: readonly string[] }).relays = relays
  }
  if (lastPTag?.[1]) {
    ;(result as { author?: string }).author = lastPTag[1]
  }

  return result
}

/**
 * Get the reposted event from a repost event's content (sync version)
 * Uses pure verifyEvent for signature verification
 * Exported for use by wrappers
 */
export function getRepostedEvent(
  event: NostrEvent,
  { skipVerification }: { skipVerification?: boolean } = {}
): NostrEvent | undefined {
  const pointer = getRepostedEventPointer(event)

  if (pointer === undefined || event.content === "") {
    return undefined
  }

  let repostedEvent: NostrEvent

  try {
    repostedEvent = JSON.parse(event.content) as NostrEvent
  } catch {
    return undefined
  }

  if (repostedEvent.id !== pointer.id) {
    return undefined
  }

  if (!skipVerification && !verifyEventSync(repostedEvent as unknown as Parameters<typeof verifyEventSync>[0])) {
    return undefined
  }

  return repostedEvent
}

export const Nip18ServiceLiveLayer = Effect.gen(function* () {
  const eventService = yield* EventService
  const cryptoService = yield* CryptoService

  const createRepost: Nip18Service["createRepost"] = (template, repostedEvent, relayUrl, privateKey) =>
    Effect.gen(function* () {
      const kind = repostedEvent.kind === SHORT_TEXT_NOTE_KIND ? REPOST_KIND : GENERIC_REPOST_KIND

      const tags: string[][] = [...(template.tags?.map((t) => [...t]) ?? [])]
      tags.push(["e", repostedEvent.id, relayUrl])
      tags.push(["p", repostedEvent.pubkey])

      if (kind === GENERIC_REPOST_KIND) {
        tags.push(["k", String(repostedEvent.kind)])
      }

      const isProtected = repostedEvent.tags?.some((tag) => tag[0] === "-")
      const content = template.content === "" || isProtected ? "" : JSON.stringify(repostedEvent)

      const publicKey = yield* cryptoService.getPublicKey(privateKey)

      const unsigned = {
        kind,
        pubkey: publicKey,
        created_at: template.created_at,
        tags: tags as unknown as readonly Tag[],
        content,
      }

      return yield* eventService.createEvent(unsigned, privateKey)
    })

  const getRepostedEventPointerImpl: Nip18Service["getRepostedEventPointer"] = getRepostedEventPointer

  const getRepostedEventImpl: Nip18Service["getRepostedEvent"] = (event, options = {}) =>
    Effect.gen(function* () {
      const pointer = getRepostedEventPointer(event)

      if (pointer === undefined || event.content === "") {
        return undefined
      }

      let repostedEvent: NostrEvent

      try {
        repostedEvent = JSON.parse(event.content) as NostrEvent
      } catch (_e) {
        return undefined
      }

      if (repostedEvent.id !== pointer.id) {
        return undefined
      }

      if (!options.skipVerification) {
        const isValid = yield* eventService.verifyEvent(repostedEvent)
        if (!isValid) {
          return undefined
        }
      }

      return repostedEvent
    })

  return Nip18Service.of({
    createRepost,
    getRepostedEventPointer: getRepostedEventPointerImpl,
    getRepostedEvent: getRepostedEventImpl,
  })
})
