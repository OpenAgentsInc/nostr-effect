/**
 * NIP-10: Reply/Thread Parsing
 *
 * Parse event tags to extract thread structure including root, reply, mentions, and profiles.
 *
 * @example
 * ```typescript
 * import { parse, isReply, getReplyToId, getRootId } from 'nostr-effect/nip10'
 *
 * const refs = parse(event)
 * console.log('Root:', refs.root?.id)
 * console.log('Reply to:', refs.reply?.id)
 * console.log('Mentions:', refs.mentions.map(m => m.id))
 *
 * if (isReply(event)) {
 *   console.log('Replying to:', getReplyToId(event))
 * }
 * ```
 */

// Re-export all from client implementation
export {
  parse,
  isReply,
  isRoot,
  getReplyToId,
  getRootId,
  type ThreadReferences,
} from "../client/Nip10Service.js"

// Re-export types needed for the parse result
export type { EventPointer, ProfilePointer } from "../core/Nip19.js"
