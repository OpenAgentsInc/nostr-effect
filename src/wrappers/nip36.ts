/**
 * NIP-36: Sensitive Content / Content Warning
 */
import type { Tag, NostrEvent } from "../core/Schema.js"

/** Add or replace the content-warning tag, with optional reason */
export function withContentWarning(tags: Tag[], reason?: string): Tag[] {
  const filtered = tags.filter((t) => t[0] !== "content-warning")
  const cw: Tag = (["content-warning", ...(reason ? [reason] : [])] as unknown) as Tag
  return [...filtered, cw]
}

/** Get content-warning reason, or empty string if present but no reason, or null if not present */
export function getContentWarningReason(event: NostrEvent): string | null {
  const t = event.tags.find((x) => x[0] === "content-warning")
  if (!t) return null
  return t[1] ?? ""
}

/**
 * Optional: include labeling via NIP-32 (L/l) for content-warning namespaces
 * Returns tags with appended L/l tags where appropriate.
 */
export function withContentWarningLabels(tags: Tag[], labels: readonly string[] = []): Tag[] {
  const hasL = tags.some((t) => t[0] === "L" && t[1] === "content-warning")
  const out = [...tags]
  if (!hasL) out.push((["L", "content-warning"] as unknown) as Tag)
  for (const label of labels) {
    out.push((["l", label, "content-warning"] as unknown) as Tag)
  }
  return out
}

