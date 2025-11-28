/**
 * ConnectionManager Tests
 */
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { ConnectionManager, ConnectionManagerLive } from "./ConnectionManager.js"
import type { PublicKey } from "../../core/Schema.js"

const runWithManager = <A>(
  effect: Effect.Effect<A, never, ConnectionManager>
): Promise<A> => Effect.runPromise(Effect.provide(effect, ConnectionManagerLive))

describe("ConnectionManager", () => {
  describe("connect", () => {
    it("should create a new connection context", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          const ctx = yield* manager.connect({
            id: "conn-1",
            remoteAddress: "192.168.1.1",
          })
          return ctx
        })
      )

      expect(result.id).toBe("conn-1")
      expect(result.remoteAddress).toBe("192.168.1.1")
      expect(result.connectedAt).toBeInstanceOf(Date)
      expect(result.authPubkey).toBeUndefined()
      expect(result.challenge).toBeUndefined()
    })

    it("should work without remote address", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          const ctx = yield* manager.connect({ id: "conn-2" })
          return ctx
        })
      )

      expect(result.id).toBe("conn-2")
      expect(result.remoteAddress).toBeUndefined()
    })
  })

  describe("disconnect", () => {
    it("should remove a connection", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1" })
          yield* manager.disconnect("conn-1")
          return yield* manager.get("conn-1")
        })
      )

      expect(result).toBeUndefined()
    })
  })

  describe("get", () => {
    it("should return connection context if exists", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1", remoteAddress: "10.0.0.1" })
          return yield* manager.get("conn-1")
        })
      )

      expect(result?.id).toBe("conn-1")
      expect(result?.remoteAddress).toBe("10.0.0.1")
    })

    it("should return undefined if connection does not exist", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          return yield* manager.get("nonexistent")
        })
      )

      expect(result).toBeUndefined()
    })
  })

  describe("update", () => {
    it("should update connection context", async () => {
      const testPubkey = "abc123" as PublicKey

      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1" })
          return yield* manager.update("conn-1", (ctx) => ({
            ...ctx,
            authPubkey: testPubkey,
          }))
        })
      )

      expect(result?.authPubkey).toBe(testPubkey)
    })

    it("should return undefined if connection does not exist", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          return yield* manager.update("nonexistent", (ctx) => ctx)
        })
      )

      expect(result).toBeUndefined()
    })
  })

  describe("setChallenge", () => {
    it("should set NIP-42 challenge", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1" })
          yield* manager.setChallenge("conn-1", "challenge-string")
          return yield* manager.get("conn-1")
        })
      )

      expect(result?.challenge).toBe("challenge-string")
    })
  })

  describe("setAuthPubkey", () => {
    it("should set authenticated pubkey", async () => {
      const testPubkey = "pubkey123" as PublicKey

      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1" })
          yield* manager.setAuthPubkey("conn-1", testPubkey)
          return yield* manager.get("conn-1")
        })
      )

      expect(result?.authPubkey).toBe(testPubkey)
    })
  })

  describe("isAuthenticated", () => {
    it("should return false for unauthenticated connection", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1" })
          return yield* manager.isAuthenticated("conn-1")
        })
      )

      expect(result).toBe(false)
    })

    it("should return true after setting authPubkey", async () => {
      const testPubkey = "pubkey123" as PublicKey

      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1" })
          yield* manager.setAuthPubkey("conn-1", testPubkey)
          return yield* manager.isAuthenticated("conn-1")
        })
      )

      expect(result).toBe(true)
    })

    it("should return false for nonexistent connection", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          return yield* manager.isAuthenticated("nonexistent")
        })
      )

      expect(result).toBe(false)
    })
  })

  describe("getAll", () => {
    it("should return all connections", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1" })
          yield* manager.connect({ id: "conn-2" })
          yield* manager.connect({ id: "conn-3" })
          return yield* manager.getAll()
        })
      )

      expect(result.length).toBe(3)
      expect(result.map((c) => c.id).sort()).toEqual(["conn-1", "conn-2", "conn-3"])
    })
  })

  describe("count", () => {
    it("should return connection count", async () => {
      const result = await runWithManager(
        Effect.gen(function* () {
          const manager = yield* ConnectionManager
          yield* manager.connect({ id: "conn-1" })
          yield* manager.connect({ id: "conn-2" })
          const count1 = yield* manager.count()
          yield* manager.disconnect("conn-1")
          const count2 = yield* manager.count()
          return { count1, count2 }
        })
      )

      expect(result.count1).toBe(2)
      expect(result.count2).toBe(1)
    })
  })
})
