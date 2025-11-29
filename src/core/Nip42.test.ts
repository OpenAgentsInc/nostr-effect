/**
 * NIP-42: Client Authentication Tests
 */
import { describe, test, expect } from "bun:test"
import { makeAuthEvent, CLIENT_AUTH_KIND } from "./Nip42.js"

describe("NIP-42: Client Authentication", () => {
  describe("makeAuthEvent", () => {
    test("should create auth event with correct tags", () => {
      const relayUrl = "wss://test.relay"
      const challenge = "chachacha"

      const auth = makeAuthEvent(relayUrl, challenge)

      expect(auth.tags).toHaveLength(2)
      expect(auth.tags[0]).toEqual(["relay", relayUrl])
      expect(auth.tags[1]).toEqual(["challenge", challenge])
    })

    test("should use correct kind", () => {
      const auth = makeAuthEvent("wss://test.relay", "challenge")
      expect(auth.kind).toBe(CLIENT_AUTH_KIND)
      expect(auth.kind as number).toBe(22242)
    })

    test("should have empty content", () => {
      const auth = makeAuthEvent("wss://test.relay", "challenge")
      expect(auth.content).toBe("")
    })

    test("should have valid created_at timestamp", () => {
      const before = Math.floor(Date.now() / 1000)
      const auth = makeAuthEvent("wss://test.relay", "challenge")
      const after = Math.floor(Date.now() / 1000)

      expect(auth.created_at).toBeGreaterThanOrEqual(before)
      expect(auth.created_at).toBeLessThanOrEqual(after)
    })
  })

  describe("CLIENT_AUTH_KIND", () => {
    test("should be 22242", () => {
      expect(CLIENT_AUTH_KIND as number).toBe(22242)
    })
  })
})
