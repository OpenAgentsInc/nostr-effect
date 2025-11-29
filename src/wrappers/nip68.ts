/**
 * NIP-68: Picture-first feeds (kind 20)
 * Spec: ~/code/nips/68.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

export const PictureEventKind = 20

// Allowed media types per spec
export const AllowedMediaTypes = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

export interface AnnotateUser {
  readonly pubkey: string
  readonly x: number
  readonly y: number
}

export interface PictureImeta {
  readonly url: string
  readonly mime: string
  readonly blurhash?: string
  readonly dim?: string // e.g., "3024x4032"
  readonly alt?: string
  readonly sha256?: string // NIP-94 'x' value
  readonly fallbacks?: readonly string[]
  readonly annotateUsers?: readonly AnnotateUser[]
}

export interface PictureTemplate {
  readonly title: string
  readonly description?: string
  readonly images: readonly PictureImeta[]
  readonly taggedPubkeys?: readonly { pubkey: string; relay?: string }[]
  readonly contentWarning?: string
  readonly mediaTypeFilter?: string // e.g., "image/jpeg"
  readonly hashes?: readonly string[] // add 'x' tags per image hash
  readonly hashtags?: readonly string[]
  readonly location?: string
  readonly geohash?: string
  readonly languages?: readonly { l?: string; L?: string }[] // NIP-32 labels for language
  readonly created_at?: number
}

/** Build one `imeta` tag */
export function buildImetaTag(imeta: PictureImeta): string[] {
  if (!AllowedMediaTypes.has(imeta.mime)) {
    throw new Error(`Unsupported media type: ${imeta.mime}`)
  }
  const tag: string[] = [
    "imeta",
    `url ${imeta.url}`,
    `m ${imeta.mime}`,
  ]
  if (imeta.blurhash) tag.push(`blurhash ${imeta.blurhash}`)
  if (imeta.dim) tag.push(`dim ${imeta.dim}`)
  if (imeta.alt) tag.push(`alt ${imeta.alt}`)
  if (imeta.sha256) tag.push(`x ${imeta.sha256}`)
  if (imeta.fallbacks) for (const f of imeta.fallbacks) tag.push(`fallback ${f}`)
  if (imeta.annotateUsers) {
    for (const a of imeta.annotateUsers) {
      tag.push(`annotate-user ${a.pubkey}:${a.x}:${a.y}`)
    }
  }
  return tag
}

/** Build a picture event template (kind 20) */
export function buildPictureEvent(t: PictureTemplate): EventTemplate {
  const tags: string[][] = [["title", t.title]]
  for (const im of t.images) tags.push(buildImetaTag(im))
  if (t.contentWarning) tags.push(["content-warning", t.contentWarning])
  if (t.taggedPubkeys) for (const p of t.taggedPubkeys) tags.push(["p", p.pubkey, ...(p.relay ? [p.relay] : [])])
  if (t.mediaTypeFilter) tags.push(["m", t.mediaTypeFilter])
  if (t.hashes) for (const h of t.hashes) tags.push(["x", h])
  if (t.hashtags) for (const h of t.hashtags) tags.push(["t", h])
  if (t.location) tags.push(["location", t.location])
  if (t.geohash) tags.push(["g", t.geohash])
  if (t.languages) {
    for (const lang of t.languages) {
      if (lang.L) tags.push(["L", lang.L])
      if (lang.l) tags.push(["l", lang.l, lang.L ?? ""]) // include namespace if provided
    }
  }
  return {
    kind: PictureEventKind,
    content: t.description ?? "",
    created_at: t.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signPictureEvent(t: PictureTemplate, sk: Uint8Array): Event {
  return finalizeEvent(buildPictureEvent(t), sk)
}

/** Parse an `imeta` tag back into a structured object */
export function parseImetaTag(tag: string[]): PictureImeta | null {
  if (tag[0] !== "imeta") return null
  let url = ""
  let mime = ""
  let blurhash: string | undefined
  let dim: string | undefined
  let alt: string | undefined
  let sha256: string | undefined
  const fallbacks: string[] = []
  const annotateUsers: AnnotateUser[] = []

  for (let i = 1; i < tag.length; i++) {
    const part = tag[i]!
    const [key, ...rest] = part.split(" ")
    const val = rest.join(" ")
    switch (key) {
      case "url": url = val; break
      case "m": mime = val; break
      case "blurhash": blurhash = val; break
      case "dim": dim = val; break
      case "alt": alt = val; break
      case "x": sha256 = val; break
      case "fallback": fallbacks.push(val); break
      case "annotate-user": {
        const [pubkey, xs, ys] = val.split(":")
        const x = Number(xs)
        const y = Number(ys)
        if (pubkey && Number.isFinite(x) && Number.isFinite(y)) {
          annotateUsers.push({ pubkey, x, y })
        }
        break
      }
      default: break
    }
  }

  if (!url || !mime) return null
  const obj: any = { url, mime }
  if (blurhash !== undefined) obj.blurhash = blurhash
  if (dim !== undefined) obj.dim = dim
  if (alt !== undefined) obj.alt = alt
  if (sha256 !== undefined) obj.sha256 = sha256
  if (fallbacks.length > 0) obj.fallbacks = fallbacks
  if (annotateUsers.length > 0) obj.annotateUsers = annotateUsers
  return obj as PictureImeta
}
