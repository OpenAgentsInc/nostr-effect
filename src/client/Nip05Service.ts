/**
 * NIP-05 Service
 *
 * DNS-based identity verification for Nostr.
 * Allows mapping internet identifiers (user@domain.com) to pubkeys.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/05.md
 */
import { Context, Data, Effect, Layer } from "effect"
import type { ProfilePointer } from "../core/Nip19.js"

// =============================================================================
// Types
// =============================================================================

/** NIP-05 identifier format: name@domain */
export type Nip05Identifier = `${string}@${string}`

/**
 * NIP-05 regex for parsing identifiers.
 * The localpart (name) is optional - defaults to "_" if omitted.
 *
 * Groups:
 * - 0: full match
 * - 1: name (optional)
 * - 2: domain
 */
export const NIP05_REGEX = /^(?:([\w.+-]+)@)?([\w_-]+(\.[\w_-]+)+)$/

/**
 * Check if a string is a valid NIP-05 identifier
 */
export const isNip05 = (value?: string | null): value is Nip05Identifier =>
  NIP05_REGEX.test(value || "")

/** NIP-05 .well-known/nostr.json response */
export interface Nip05Response {
  /** Map of names to pubkeys */
  readonly names: { readonly [name: string]: string }
  /** Optional map of pubkeys to relay URLs */
  readonly relays?: { readonly [pubkey: string]: readonly string[] }
  /** Optional NIP-46 bunker relays */
  readonly nip46?: { readonly [pubkey: string]: readonly string[] }
}

/** Error types for NIP-05 operations */
export class Nip05FetchError extends Data.TaggedError("Nip05FetchError")<{
  readonly domain: string
  readonly message: string
  readonly cause?: Error
}> {}

export class Nip05InvalidIdentifier extends Data.TaggedError("Nip05InvalidIdentifier")<{
  readonly identifier: string
  readonly message: string
}> {}

// =============================================================================
// Service Interface
// =============================================================================

export interface Nip05Service {
  readonly _tag: "Nip05Service"

  /**
   * Query a NIP-05 identifier and return profile pointer
   * Returns null if not found or invalid
   */
  queryProfile(
    fullname: string
  ): Effect.Effect<ProfilePointer | null, Nip05FetchError | Nip05InvalidIdentifier>

  /**
   * Search a domain for users matching a query
   * Returns map of names to pubkeys
   */
  searchDomain(
    domain: string,
    query?: string
  ): Effect.Effect<{ readonly [name: string]: string }, Nip05FetchError>

  /**
   * Verify that a pubkey matches a NIP-05 identifier
   */
  isValid(
    pubkey: string,
    nip05: Nip05Identifier
  ): Effect.Effect<boolean, Nip05FetchError | Nip05InvalidIdentifier>
}

// =============================================================================
// Service Tag
// =============================================================================

export const Nip05Service = Context.GenericTag<Nip05Service>("Nip05Service")

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.sync(() => {
  const queryProfile: Nip05Service["queryProfile"] = (fullname) =>
    Effect.gen(function* () {
      const match = fullname.match(NIP05_REGEX)
      if (!match) {
        return yield* Effect.fail(
          new Nip05InvalidIdentifier({
            identifier: fullname,
            message: `Invalid NIP-05 identifier: ${fullname}`,
          })
        )
      }

      const [, name = "_", domain] = match

      const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name!)}`

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, { redirect: "manual" }),
        catch: (error) =>
          new Nip05FetchError({
            domain: domain!,
            message: `Failed to fetch NIP-05 from ${domain}`,
            cause: error as Error,
          }),
      })

      if (response.status !== 200) {
        return null
      }

      const json = yield* Effect.tryPromise({
        try: () => response.json() as Promise<Nip05Response>,
        catch: (error) =>
          new Nip05FetchError({
            domain: domain!,
            message: `Failed to parse NIP-05 response from ${domain}`,
            cause: error as Error,
          }),
      })

      const pubkey = json.names?.[name]
      if (!pubkey) {
        return null
      }

      const relays = json.relays?.[pubkey]
      return {
        pubkey,
        relays: relays ? [...relays] : undefined,
      } as ProfilePointer
    })

  const searchDomain: Nip05Service["searchDomain"] = (domain, query = "") =>
    Effect.gen(function* () {
      const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(query)}`

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, { redirect: "manual" }),
        catch: (error) =>
          new Nip05FetchError({
            domain,
            message: `Failed to fetch NIP-05 from ${domain}`,
            cause: error as Error,
          }),
      })

      if (response.status !== 200) {
        return {}
      }

      const json = yield* Effect.tryPromise({
        try: () => response.json() as Promise<Nip05Response>,
        catch: (error) =>
          new Nip05FetchError({
            domain,
            message: `Failed to parse NIP-05 response from ${domain}`,
            cause: error as Error,
          }),
      })

      return json.names ?? {}
    })

  const isValid: Nip05Service["isValid"] = (pubkey, nip05) =>
    Effect.gen(function* () {
      const result = yield* queryProfile(nip05)
      return result ? result.pubkey === pubkey : false
    })

  return {
    _tag: "Nip05Service" as const,
    queryProfile,
    searchDomain,
    isValid,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for Nip05Service
 * Uses native fetch
 */
export const Nip05ServiceLive = Layer.effect(Nip05Service, make)
