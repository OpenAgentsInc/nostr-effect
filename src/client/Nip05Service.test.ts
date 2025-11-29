/**
 * NIP-05: DNS-based Identity Verification Tests
 */
import { describe, test, expect } from "bun:test"
import { NIP05_REGEX, isNip05, type Nip05Identifier } from "./Nip05Service.js"

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

  // Note: Full service tests would require mocking fetch
  // These tests cover the synchronous utility functions
})
