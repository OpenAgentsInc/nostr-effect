/**
 * NIP-39: External Identities in Profiles
 * https://github.com/nostr-protocol/nips/blob/master/39.md
 *
 * Validation of external identity claims (GitHub, Twitter, etc.)
 */
import { Effect, Context, Data } from "effect"

/**
 * Error when fetching external identity proof fails
 */
export class Nip39FetchError extends Data.TaggedError("Nip39FetchError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Supported identity platforms
 */
export type IdentityPlatform = "github" | "twitter" | "mastodon" | "telegram"

/**
 * Identity claim from a profile event
 */
export interface IdentityClaim {
  readonly platform: IdentityPlatform
  readonly identity: string
  readonly proof: string
}

export interface Nip39Service {
  /**
   * Validate a GitHub identity claim
   * Checks if a gist contains the expected pubkey verification message
   */
  readonly validateGithub: (
    pubkey: string,
    username: string,
    proof: string
  ) => Effect.Effect<boolean, Nip39FetchError>

  /**
   * Parse identity claims from event tags
   */
  readonly parseIdentityClaims: (
    tags: readonly (readonly string[])[]
  ) => readonly IdentityClaim[]

  /**
   * Create an identity tag for a profile event
   */
  readonly createIdentityTag: (
    platform: IdentityPlatform,
    identity: string,
    proof: string
  ) => readonly string[]
}

export const Nip39Service = Context.GenericTag<Nip39Service>("Nip39Service")

/**
 * Create the Nip39Service implementation
 */
export const makeNip39Service = (
  fetchImpl: typeof fetch = globalThis.fetch
): Nip39Service => {
  const validateGithub: Nip39Service["validateGithub"] = (pubkey, username, proof) =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetchImpl(`https://gist.github.com/${username}/${proof}/raw`)
        const text = await res.text()
        return text === `Verifying that I control the following Nostr public key: ${pubkey}`
      },
      catch: (error) =>
        new Nip39FetchError({
          message: `Failed to validate GitHub identity for ${username}`,
          cause: error,
        }),
    })

  const parseIdentityClaims: Nip39Service["parseIdentityClaims"] = (tags) => {
    const claims: IdentityClaim[] = []

    for (const tag of tags) {
      if (tag[0] === "i" && tag.length >= 3) {
        const identityStr = tag[1]
        const proof = tag[2]
        if (!identityStr) continue
        const [platform, identity] = identityStr.split(":")

        if (
          platform &&
          identity &&
          proof &&
          ["github", "twitter", "mastodon", "telegram"].includes(platform)
        ) {
          claims.push({
            platform: platform as IdentityPlatform,
            identity,
            proof,
          })
        }
      }
    }

    return claims
  }

  const createIdentityTag: Nip39Service["createIdentityTag"] = (platform, identity, proof) => {
    return ["i", `${platform}:${identity}`, proof] as const
  }

  return Nip39Service.of({
    validateGithub,
    parseIdentityClaims,
    createIdentityTag,
  })
}

export const Nip39ServiceLive = Effect.succeed(makeNip39Service())
