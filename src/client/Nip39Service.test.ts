/**
 * NIP-39: External Identities Tests
 * Tests ported from nostr-tools for 100% parity
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { makeNip39Service } from "./Nip39Service.js"

describe("NIP-39: External Identities", () => {
  describe("parseIdentityClaims", () => {
    test("should parse github identity claim", () => {
      const service = makeNip39Service()
      const tags = [["i", "github:vitorpamplona", "cf19e2d1d7f8dac6348ad37b35ec8421"]]

      const claims = service.parseIdentityClaims(tags)

      expect(claims).toHaveLength(1)
      expect(claims[0]!.platform).toBe("github")
      expect(claims[0]!.identity).toBe("vitorpamplona")
      expect(claims[0]!.proof).toBe("cf19e2d1d7f8dac6348ad37b35ec8421")
    })

    test("should parse multiple identity claims", () => {
      const service = makeNip39Service()
      const tags = [
        ["i", "github:user1", "proof1"],
        ["i", "twitter:user2", "proof2"],
        ["i", "mastodon:user3@instance.com", "proof3"],
      ]

      const claims = service.parseIdentityClaims(tags)

      expect(claims).toHaveLength(3)
      expect(claims[0]!.platform).toBe("github")
      expect(claims[1]!.platform).toBe("twitter")
      expect(claims[2]!.platform).toBe("mastodon")
    })

    test("should ignore invalid tags", () => {
      const service = makeNip39Service()
      const tags = [
        ["i", "invalidplatform:user", "proof"],
        ["i", "github"], // missing proof
        ["p", "somepubkey"], // not an identity tag
      ]

      const claims = service.parseIdentityClaims(tags)

      expect(claims).toHaveLength(0)
    })
  })

  describe("createIdentityTag", () => {
    test("should create valid identity tag", () => {
      const service = makeNip39Service()
      const tag = service.createIdentityTag("github", "username", "gistid123")

      expect(tag).toEqual(["i", "github:username", "gistid123"])
    })
  })

  describe("validateGithub", () => {
    test("should validate github claim with mock fetch", async () => {
      const mockFetch = async (url: string) => {
        if (url.includes("gist.github.com/testuser/testproof/raw")) {
          return {
            text: async () =>
              "Verifying that I control the following Nostr public key: npub1test123",
          } as Response
        }
        throw new Error("Not found")
      }

      const service = makeNip39Service(mockFetch as typeof fetch)

      const result = await Effect.runPromise(
        service.validateGithub("npub1test123", "testuser", "testproof")
      )

      expect(result).toBe(true)
    })

    test("should return false for invalid claim", async () => {
      const mockFetch = async (_url: string) => {
        return {
          text: async () => "Some other content",
        } as Response
      }

      const service = makeNip39Service(mockFetch as typeof fetch)

      const result = await Effect.runPromise(
        service.validateGithub("npub1test123", "testuser", "testproof")
      )

      expect(result).toBe(false)
    })
  })
})
