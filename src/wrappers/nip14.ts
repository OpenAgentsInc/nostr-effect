/**
 * NIP-14: Subject tag in Text events (kind 1)
 */
import type { Tag, NostrEvent } from "../core/Schema.js"

/** Add or replace the `subject` tag */
export function withSubject(tags: Tag[], subject: string): Tag[] {
  const filtered = tags.filter((t) => t[0] !== "subject")
  return [...filtered, ["subject", subject] as unknown as Tag]
}

/** Get the `subject` tag value */
export function getSubject(event: NostrEvent): string | null {
  const t = event.tags.find((x) => x[0] === "subject")
  return t?.[1] ?? null
}

/** For replies, replicate subject with optional adornment (e.g., prefix 'Re: ') */
export function replySubject(originalSubject: string | null, adornment = "Re: "): string | null {
  if (!originalSubject || originalSubject.length === 0) return null
  if (originalSubject.startsWith(adornment)) return originalSubject
  return `${adornment}${originalSubject}`
}

