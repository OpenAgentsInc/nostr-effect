/**
 * AuthService Tests
 */
import { describe, it, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AuthService, makeAuthServiceLayer } from "./AuthService.js"
import { ConnectionManager, ConnectionManagerLive } from "./ConnectionManager.js"
import { EventService, EventServiceLive } from "../../services/EventService.js"
import { CryptoServiceLive } from "../../services/CryptoService.js"
import {
  type EventKind,
  type PrivateKey,
  type Tag,
  type UnixTimestamp,
  AUTH_EVENT_KIND,
} from "../../core/Schema.js"
import type { Nip42Config } from "./nip/modules/Nip42Module.js"

// Test helpers
const testPrivateKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as PrivateKey

const testConfig: Nip42Config = {
  relayUrls: ["wss://relay.test.com"],
  maxAuthAge: 600,
}

const makeTestLayer = (config: Nip42Config = testConfig) => {
  const authServiceLayer = makeAuthServiceLayer(config)
  const cryptoLayer = CryptoServiceLive
  const eventLayer = Layer.provide(EventServiceLive, cryptoLayer)
  const connLayer = ConnectionManagerLive

  return Layer.provide(
    authServiceLayer,
    Layer.merge(eventLayer, connLayer)
  )
}

const runWithAuth = <A, E>(
  effect: Effect.Effect<A, E, AuthService | ConnectionManager>
): Promise<A> => {
  const layer = makeTestLayer()
  const fullLayer = Layer.merge(layer, ConnectionManagerLive)
  return Effect.runPromise(Effect.provide(effect, fullLayer)) as Promise<A>
}

const createTestAuthEvent = async (
  challenge: string,
  relayUrl: string,
  options: { createdAt?: number; kind?: number } = {}
) => {
  const layer = Layer.provide(EventServiceLive, CryptoServiceLive)
  const kind = (options.kind ?? AUTH_EVENT_KIND) as EventKind

  const params: {
    kind: EventKind
    tags: Tag[]
    content: string
    created_at?: UnixTimestamp
  } = {
    kind,
    tags: [
      ["relay", relayUrl] as unknown as Tag,
      ["challenge", challenge] as unknown as Tag,
    ],
    content: "",
  }

  if (options.createdAt !== undefined) {
    params.created_at = options.createdAt as UnixTimestamp
  }

  return await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const eventService = yield* EventService
        return yield* eventService.createEvent(params, testPrivateKey)
      }),
      layer
    )
  )
}

describe("AuthService", () => {
  describe("getChallenge", () => {
    it("should create a challenge for a new connection", async () => {
      const result = await runWithAuth(
        Effect.gen(function* () {
          const connectionManager = yield* ConnectionManager
          const authService = yield* AuthService

          yield* connectionManager.connect({ id: "conn-1" })
          return yield* authService.getChallenge("conn-1")
        })
      )

      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThan(0)
    })

    it("should return same challenge for existing connection", async () => {
      const result = await runWithAuth(
        Effect.gen(function* () {
          const connectionManager = yield* ConnectionManager
          const authService = yield* AuthService

          yield* connectionManager.connect({ id: "conn-1" })
          const c1 = yield* authService.getChallenge("conn-1")
          const c2 = yield* authService.getChallenge("conn-1")
          return { c1, c2 }
        })
      )

      expect(result.c1).toBe(result.c2)
    })
  })

  describe("createChallenge", () => {
    it("should create a new challenge even if one exists", async () => {
      const result = await runWithAuth(
        Effect.gen(function* () {
          const connectionManager = yield* ConnectionManager
          const authService = yield* AuthService

          yield* connectionManager.connect({ id: "conn-1" })
          const c1 = yield* authService.createChallenge("conn-1")
          const c2 = yield* authService.createChallenge("conn-1")
          return { c1, c2 }
        })
      )

      expect(result.c1).not.toBe(result.c2)
    })
  })

  describe("handleAuth", () => {
    it("should authenticate valid auth event", async () => {
      const layer = makeTestLayer()
      const fullLayer = Layer.merge(layer, ConnectionManagerLive)

      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const connectionManager = yield* ConnectionManager
            const authService = yield* AuthService

            yield* connectionManager.connect({ id: "conn-1" })
            const challenge = yield* authService.createChallenge("conn-1")

            const authEvent = yield* Effect.promise(() =>
              createTestAuthEvent(challenge, "wss://relay.test.com")
            )

            return yield* authService.handleAuth("conn-1", authEvent)
          }),
          fullLayer
        )
      )

      expect(result.success).toBe(true)
      expect(result.pubkey).toBeDefined()
      expect(result.message).toBe("")
    })

    it("should reject auth event with wrong challenge", async () => {
      const layer = makeTestLayer()
      const fullLayer = Layer.merge(layer, ConnectionManagerLive)

      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const connectionManager = yield* ConnectionManager
            const authService = yield* AuthService

            yield* connectionManager.connect({ id: "conn-1" })
            yield* authService.createChallenge("conn-1")

            const authEvent = yield* Effect.promise(() =>
              createTestAuthEvent("wrong-challenge", "wss://relay.test.com")
            )

            return yield* authService.handleAuth("conn-1", authEvent)
          }),
          fullLayer
        )
      )

      expect(result.success).toBe(false)
      expect(result.message).toContain("challenge mismatch")
    })

    it("should reject auth event for unknown connection", async () => {
      const layer = makeTestLayer()
      const fullLayer = Layer.merge(layer, ConnectionManagerLive)

      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const authService = yield* AuthService

            const authEvent = yield* Effect.promise(() =>
              createTestAuthEvent("some-challenge", "wss://relay.test.com")
            )

            return yield* authService.handleAuth("unknown-conn", authEvent)
          }),
          fullLayer
        )
      )

      expect(result.success).toBe(false)
      expect(result.message).toContain("connection not found")
    })

    it("should reject auth event when no challenge issued", async () => {
      const layer = makeTestLayer()
      const fullLayer = Layer.merge(layer, ConnectionManagerLive)

      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const connectionManager = yield* ConnectionManager
            const authService = yield* AuthService

            yield* connectionManager.connect({ id: "conn-1" })
            // Note: not calling createChallenge

            const authEvent = yield* Effect.promise(() =>
              createTestAuthEvent("some-challenge", "wss://relay.test.com")
            )

            return yield* authService.handleAuth("conn-1", authEvent)
          }),
          fullLayer
        )
      )

      expect(result.success).toBe(false)
      expect(result.message).toContain("no challenge issued")
    })
  })

  describe("isAuthenticated", () => {
    it("should return false for unauthenticated connection", async () => {
      const result = await runWithAuth(
        Effect.gen(function* () {
          const connectionManager = yield* ConnectionManager
          const authService = yield* AuthService

          yield* connectionManager.connect({ id: "conn-1" })
          return yield* authService.isAuthenticated("conn-1")
        })
      )

      expect(result).toBe(false)
    })

    it("should return true after successful authentication", async () => {
      const layer = makeTestLayer()
      const fullLayer = Layer.merge(layer, ConnectionManagerLive)

      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const connectionManager = yield* ConnectionManager
            const authService = yield* AuthService

            yield* connectionManager.connect({ id: "conn-1" })
            const challenge = yield* authService.createChallenge("conn-1")

            const authEvent = yield* Effect.promise(() =>
              createTestAuthEvent(challenge, "wss://relay.test.com")
            )

            yield* authService.handleAuth("conn-1", authEvent)
            return yield* authService.isAuthenticated("conn-1")
          }),
          fullLayer
        )
      )

      expect(result).toBe(true)
    })
  })

  describe("getAuthPubkey", () => {
    it("should return undefined for unauthenticated connection", async () => {
      const result = await runWithAuth(
        Effect.gen(function* () {
          const connectionManager = yield* ConnectionManager
          const authService = yield* AuthService

          yield* connectionManager.connect({ id: "conn-1" })
          return yield* authService.getAuthPubkey("conn-1")
        })
      )

      expect(result).toBeUndefined()
    })

    it("should return pubkey after authentication", async () => {
      const layer = makeTestLayer()
      const fullLayer = Layer.merge(layer, ConnectionManagerLive)

      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const connectionManager = yield* ConnectionManager
            const authService = yield* AuthService

            yield* connectionManager.connect({ id: "conn-1" })
            const challenge = yield* authService.createChallenge("conn-1")

            const authEvent = yield* Effect.promise(() =>
              createTestAuthEvent(challenge, "wss://relay.test.com")
            )

            const authResult = yield* authService.handleAuth("conn-1", authEvent)
            const storedPubkey = yield* authService.getAuthPubkey("conn-1")
            return { authPubkey: authResult.pubkey, storedPubkey }
          }),
          fullLayer
        )
      )

      expect(result.storedPubkey).toBeDefined()
      expect(String(result.storedPubkey)).toBe(String(result.authPubkey))
    })
  })

  describe("buildAuthMessage", () => {
    it("should build correct AUTH message format", async () => {
      const result = await runWithAuth(
        Effect.gen(function* () {
          const authService = yield* AuthService
          return authService.buildAuthMessage("test-challenge")
        })
      )

      expect(result).toEqual(["AUTH", "test-challenge"])
    })
  })
})
