/**
 * NIP-94: File Metadata
 * https://github.com/nostr-protocol/nips/blob/master/94.md
 *
 * File sharing and metadata events
 */
import type { EventKind, UnixTimestamp, NostrEvent } from "./Schema.js"

/** Kind 1063: File Metadata */
export const FILE_METADATA_KIND = 1063 as EventKind

/**
 * File metadata object
 */
export interface FileMetadataObject {
  /** A description or caption for the file */
  content: string
  /** The URL to download the file */
  url: string
  /** The MIME type of the file in lowercase */
  m: string
  /** The SHA-256 hex-encoded string of the file */
  x: string
  /** The SHA-256 hex-encoded string of the original file before transformations */
  ox: string
  /** Optional: The size of the file in bytes */
  size?: string
  /** Optional: The dimensions in pixels, format: "<width>x<height>" */
  dim?: string
  /** Optional: The URI to the magnet file */
  magnet?: string
  /** Optional: The torrent infohash */
  i?: string
  /** Optional: The blurhash string for loading preview */
  blurhash?: string
  /** Optional: URL of the thumbnail image */
  thumb?: string
  /** Optional: URL of a preview image with same dimensions */
  image?: string
  /** Optional: A text excerpt or summary */
  summary?: string
  /** Optional: Accessibility description */
  alt?: string
  /** Optional: Fallback URLs */
  fallback?: string[]
}

/** Event template for signing */
export interface EventTemplate {
  content: string
  created_at: UnixTimestamp
  kind: EventKind
  tags: string[][]
}

/**
 * Generate an event template from file metadata
 */
export function generateEventTemplate(fileMetadata: FileMetadataObject): EventTemplate {
  const eventTemplate: EventTemplate = {
    content: fileMetadata.content,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: FILE_METADATA_KIND,
    tags: [
      ["url", fileMetadata.url],
      ["m", fileMetadata.m],
      ["x", fileMetadata.x],
      ["ox", fileMetadata.ox],
    ],
  }

  if (fileMetadata.size) eventTemplate.tags.push(["size", fileMetadata.size])
  if (fileMetadata.dim) eventTemplate.tags.push(["dim", fileMetadata.dim])
  if (fileMetadata.i) eventTemplate.tags.push(["i", fileMetadata.i])
  if (fileMetadata.blurhash) eventTemplate.tags.push(["blurhash", fileMetadata.blurhash])
  if (fileMetadata.thumb) eventTemplate.tags.push(["thumb", fileMetadata.thumb])
  if (fileMetadata.image) eventTemplate.tags.push(["image", fileMetadata.image])
  if (fileMetadata.summary) eventTemplate.tags.push(["summary", fileMetadata.summary])
  if (fileMetadata.alt) eventTemplate.tags.push(["alt", fileMetadata.alt])
  if (fileMetadata.fallback) {
    fileMetadata.fallback.forEach((url) => eventTemplate.tags.push(["fallback", url]))
  }

  return eventTemplate
}

/**
 * Validate a file metadata event
 */
export function validateEvent(event: NostrEvent): boolean {
  if (event.kind !== FILE_METADATA_KIND) return false
  if (!event.content) return false

  const requiredTags = ["url", "m", "x", "ox"] as const
  for (const tag of requiredTags) {
    if (!event.tags.find(([t]) => t === tag)) return false
  }

  // Validate optional size tag
  const sizeTag = event.tags.find(([t]) => t === "size")
  if (sizeTag && isNaN(Number(sizeTag[1]))) return false

  // Validate optional dim tag
  const dimTag = event.tags.find(([t]) => t === "dim")
  if (dimTag && !dimTag[1]?.match(/^\d+x\d+$/)) return false

  return true
}

/**
 * Parse a file metadata event into an object
 */
export function parseEvent(event: NostrEvent): FileMetadataObject {
  if (!validateEvent(event)) {
    throw new Error("Invalid event")
  }

  const fileMetadata: FileMetadataObject = {
    content: event.content,
    url: "",
    m: "",
    x: "",
    ox: "",
  }

  for (const tag of event.tags) {
    const [tagName, value] = tag
    if (!value) continue

    switch (tagName) {
      case "url":
        fileMetadata.url = value
        break
      case "m":
        fileMetadata.m = value
        break
      case "x":
        fileMetadata.x = value
        break
      case "ox":
        fileMetadata.ox = value
        break
      case "size":
        fileMetadata.size = value
        break
      case "dim":
        fileMetadata.dim = value
        break
      case "magnet":
        fileMetadata.magnet = value
        break
      case "i":
        fileMetadata.i = value
        break
      case "blurhash":
        fileMetadata.blurhash = value
        break
      case "thumb":
        fileMetadata.thumb = value
        break
      case "image":
        fileMetadata.image = value
        break
      case "summary":
        fileMetadata.summary = value
        break
      case "alt":
        fileMetadata.alt = value
        break
      case "fallback":
        fileMetadata.fallback ??= []
        fileMetadata.fallback.push(value)
        break
    }
  }

  return fileMetadata
}
