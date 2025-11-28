/**
 * Tests for RelayInfo (NIP-11)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect } from "effect"
import {
  defaultRelayInfo,
  mergeRelayInfo,
  type RelayInfo,
} from "./core/RelayInfo.js"
import { startTestRelay, startRelay, type RelayHandle } from "./index.js"

describe("RelayInfo", () => {
  describe("defaultRelayInfo", () => {
    test("has required fields", () => {
      expect(defaultRelayInfo.name).toBe("nostr-effect relay")
      expect(defaultRelayInfo.description).toBeDefined()
      expect(defaultRelayInfo.supported_nips).toContain(1)
      expect(defaultRelayInfo.supported_nips).toContain(11)
      expect(defaultRelayInfo.software).toBeDefined()
      expect(defaultRelayInfo.version).toBeDefined()
    })
  })

  describe("mergeRelayInfo", () => {
    test("uses defaults when no custom provided", () => {
      const result = mergeRelayInfo({})
      expect(result.name).toBe("nostr-effect relay")
      expect(result.supported_nips).toEqual([1, 11, 16, 33])
    })

    test("overrides defaults with custom values", () => {
      const custom: Partial<RelayInfo> = {
        name: "My Custom Relay",
        description: "A custom relay description",
      }
      const result = mergeRelayInfo(custom)
      expect(result.name).toBe("My Custom Relay")
      expect(result.description).toBe("A custom relay description")
      // Keeps other defaults
      expect(result.supported_nips).toEqual([1, 11, 16, 33])
    })

    test("merges limitation objects", () => {
      const custom: Partial<RelayInfo> = {
        limitation: {
          max_message_length: 65536,
          auth_required: true,
        },
      }
      const result = mergeRelayInfo(custom)
      expect(result.limitation?.max_message_length).toBe(65536)
      expect(result.limitation?.auth_required).toBe(true)
    })
  })
})

describe("NIP-11 HTTP endpoint", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 14000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  test("returns relay info with Accept: application/nostr+json", async () => {
    const response = await fetch(`http://localhost:${port}/`, {
      headers: {
        Accept: "application/nostr+json",
      },
    })

    expect(response.ok).toBe(true)
    expect(response.headers.get("Content-Type")).toBe("application/nostr+json")

    const info = (await response.json()) as RelayInfo
    expect(info.name).toBe("nostr-effect relay")
    expect(info.supported_nips).toContain(1)
    expect(info.supported_nips).toContain(11)
  })

  test("includes CORS headers", async () => {
    const response = await fetch(`http://localhost:${port}/`, {
      headers: {
        Accept: "application/nostr+json",
      },
    })

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET")
  })

  test("handles CORS preflight request", async () => {
    const response = await fetch(`http://localhost:${port}/`, {
      method: "OPTIONS",
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Accept")
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET")
  })
})

describe("NIP-11 with custom config", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 15000 + Math.floor(Math.random() * 10000)
    relay = await startRelay({
      port,
      relayInfo: {
        name: "Custom Test Relay",
        description: "Testing custom relay info",
        pubkey: "0000000000000000000000000000000000000000000000000000000000000001",
        supported_nips: [1, 11, 16, 33, 42],
        limitation: {
          max_subscriptions: 100,
          auth_required: false,
        },
      },
    })
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  test("returns custom relay info", async () => {
    const response = await fetch(`http://localhost:${port}/`, {
      headers: {
        Accept: "application/nostr+json",
      },
    })

    const info = (await response.json()) as RelayInfo
    expect(info.name).toBe("Custom Test Relay")
    expect(info.description).toBe("Testing custom relay info")
    expect(info.pubkey).toBe("0000000000000000000000000000000000000000000000000000000000000001")
    expect(info.supported_nips).toContain(42)
  })

  test("returns merged limitation settings", async () => {
    const response = await fetch(`http://localhost:${port}/`, {
      headers: {
        Accept: "application/nostr+json",
      },
    })

    const info = (await response.json()) as RelayInfo
    expect(info.limitation?.max_subscriptions).toBe(100)
    expect(info.limitation?.auth_required).toBe(false)
  })
})
