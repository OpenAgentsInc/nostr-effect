/**
 * NIP-39: External Identities in Profiles
 *
 * Validate external identity claims (GitHub, etc.) in profiles.
 *
 * @example
 * ```typescript
 * import { validateGithub, parseIdentityClaims, createIdentityTag } from 'nostr-effect/nip39'
 *
 * // Validate a GitHub claim
 * const isValid = await validateGithub(pubkey, 'username', 'gist-id')
 *
 * // Parse claims from profile event tags
 * const claims = parseIdentityClaims(event.tags)
 *
 * // Create an identity tag
 * const tag = createIdentityTag('github', 'username', 'gist-id')
 * ```
 */

import { Effect } from "effect"
import {
  makeNip39Service,
  type IdentityPlatform,
  type IdentityClaim,
} from "../client/Nip39Service.js"

const service = makeNip39Service()

/**
 * Validate a GitHub identity claim
 * Checks if a gist contains the expected pubkey verification message
 */
export async function validateGithub(
  pubkey: string,
  username: string,
  proof: string
): Promise<boolean> {
  return Effect.runPromise(service.validateGithub(pubkey, username, proof))
}

/**
 * Parse identity claims from event tags
 */
export function parseIdentityClaims(
  tags: readonly (readonly string[])[]
): readonly IdentityClaim[] {
  return service.parseIdentityClaims(tags)
}

/**
 * Create an identity tag for a profile event
 */
export function createIdentityTag(
  platform: IdentityPlatform,
  identity: string,
  proof: string
): readonly string[] {
  return service.createIdentityTag(platform, identity, proof)
}

// Re-export types
export type { IdentityPlatform, IdentityClaim } from "../client/Nip39Service.js"
