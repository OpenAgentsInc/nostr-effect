/**
 * NIP-54: Wiki
 *
 * Normalize wiki article identifiers for consistent linking.
 *
 * @example
 * ```typescript
 * import { normalizeIdentifier } from 'nostr-effect/nip54'
 *
 * // Normalize a wiki article name
 * const id = normalizeIdentifier('Hello World!')
 * // => 'hello-world-'
 * ```
 */

// Re-export all from core implementation
export { normalizeIdentifier } from "../core/Nip54.js"
