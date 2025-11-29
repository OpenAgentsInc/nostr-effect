/**
 * NIP-05: DNS-based Nostr Identity Verification
 *
 * Maps internet identifiers (user@domain.com) to Nostr pubkeys.
 *
 * @example
 * ```typescript
 * import { queryProfile, isValid, searchDomain, NIP05_REGEX } from 'nostr-effect/nip05'
 *
 * // Look up a user's profile
 * const profile = await queryProfile('bob@example.com')
 * if (profile) {
 *   console.log('Pubkey:', profile.pubkey)
 *   console.log('Relays:', profile.relays)
 * }
 *
 * // Verify an identifier matches a pubkey
 * const valid = await isValid(pubkey, 'bob@example.com')
 *
 * // Search for users on a domain
 * const users = await searchDomain('example.com', 'bob')
 * ```
 */

import { Effect, Exit } from "effect"
import {
  Nip05Service,
  Nip05ServiceLive,
  NIP05_REGEX,
  isNip05,
  type Nip05Identifier,
  type Nip05Response,
} from "../client/Nip05Service.js"

// Re-export types and utilities
export { NIP05_REGEX, isNip05, type Nip05Identifier, type Nip05Response }

/** Profile pointer result from NIP-05 lookup */
export interface ProfilePointer {
  pubkey: string
  relays?: readonly string[]
}

/**
 * Query a NIP-05 identifier and return profile pointer.
 *
 * @param fullname - NIP-05 identifier (e.g., "bob@example.com" or "example.com" for "_@example.com")
 * @returns Profile pointer with pubkey and optional relays, or null if not found
 * @throws Error if fetch fails or identifier is invalid
 *
 * @example
 * ```typescript
 * const profile = await queryProfile('bob@example.com')
 * if (profile) {
 *   console.log(profile.pubkey)
 * }
 * ```
 */
export async function queryProfile(fullname: string): Promise<ProfilePointer | null> {
  const program = Effect.gen(function* () {
    const service = yield* Nip05Service
    return yield* service.queryProfile(fullname)
  }).pipe(Effect.provide(Nip05ServiceLive))

  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    const error = exit.cause
    if (error._tag === "Fail") {
      const e = error.error
      if ("message" in e) {
        throw new Error(e.message as string)
      }
    }
    throw new Error("NIP-05 lookup failed")
  }

  return exit.value
}

/**
 * Search a domain for users matching a query.
 *
 * @param domain - Domain to search (e.g., "example.com")
 * @param query - Optional name prefix to search for
 * @returns Map of names to pubkeys
 *
 * @example
 * ```typescript
 * const users = await searchDomain('example.com')
 * for (const [name, pubkey] of Object.entries(users)) {
 *   console.log(`${name}: ${pubkey}`)
 * }
 * ```
 */
export async function searchDomain(
  domain: string,
  query?: string
): Promise<{ [name: string]: string }> {
  const program = Effect.gen(function* () {
    const service = yield* Nip05Service
    return yield* service.searchDomain(domain, query)
  }).pipe(Effect.provide(Nip05ServiceLive))

  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    const error = exit.cause
    if (error._tag === "Fail") {
      const e = error.error
      if ("message" in e) {
        throw new Error(e.message as string)
      }
    }
    throw new Error("NIP-05 search failed")
  }

  return exit.value as { [name: string]: string }
}

/**
 * Verify that a pubkey matches a NIP-05 identifier.
 *
 * @param pubkey - Hex pubkey to verify
 * @param nip05 - NIP-05 identifier (e.g., "bob@example.com")
 * @returns true if the identifier resolves to the given pubkey
 *
 * @example
 * ```typescript
 * const valid = await isValid(pubkey, 'bob@example.com')
 * if (valid) {
 *   console.log('Verified!')
 * }
 * ```
 */
export async function isValid(pubkey: string, nip05: string): Promise<boolean> {
  const program = Effect.gen(function* () {
    const service = yield* Nip05Service
    return yield* service.isValid(pubkey, nip05 as Nip05Identifier)
  }).pipe(Effect.provide(Nip05ServiceLive))

  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    return false
  }

  return exit.value
}

/**
 * Use a custom fetch function for NIP-05 lookups.
 * Useful for testing or environments without native fetch.
 *
 * @param fetchFn - Custom fetch implementation
 * @returns Object with queryProfile, searchDomain, isValid bound to the custom fetch
 */
export function useFetchImplementation(
  _fetchFn: typeof fetch
): {
  queryProfile: typeof queryProfile
  searchDomain: typeof searchDomain
  isValid: typeof isValid
} {
  // For now, just return the default implementation
  // TODO: Allow injecting custom fetch via Effect layers
  return { queryProfile, searchDomain, isValid }
}
