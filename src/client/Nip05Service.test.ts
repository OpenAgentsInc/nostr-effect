/**
 * NIP-05: DNS-based Identity Verification Tests
 */
import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { Effect } from "effect"
import { 
  Nip05Service, 
  Nip05ServiceLive, 
  NIP05_REGEX, 
  isNip05, 
  type Nip05Identifier,
} from "./Nip05Service.js"

describe("NIP-05: DNS Identity Verification", () => {
  describe("NIP05_REGEX", () => {
    test("should match user@domain.com format", () => {
      const match = "user@example.com".match(NIP05_REGEX)
      expect(match).not.toBeNull()
      expect(match![1]).toBe("user")
      expect(match![2]).toBe("example.com")
    })

    test("should match domain-only format", () => {
      const match = "example.com".match(NIP05_REGEX)
      expect(match).not.toBeNull()
      expect(match![1]).toBeUndefined()
      expect(match![2]).toBe("example.com")
    })

    test("should match subdomains", () => {
      const match = "user@sub.example.com".match(NIP05_REGEX)
      expect(match).not.toBeNull()
      expect(match![2]).toBe("sub.example.com")
    })

    test("should match special characters in name", () => {
      const match = "user.name+tag@example.com".match(NIP05_REGEX)
      expect(match).not.toBeNull()
      expect(match![1]).toBe("user.name+tag")
    })

    test("should not match invalid formats", () => {
      expect("invalid".match(NIP05_REGEX)).toBeNull()
      expect("@example.com".match(NIP05_REGEX)).toBeNull()
      expect("user@".match(NIP05_REGEX)).toBeNull()
    })
  })

  describe("isNip05()", () => {
    test("should return true for valid identifiers", () => {
      expect(isNip05("user@example.com")).toBe(true)
      expect(isNip05("example.com")).toBe(true)
      expect(isNip05("_@example.com")).toBe(true)
    })

    test("should return false for invalid identifiers", () => {
      expect(isNip05("invalid")).toBe(false)
      expect(isNip05("")).toBe(false)
      expect(isNip05(null)).toBe(false)
      expect(isNip05(undefined)).toBe(false)
    })

    test("should work as type guard", () => {
      const value = "user@example.com"
      if (isNip05(value)) {
        // TypeScript should narrow type to Nip05Identifier
        const _: Nip05Identifier = value
        expect(_).toBe(value)
      }
    })
  })
})

describe("Nip05Service (Effect layer)", () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(global, "fetch")
  })

  afterEach(() => {
    fetchSpy.mockReset()
  })

  const runQuery = (identifier: string) => Effect.gen(function* () {
  const service = yield* Nip05Service
  return yield* service.queryProfile(identifier)
}).pipe(
  Effect.provide(Nip05ServiceLive),
  Effect.runPromise
)

const runSearch = (domain: string, query?: string) => Effect.gen(function* () {
  const service = yield* Nip05Service
  return yield* service.searchDomain(domain, query)
}).pipe(
  Effect.provide(Nip05ServiceLive),
  Effect.runPromise
)

  test("queryProfile rejects invalid identifier without fetching", () => {
    return expect(runQuery("invalid")).rejects.toThrowError("Invalid NIP-05 identifier")
  })

  test("queryProfile handles fetch network error", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await expect(runQuery("bob@example.com")).rejects.toThrowError("Failed to fetch NIP-05 from example.com")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/.well-known/nostr.json?name=bob",
      { redirect: "manual" }
    )
  })

  test("queryProfile handles non-200 status (not found)", async () => {
    fetchSpy.mockResolvedValueOnce({ status: 404, ok: false } as Response)
    const result = await runQuery("bob@example.com")
    expect(result).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test("queryProfile handles JSON parse failure", async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token"))
    } as any)
    await expect(runQuery("bob@example.com")).rejects.toThrowError("Failed to parse NIP-05 response from example.com")
  })

  test("queryProfile returns null if name not in response", async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ names: {} })
    } as any)
    const result = await runQuery("bob@example.com")
    expect(result).toBeNull()
  })

  test("queryProfile success with profile pointer and relays", async () => {
    const pubkey = "npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    const mockJson = {
      names: { bob: pubkey },
      relays: { [pubkey]: ["wss://relay.example.com"] }
    }
    fetchSpy.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.resolve(mockJson)
    } as any)
    const result = await runQuery("bob@example.com")
    expect(result).toEqual({
      pubkey,
      relays: ["wss://relay.example.com"]
    })
  })

  test("queryProfile success for domain-only (uses _)", async () => {
    const pubkey = "npub1yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
    fetchSpy.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ names: { _: pubkey } })
    } as any)
    const result = await runQuery("example.com")
    expect(result?.pubkey).toBe(pubkey)
  })

  test("searchDomain success returns names map", async () => {
    const mockJson = { names: { alice: "npub1a...", bob: "npub1b..." } }
    fetchSpy.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.resolve(mockJson)
    } as any)
    const result = await runSearch("example.com")
    expect(result).toEqual(mockJson.names)
  })

  test("searchDomain handles query param", async () => {
    fetchSpy.mockResolvedValueOnce({ status: 200, ok: true, json: () => Promise.resolve({ names: {} }) } as any)
    await runSearch("example.com", "bob")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/.well-known/nostr.json?name=bob",
      expect.any(Object)
    )
  })

  test("searchDomain empty query uses empty name param", async () => {
    fetchSpy.mockResolvedValueOnce({ status: 200, ok: true, json: () => Promise.resolve({ names: {} }) } as any)
    await runSearch("example.com")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/.well-known/nostr.json?name=",
      expect.any(Object)
    )
  })

  test("isValid returns true for matching pubkey", async () => {
    const pubkey = "npub1valid"
    fetchSpy.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ names: { bob: pubkey } })
    } as any)
    const result = await Effect.gen(function* () {
      const service = yield* Nip05Service
      return yield* service.isValid(pubkey, "bob@example.com")
    }).pipe(
      Effect.provide(Nip05ServiceLive),
      Effect.runPromise
    )
    expect(result).toBe(true)
  })

  test("isValid returns false if pubkey mismatch", async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ names: { bob: "npub1other" } })
    } as any)
    const result = await Effect.gen(function* () {
      const service = yield* Nip05Service
      return yield* service.isValid("npub1mismatch", "bob@example.com")
    }).pipe(
      Effect.provide(Nip05ServiceLive),
      Effect.runPromise
    )
    expect(result).toBe(false)
  })

  test("isValid returns false on fetch failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("fail"))
    const result = await Effect.gen(function* () {
      const service = yield* Nip05Service
      return yield* service.isValid("npub1any", "bob@example.com")
    }).pipe(
      Effect.provide(Nip05ServiceLive),
      Effect.runPromise
    )
    expect(result).toBe(false)
  })
})
