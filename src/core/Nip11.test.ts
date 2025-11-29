/**
 * NIP-11: Relay Information Document Tests
 */
import { describe, test, expect } from "bun:test"
import {
  fetchRelayInformation,
  useFetchImplementation,
  type RelayInformation,
} from "./Nip11.js"

describe("NIP-11: Relay Information", () => {
  describe("fetchRelayInformation", () => {
    test("should fetch relay information", async () => {
      // Mock fetch to avoid network calls in tests
      const mockRelayInfo: RelayInformation = {
        name: "Test Relay",
        description: "A test relay",
        pubkey: "abc123",
        contact: "test@example.com",
        supported_nips: [1, 11, 42],
        software: "test-relay",
        version: "1.0.0",
      }

      const mockFetch = async (_url: string, _init?: RequestInit) => {
        return {
          json: async () => mockRelayInfo,
        } as Response
      }

      useFetchImplementation(mockFetch as typeof fetch)

      const info = await fetchRelayInformation("wss://test.relay")
      expect(info.name).toBe("Test Relay")
      expect(info.description).toBe("A test relay")
      expect(info.supported_nips).toContain(1)
      expect(info.supported_nips).toContain(11)
    })

    test("should convert wss:// to https://", async () => {
      let capturedUrl = ""
      const mockFetch = async (url: string, _init?: RequestInit) => {
        capturedUrl = url
        return {
          json: async () => ({
            name: "Test",
            description: "",
            pubkey: "",
            contact: "",
            supported_nips: [],
            software: "",
            version: "",
          }),
        } as Response
      }

      useFetchImplementation(mockFetch as typeof fetch)

      await fetchRelayInformation("wss://test.relay")
      expect(capturedUrl).toBe("https://test.relay")
    })

    test("should convert ws:// to http://", async () => {
      let capturedUrl = ""
      const mockFetch = async (url: string, _init?: RequestInit) => {
        capturedUrl = url
        return {
          json: async () => ({
            name: "Test",
            description: "",
            pubkey: "",
            contact: "",
            supported_nips: [],
            software: "",
            version: "",
          }),
        } as Response
      }

      useFetchImplementation(mockFetch as typeof fetch)

      await fetchRelayInformation("ws://test.relay")
      expect(capturedUrl).toBe("http://test.relay")
    })

    test("should send Accept header for application/nostr+json", async () => {
      let capturedHeaders: HeadersInit | undefined
      const mockFetch = async (_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers
        return {
          json: async () => ({
            name: "Test",
            description: "",
            pubkey: "",
            contact: "",
            supported_nips: [],
            software: "",
            version: "",
          }),
        } as Response
      }

      useFetchImplementation(mockFetch as typeof fetch)

      await fetchRelayInformation("wss://test.relay")
      expect(capturedHeaders).toEqual({ Accept: "application/nostr+json" })
    })
  })
})
