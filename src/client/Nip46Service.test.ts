/**
 * NIP-46 Remote Signing Tests
 */
import { describe, test, expect } from "bun:test"
import { Effect, Exit } from "effect"
import {
  parseBunkerUrl,
  parseNostrConnectUrl,
  parseNip46Url,
  createBunkerUrl,
  createNostrConnectUrl,
  generateRequestId,
  encodeRequest,
  decodeResponse,
  NIP46_KIND,
  type Nip46Request,
} from "./Nip46Service.js"
import type { PublicKey } from "../core/Schema.js"

// Test data
const VALID_PUBKEY = "fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52" as PublicKey
const VALID_RELAY = "wss://relay.example.com"

describe("NIP-46: Remote Signing", () => {
  describe("Constants", () => {
    test("NIP46_KIND should be 24133", () => {
      expect(NIP46_KIND as number).toBe(24133)
    })
  })

  describe("parseBunkerUrl", () => {
    test("should parse valid bunker URL with single relay", () => {
      const url = `bunker://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}`
      const result = Effect.runSync(parseBunkerUrl(url))

      expect(result.type).toBe("bunker")
      expect(result.remoteSignerPubkey).toBe(VALID_PUBKEY)
      expect(result.relays).toEqual([VALID_RELAY])
      expect(result.secret).toBeUndefined()
    })

    test("should parse bunker URL with multiple relays", () => {
      const relay2 = "wss://relay2.example.com"
      const url = `bunker://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}&relay=${encodeURIComponent(relay2)}`
      const result = Effect.runSync(parseBunkerUrl(url))

      expect(result.relays).toEqual([VALID_RELAY, relay2])
    })

    test("should parse bunker URL with secret", () => {
      const secret = "mysecret123"
      const url = `bunker://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}&secret=${secret}`
      const result = Effect.runSync(parseBunkerUrl(url))

      expect(result.secret).toBe(secret)
    })

    test("should fail on invalid protocol", () => {
      const url = `http://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}`
      const exit = Effect.runSyncExit(parseBunkerUrl(url))

      expect(Exit.isFailure(exit)).toBe(true)
    })

    test("should fail on invalid pubkey", () => {
      const url = `bunker://invalid?relay=${encodeURIComponent(VALID_RELAY)}`
      const exit = Effect.runSyncExit(parseBunkerUrl(url))

      expect(Exit.isFailure(exit)).toBe(true)
    })

    test("should fail when no relays provided", () => {
      const url = `bunker://${VALID_PUBKEY}`
      const exit = Effect.runSyncExit(parseBunkerUrl(url))

      expect(Exit.isFailure(exit)).toBe(true)
    })

    test("should normalize pubkey to lowercase", () => {
      const upperPubkey = VALID_PUBKEY.toUpperCase()
      const url = `bunker://${upperPubkey}?relay=${encodeURIComponent(VALID_RELAY)}`
      const result = Effect.runSync(parseBunkerUrl(url))

      expect(result.remoteSignerPubkey).toBe(VALID_PUBKEY)
    })
  })

  describe("parseNostrConnectUrl", () => {
    test("should parse valid nostrconnect URL", () => {
      const secret = "abc123"
      const url = `nostrconnect://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}&secret=${secret}`
      const result = Effect.runSync(parseNostrConnectUrl(url))

      expect(result.type).toBe("nostrconnect")
      expect(result.clientPubkey).toBe(VALID_PUBKEY)
      expect(result.relays).toEqual([VALID_RELAY])
      expect(result.secret).toBe(secret)
    })

    test("should parse nostrconnect URL with all optional params", () => {
      const secret = "abc123"
      const name = "My App"
      const appUrl = "https://myapp.com"
      const image = "https://myapp.com/icon.png"
      const perms = "sign_event:1,nip44_encrypt"

      const url = `nostrconnect://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}&secret=${secret}&name=${encodeURIComponent(name)}&url=${encodeURIComponent(appUrl)}&image=${encodeURIComponent(image)}&perms=${encodeURIComponent(perms)}`
      const result = Effect.runSync(parseNostrConnectUrl(url))

      expect(result.name).toBe(name)
      expect(result.url).toBe(appUrl)
      expect(result.image).toBe(image)
      expect(result.perms).toBe(perms)
    })

    test("should fail when secret is missing", () => {
      const url = `nostrconnect://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}`
      const exit = Effect.runSyncExit(parseNostrConnectUrl(url))

      expect(Exit.isFailure(exit)).toBe(true)
    })

    test("should fail on invalid protocol", () => {
      const url = `bunker://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}&secret=abc`
      const exit = Effect.runSyncExit(parseNostrConnectUrl(url))

      expect(Exit.isFailure(exit)).toBe(true)
    })
  })

  describe("parseNip46Url", () => {
    test("should parse bunker URL", () => {
      const url = `bunker://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}`
      const result = Effect.runSync(parseNip46Url(url))

      expect(result.type).toBe("bunker")
    })

    test("should parse nostrconnect URL", () => {
      const url = `nostrconnect://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}&secret=abc`
      const result = Effect.runSync(parseNip46Url(url))

      expect(result.type).toBe("nostrconnect")
    })

    test("should fail on unknown protocol", () => {
      const url = `http://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}`
      const exit = Effect.runSyncExit(parseNip46Url(url))

      expect(Exit.isFailure(exit)).toBe(true)
    })
  })

  describe("createBunkerUrl", () => {
    test("should create valid bunker URL", () => {
      const result = createBunkerUrl(VALID_PUBKEY, [VALID_RELAY])

      expect(result).toContain("bunker://")
      expect(result).toContain(VALID_PUBKEY)
      expect(result).toContain("relay=")
    })

    test("should include secret when provided", () => {
      const secret = "mysecret"
      const result = createBunkerUrl(VALID_PUBKEY, [VALID_RELAY], secret)

      expect(result).toContain(`secret=${secret}`)
    })

    test("should handle multiple relays", () => {
      const relay2 = "wss://relay2.example.com"
      const result = createBunkerUrl(VALID_PUBKEY, [VALID_RELAY, relay2])

      // Should have two relay params
      const relayCount = (result.match(/relay=/g) || []).length
      expect(relayCount).toBe(2)
    })

    test("roundtrip: parse created URL", () => {
      const secret = "testsecret"
      const relays = [VALID_RELAY, "wss://relay2.example.com"]
      const url = createBunkerUrl(VALID_PUBKEY, relays, secret)

      const parsed = Effect.runSync(parseBunkerUrl(url))

      expect(parsed.remoteSignerPubkey).toBe(VALID_PUBKEY)
      expect(parsed.secret).toBe(secret)
      expect(parsed.relays.length).toBe(2)
    })
  })

  describe("createNostrConnectUrl", () => {
    test("should create valid nostrconnect URL", () => {
      const result = createNostrConnectUrl({
        clientPubkey: VALID_PUBKEY,
        relays: [VALID_RELAY],
        secret: "abc123",
      })

      expect(result).toContain("nostrconnect://")
      expect(result).toContain(VALID_PUBKEY)
      expect(result).toContain("secret=abc123")
    })

    test("should include optional params", () => {
      const result = createNostrConnectUrl({
        clientPubkey: VALID_PUBKEY,
        relays: [VALID_RELAY],
        secret: "abc123",
        name: "Test App",
        perms: "sign_event:1",
      })

      expect(result).toContain("name=")
      expect(result).toContain("perms=")
    })

    test("roundtrip: parse created URL", () => {
      const options = {
        clientPubkey: VALID_PUBKEY,
        relays: [VALID_RELAY],
        secret: "mysecret",
        name: "Test App",
        url: "https://test.com",
      }
      const url = createNostrConnectUrl(options)
      const parsed = Effect.runSync(parseNostrConnectUrl(url))

      expect(parsed.clientPubkey).toBe(options.clientPubkey)
      expect(parsed.secret).toBe(options.secret)
      expect(parsed.name).toBe(options.name)
      expect(parsed.url).toBe(options.url)
    })
  })

  describe("generateRequestId", () => {
    test("should generate 32 character hex string", () => {
      const id = generateRequestId()

      expect(id).toMatch(/^[0-9a-f]{32}$/)
    })

    test("should generate unique IDs", () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateRequestId())
      }
      expect(ids.size).toBe(100)
    })
  })

  describe("encodeRequest", () => {
    test("should encode request to JSON", () => {
      const request: Nip46Request = {
        id: "abc123",
        method: "ping",
        params: [],
      }

      const encoded = encodeRequest(request)
      const parsed = JSON.parse(encoded)

      expect(parsed.id).toBe("abc123")
      expect(parsed.method).toBe("ping")
      expect(parsed.params).toEqual([])
    })

    test("should include params array", () => {
      const request: Nip46Request = {
        id: "def456",
        method: "sign_event",
        params: ['{"kind":1,"content":"test"}'],
      }

      const encoded = encodeRequest(request)
      const parsed = JSON.parse(encoded)

      expect(parsed.params).toHaveLength(1)
      expect(parsed.params[0]).toContain("kind")
    })
  })

  describe("decodeResponse", () => {
    test("should decode successful response", () => {
      const json = JSON.stringify({
        id: "abc123",
        result: "pong",
      })

      const result = Effect.runSync(decodeResponse(json))

      expect(result.id).toBe("abc123")
      expect(result.result).toBe("pong")
      expect(result.error).toBeUndefined()
    })

    test("should decode error response", () => {
      const json = JSON.stringify({
        id: "abc123",
        error: "permission denied",
      })

      const result = Effect.runSync(decodeResponse(json))

      expect(result.id).toBe("abc123")
      expect(result.result).toBeUndefined()
      expect(result.error).toBe("permission denied")
    })

    test("should decode auth challenge response", () => {
      const json = JSON.stringify({
        id: "abc123",
        result: "auth_url",
        error: "https://signer.example.com/auth?token=xyz",
      })

      const result = Effect.runSync(decodeResponse(json))

      expect(result.result).toBe("auth_url")
      expect(result.error).toContain("signer.example.com")
    })

    test("should fail on missing id", () => {
      const json = JSON.stringify({
        result: "pong",
      })

      const exit = Effect.runSyncExit(decodeResponse(json))

      expect(Exit.isFailure(exit)).toBe(true)
    })

    test("should fail on invalid JSON", () => {
      const exit = Effect.runSyncExit(decodeResponse("not json"))

      expect(Exit.isFailure(exit)).toBe(true)
    })
  })

  describe("NIP-46 Method Types", () => {
    test("all methods should be valid string literals", () => {
      const methods = [
        "connect",
        "sign_event",
        "ping",
        "get_public_key",
        "nip04_encrypt",
        "nip04_decrypt",
        "nip44_encrypt",
        "nip44_decrypt",
      ]

      for (const method of methods) {
        const request: Nip46Request = {
          id: generateRequestId(),
          method: method as Nip46Request["method"],
          params: [],
        }
        expect(encodeRequest(request)).toContain(method)
      }
    })
  })

  describe("URL edge cases", () => {
    test("should handle URL-encoded relay values", () => {
      const relay = "wss://relay.example.com/nostr?key=value"
      const url = `bunker://${VALID_PUBKEY}?relay=${encodeURIComponent(relay)}`
      const result = Effect.runSync(parseBunkerUrl(url))

      expect(result.relays[0]).toBe(relay)
    })

    test("should handle special characters in secret", () => {
      const secret = "secret+with=special&chars"
      const url = `bunker://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}&secret=${encodeURIComponent(secret)}`
      const result = Effect.runSync(parseBunkerUrl(url))

      expect(result.secret).toBe(secret)
    })

    test("should handle unicode in app name", () => {
      const name = "My App \u{1F680}"
      const url = `nostrconnect://${VALID_PUBKEY}?relay=${encodeURIComponent(VALID_RELAY)}&secret=abc&name=${encodeURIComponent(name)}`
      const result = Effect.runSync(parseNostrConnectUrl(url))

      expect(result.name).toBe(name)
    })
  })
})
