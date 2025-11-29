/**
 * NIP-92: Media Attachments (imeta tags)
 *
 * Helpers to build and parse `imeta` tags that describe media URLs present in event content.
 * Spec: ~/code/nips/92.md
 */
import type { NostrEvent } from "../core/Schema.js"

export interface ImetaInput {
  readonly url: string
  readonly mime?: string // 'm'
  readonly blurhash?: string
  readonly dim?: { width: number; height: number } // encoded as `${w}x${h}`
  readonly alt?: string
  readonly x?: string // sha256 as in NIP-94
  readonly fallback?: readonly string[]
  readonly extra?: Readonly<Record<string, string>>
}

export interface ImetaParsed {
  readonly url: string
  readonly mime: string | undefined
  readonly blurhash: string | undefined
  readonly dim: { width: number; height: number } | undefined
  readonly alt: string | undefined
  readonly x: string | undefined
  readonly fallback: readonly string[]
  readonly extras: Readonly<Record<string, string>>
}

/** Build an `imeta` tag from structured input. */
export function buildImetaTag(input: ImetaInput): string[] {
  const tag: string[] = ["imeta", `url ${input.url}`]
  if (input.mime) tag.push(`m ${input.mime}`)
  if (input.blurhash) tag.push(`blurhash ${input.blurhash}`)
  if (input.dim) tag.push(`dim ${input.dim.width}x${input.dim.height}`)
  if (input.alt) tag.push(`alt ${input.alt}`)
  if (input.x) tag.push(`x ${input.x}`)
  if (input.fallback && input.fallback.length > 0) {
    for (const f of input.fallback) tag.push(`fallback ${f}`)
  }
  if (input.extra) {
    for (const [k, v] of Object.entries(input.extra)) tag.push(`${k} ${v}`)
  }
  return tag
}

/** Parse a single `imeta` tag into structured fields. */
export function parseImetaTag(tag: readonly string[]): ImetaParsed | undefined {
  if (tag.length < 3 || tag[0] !== "imeta") return undefined
  let url = ""
  let mime: string | undefined
  let blurhash: string | undefined
  let dim: { width: number; height: number } | undefined
  let alt: string | undefined
  let x: string | undefined
  const fallback: string[] = []
  const extras: Record<string, string> = {}

  for (let i = 1; i < tag.length; i++) {
    const entry = tag[i] ?? ""
    const idx = entry.indexOf(" ")
    if (idx <= 0) continue
    const key = entry.slice(0, idx)
    const value = entry.slice(idx + 1)
    switch (key) {
      case "url":
        url = value
        break
      case "m":
        mime = value
        break
      case "blurhash":
        blurhash = value
        break
      case "dim": {
        const [w, h] = value.split("x")
        const width = Number(w)
        const height = Number(h)
        if (!Number.isNaN(width) && !Number.isNaN(height)) dim = { width, height }
        break
      }
      case "alt":
        alt = value
        break
      case "x":
        x = value
        break
      case "fallback":
        fallback.push(value)
        break
      default:
        extras[key] = value
        break
    }
  }
  if (!url) return undefined
  return { url, mime, blurhash, dim, alt, x, fallback, extras }
}

/**
 * Given an event, return imeta tags that match URLs present in content.
 */
export function extractContentImetas(event: Pick<NostrEvent, "content" | "tags">): readonly ImetaParsed[] {
  const urls = extractUrls(event.content)
  const out: ImetaParsed[] = []
  for (const t of event.tags) {
    if (t[0] !== "imeta") continue
    const parsed = parseImetaTag(t)
    if (parsed && urls.has(parsed.url)) out.push(parsed)
  }
  return out
}

/** Very simple URL extractor for content. */
export function extractUrls(content: string): Set<string> {
  const regex = /(https?:\/\/\S+)/g
  const set = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = regex.exec(content)) !== null) {
    set.add(m[1]!)
  }
  return set
}
