/**
 * NIP-24: Extra metadata fields and tags
 *
 * Helpers for kind 0 metadata JSON (extra fields) and common tags.
 * Spec: ~/code/nips/24.md
 */

// =============================================================================
// Metadata (kind 0) helpers
// =============================================================================

export interface ProfileMetadata {
  readonly name?: string
  readonly about?: string
  readonly picture?: string
  // NIP-24 extras
  readonly display_name?: string
  readonly website?: string
  readonly banner?: string
  readonly bot?: boolean
  readonly birthday?: Partial<{ year: number; month: number; day: number }>
  // Allow arbitrary extra fields
  readonly [k: string]: unknown
}

/** Convert a metadata object to a canonical JSON string (stable-ish order). */
export function stringifyMetadata(meta: ProfileMetadata): string {
  // Normalize deprecated fields if present
  const normalized = normalizeMetadata(meta)
  // Keep a predictable key order for the common fields; append the rest
  const orderedKeys = [
    "name",
    "about",
    "picture",
    "display_name",
    "website",
    "banner",
    "bot",
    "birthday",
  ]
  const out: Record<string, unknown> = {}
  for (const k of orderedKeys) if (k in normalized) out[k] = (normalized as any)[k]
  for (const k of Object.keys(normalized)) if (!(k in out)) out[k] = (normalized as any)[k]
  return JSON.stringify(out)
}

/** Normalize deprecated fields and ensure types are valid per NIP-24 guidance. */
export function normalizeMetadata(meta: Record<string, unknown>): ProfileMetadata {
  const out: Record<string, unknown> = { ...meta }
  // Deprecated: displayName -> display_name
  if (typeof out.displayName === "string" && !out.display_name) {
    out.display_name = out.displayName
  }
  delete (out as any).displayName
  // Deprecated: username -> name
  if (typeof out.username === "string" && !out.name) {
    out.name = out.username
  }
  delete (out as any).username
  // Ensure birthday partial object stays within expected keys
  if (out.birthday && typeof out.birthday === "object") {
    const src = out.birthday as any
    const b: any = {}
    if (typeof src.year === "number") b.year = src.year
    if (typeof src.month === "number") b.month = src.month
    if (typeof src.day === "number") b.day = src.day
    out.birthday = b
  }
  // bot must be boolean if present
  if (out.bot != null) out.bot = Boolean(out.bot)
  return out as ProfileMetadata
}

// =============================================================================
// Tag helpers (generic, used across kinds)
// =============================================================================

/** Add or replace a single URL reference tag (r). */
export function withUrlTag(tags: string[][], url: string): string[][] {
  return [...tags, ["r", url]]
}

/** Add external id tag (i). Prefer NIP-73 when appropriate. */
export function withExternalIdTag(tags: string[][], id: string): string[][] {
  return [...tags, ["i", id]]
}

/** Add a title tag for sets/live events/calendar/listings. */
export function withTitleTag(tags: string[][], title: string): string[][] {
  return [...tags, ["title", title]]
}

/** Add one or more hashtags (t). Enforces lowercase and deduplicates. */
export function withHashtags(tags: string[][], hashtags: readonly string[]): string[][] {
  const existing = new Set(
    tags.filter((t) => t[0] === "t").map((t) => (t[1] ?? "").toLowerCase())
  )
  const out = [...tags]
  for (const raw of hashtags) {
    const v = String(raw).toLowerCase()
    if (!existing.has(v)) {
      out.push(["t", v])
      existing.add(v)
    }
  }
  return out
}

