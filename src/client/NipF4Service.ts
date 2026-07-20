/**
 * NIP-F4: Podcasts
 * Kind 10154 podcast metadata, 10064 author claims, 54 episodes, 10054 favorites list.
 * @see https://github.com/nostr-protocol/nips/blob/master/F4.md
 */
import { Effect, Context } from "effect"
import type { EventKind, UnixTimestamp, NostrEvent } from "../core/Schema.js"

export const PODCAST_METADATA_KIND = 10154 as EventKind
/** Spec example uses 10064 for author counter-claims (text mentions 10164 once) */
export const PODCAST_AUTHOR_CLAIM_KIND = 10064 as EventKind
export const PODCAST_EPISODE_KIND = 54 as EventKind
export const PODCAST_FAVORITES_KIND = 10054 as EventKind

export interface PodcastMetadataParams {
  readonly title: string
  readonly image?: string
  readonly description?: string
  readonly websites?: readonly string[]
  readonly authors?: readonly { readonly pubkey: string; readonly role?: string }[]
}

export interface PodcastEpisodeParams {
  readonly title: string
  readonly content: string
  readonly audio: readonly { readonly url: string; readonly mediaType?: string }[]
  readonly image?: string
  readonly description?: string
}

export interface PodcastEventTemplate {
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly created_at: UnixTimestamp
}

export interface NipF4Service {
  readonly generatePodcastMetadataTemplate: (params: PodcastMetadataParams) => PodcastEventTemplate
  readonly generateAuthorClaimTemplate: (podcastPubkeys: readonly string[]) => PodcastEventTemplate
  readonly generateEpisodeTemplate: (params: PodcastEpisodeParams) => PodcastEventTemplate
  readonly generateFavoritesTemplate: (podcastPubkeys: readonly string[]) => PodcastEventTemplate
  readonly validatePodcastMetadata: (event: NostrEvent) => boolean
  readonly validateEpisode: (event: NostrEvent) => boolean
}

export const NipF4Service = Context.Service<NipF4Service>("NipF4Service")

const now = (): UnixTimestamp => Math.floor(Date.now() / 1000) as UnixTimestamp

export const makeNipF4Service = (): NipF4Service => {
  const generatePodcastMetadataTemplate: NipF4Service["generatePodcastMetadataTemplate"] = ({
    title,
    image,
    description,
    websites,
    authors,
  }) => {
    const tags: string[][] = [["title", title]]
    if (image) tags.push(["image", image])
    if (description) tags.push(["description", description])
    if (websites) for (const w of websites) tags.push(["website", w])
    if (authors) {
      for (const a of authors) {
        tags.push(a.role ? ["p", a.pubkey, a.role] : ["p", a.pubkey])
      }
    }
    return { kind: PODCAST_METADATA_KIND, tags: tags as readonly (readonly string[])[], content: "", created_at: now() }
  }

  const generateAuthorClaimTemplate: NipF4Service["generateAuthorClaimTemplate"] = (podcastPubkeys) => ({
    kind: PODCAST_AUTHOR_CLAIM_KIND,
    tags: podcastPubkeys.map((p) => ["p", p]) as readonly (readonly string[])[],
    content: "",
    created_at: now(),
  })

  const generateEpisodeTemplate: NipF4Service["generateEpisodeTemplate"] = ({
    title,
    content,
    audio,
    image,
    description,
  }) => {
    const tags: string[][] = [["title", title]]
    if (image) tags.push(["image", image])
    if (description) tags.push(["description", description])
    for (const a of audio) {
      tags.push(a.mediaType ? ["audio", a.url, a.mediaType] : ["audio", a.url])
    }
    return {
      kind: PODCAST_EPISODE_KIND,
      tags: tags as readonly (readonly string[])[],
      content,
      created_at: now(),
    }
  }

  const generateFavoritesTemplate: NipF4Service["generateFavoritesTemplate"] = (podcastPubkeys) => ({
    kind: PODCAST_FAVORITES_KIND,
    tags: podcastPubkeys.map((p) => ["p", p]) as readonly (readonly string[])[],
    content: "",
    created_at: now(),
  })

  const validatePodcastMetadata: NipF4Service["validatePodcastMetadata"] = (event) =>
    Number(event.kind) === Number(PODCAST_METADATA_KIND) &&
    event.tags.some((t) => t[0] === "title" && !!t[1])

  const validateEpisode: NipF4Service["validateEpisode"] = (event) =>
    Number(event.kind) === Number(PODCAST_EPISODE_KIND) &&
    event.tags.some((t) => t[0] === "title" && !!t[1]) &&
    event.tags.some((t) => t[0] === "audio" && !!t[1])

  return NipF4Service.of({
    generatePodcastMetadataTemplate,
    generateAuthorClaimTemplate,
    generateEpisodeTemplate,
    generateFavoritesTemplate,
    validatePodcastMetadata,
    validateEpisode,
  })
}

export const NipF4ServiceLive = Effect.succeed(makeNipF4Service())
