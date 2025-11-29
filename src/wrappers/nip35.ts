/**
 * NIP-35: Torrents
 * Spec: ~/code/nips/35.md
 */
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent } from "./pure.js"

export const TorrentKind = 2003
export const TorrentCommentKind = 2004

export interface TorrentFileEntry {
  readonly path: string // full path, e.g. info/example.txt
  readonly sizeBytes?: number | string
}

export interface TorrentExternalRef {
  /**
   * i-tag value, e.g. "tcat:video,movie,4k", "newznab:2045", "imdb:tt15239678",
   * "tmdb:movie:693134", "ttvdb:movie:290272"
   */
  readonly value: string
}

export interface BuildTorrentParams {
  readonly title: string
  readonly infoHash: string // V1 btih (hex) for x tag
  readonly description?: string
  readonly files?: readonly TorrentFileEntry[]
  readonly trackers?: readonly string[]
  readonly externals?: readonly TorrentExternalRef[]
  readonly hashtags?: readonly string[]
  readonly created_at?: number
}

export function buildTorrentEvent(p: BuildTorrentParams): EventTemplate {
  const tags: string[][] = [["title", p.title], ["x", p.infoHash]]
  if (p.files) {
    for (const f of p.files) {
      const arr: string[] = ["file", f.path]
      if (f.sizeBytes !== undefined) arr.push(String(f.sizeBytes))
      tags.push(arr)
    }
  }
  if (p.trackers) {
    for (const tr of p.trackers) tags.push(["tracker", tr])
  }
  if (p.externals) {
    for (const ext of p.externals) tags.push(["i", ext.value])
  }
  if (p.hashtags) {
    for (const t of p.hashtags) tags.push(["t", t])
  }
  return {
    kind: TorrentKind,
    content: p.description ?? "",
    created_at: p.created_at ?? Math.floor(Date.now() / 1000),
    tags,
  }
}

export function signTorrentEvent(p: BuildTorrentParams, sk: Uint8Array): Event {
  return finalizeEvent(buildTorrentEvent(p), sk)
}

/** Build a magnet link from a torrent event (kind 2003) */
export function magnetFromTorrent(evt: Event): string {
  const x = evt.tags.find((t) => t[0] === "x")?.[1]
  if (!x) throw new Error("missing x (info hash)")
  const title = evt.tags.find((t) => t[0] === "title")?.[1]
  const trackers = evt.tags.filter((t) => t[0] === "tracker").map((t) => t[1]!).filter(Boolean)
  const params: string[] = []
  params.push(`xt=urn:btih:${encodeURIComponent(x)}`)
  if (title) params.push(`dn=${encodeURIComponent(title)}`)
  for (const tr of trackers) params.push(`tr=${encodeURIComponent(tr)}`)
  return `magnet:?${params.join("&")}`
}

export interface BuildTorrentCommentParams {
  readonly parentId: string
  readonly parentAuthor: string
  readonly content: string
  readonly relayHint?: string
  readonly created_at?: number
}

/** Build a torrent comment (kind 2004) that follows NIP-10 reply tagging */
export function buildTorrentComment(p: BuildTorrentCommentParams): EventTemplate {
  const eTag: string[] = ["e", p.parentId]
  const pTag: string[] = ["p", p.parentAuthor]
  if (p.relayHint) {
    eTag.push(p.relayHint)
    pTag.push(p.relayHint)
  }
  return {
    kind: TorrentCommentKind,
    content: p.content,
    created_at: p.created_at ?? Math.floor(Date.now() / 1000),
    tags: [eTag, pTag],
  }
}

export function signTorrentComment(p: BuildTorrentCommentParams, sk: Uint8Array): Event {
  return finalizeEvent(buildTorrentComment(p), sk)
}

