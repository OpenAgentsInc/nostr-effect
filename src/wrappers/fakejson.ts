/**
 * Fast JSON Field Extraction
 *
 * Fast extraction of fields from JSON strings without full parsing.
 * Useful for quickly filtering events by ID, pubkey, or kind.
 *
 * @example
 * ```typescript
 * import { getHex64, getInt, getSubscriptionId, matchEventId } from 'nostr-effect/fakejson'
 *
 * // Extract hex field quickly
 * const id = getHex64(jsonString, 'id')
 * const pubkey = getHex64(jsonString, 'pubkey')
 *
 * // Extract integer field
 * const kind = getInt(jsonString, 'kind')
 *
 * // Match event ID
 * if (matchEventId(jsonString, targetId)) {
 *   // This event matches
 * }
 * ```
 */

/**
 * Extract a 64-character hex string field from JSON
 */
export function getHex64(json: string, field: string): string {
  const len = field.length + 3
  const idx = json.indexOf(`"${field}":`) + len
  const s = json.slice(idx).indexOf(`"`) + idx + 1
  return json.slice(s, s + 64)
}

/**
 * Extract an integer field from JSON
 */
export function getInt(json: string, field: string): number {
  const len = field.length
  const idx = json.indexOf(`"${field}":`) + len + 3
  const sliced = json.slice(idx)
  const end = Math.min(sliced.indexOf(","), sliced.indexOf("}"))
  return parseInt(sliced.slice(0, end), 10)
}

/**
 * Extract the subscription ID from an EVENT message
 */
export function getSubscriptionId(json: string): string | null {
  const idx = json.slice(0, 22).indexOf(`"EVENT"`)
  if (idx === -1) return null

  const pstart = json.slice(idx + 7 + 1).indexOf(`"`)
  if (pstart === -1) return null
  const start = idx + 7 + 1 + pstart

  const pend = json.slice(start + 1, 80).indexOf(`"`)
  if (pend === -1) return null
  const end = start + 1 + pend

  return json.slice(start + 1, end)
}

/**
 * Check if the JSON event matches the given ID
 */
export function matchEventId(json: string, id: string): boolean {
  return id === getHex64(json, "id")
}

/**
 * Check if the JSON event matches the given pubkey
 */
export function matchEventPubkey(json: string, pubkey: string): boolean {
  return pubkey === getHex64(json, "pubkey")
}

/**
 * Check if the JSON event matches the given kind
 */
export function matchEventKind(json: string, kind: number): boolean {
  return kind === getInt(json, "kind")
}
