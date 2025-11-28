/**
 * Tests for FollowListService (NIP-02)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import { FollowListService, FollowListServiceLive, type Follow } from "./FollowListService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { PublicKey } from "../core/Schema.js"

const decodePublicKey = Schema.decodeSync(PublicKey)

describe("FollowListService", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 12000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({
      url: `ws://localhost:${port}`,
      reconnect: false,
    })

    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )

    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        FollowListServiceLive.pipe(
          Layer.provide(RelayLayer),
          Layer.provide(ServiceLayer)
        )
      )
    )
  }

  describe("setFollows and getFollows", () => {
    test("publishes and retrieves follow list", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        // Generate test keys
        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        // Create some follow pubkeys (using valid hex format)
        const follow1Pubkey = decodePublicKey(
          "0000000000000000000000000000000000000000000000000000000000000001"
        )
        const follow2Pubkey = decodePublicKey(
          "0000000000000000000000000000000000000000000000000000000000000002"
        )

        const follows: Follow[] = [
          { pubkey: follow1Pubkey, relay: "wss://relay1.example.com", petname: "Alice" },
          { pubkey: follow2Pubkey, relay: "wss://relay2.example.com" },
        ]

        // Set follows
        const publishResult = yield* followList.setFollows(follows, privateKey)
        expect(publishResult.accepted).toBe(true)

        // Wait for event to be stored
        yield* Effect.sleep(500)

        // Get follows back
        const result = yield* followList.getFollows(pubkey)

        expect(result.follows.length).toBe(2)
        expect(result.follows[0]?.pubkey).toBe(follow1Pubkey)
        expect(result.follows[0]?.relay).toBe("wss://relay1.example.com")
        expect(result.follows[0]?.petname).toBe("Alice")
        expect(result.follows[1]?.pubkey).toBe(follow2Pubkey)
        expect(result.follows[1]?.relay).toBe("wss://relay2.example.com")
        expect(result.event).toBeDefined()
        expect(result.updatedAt).toBeDefined()

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns empty list for unknown pubkey", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService

        yield* relayService.connect()

        // Query for a pubkey that doesn't exist
        const unknownPubkey = decodePublicKey(
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        )

        const result = yield* followList.getFollows(unknownPubkey)

        expect(result.follows.length).toBe(0)
        expect(result.event).toBeUndefined()

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("addFollow", () => {
    test("adds a follow to empty list", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const newFollow: Follow = {
          pubkey: decodePublicKey(
            "1111111111111111111111111111111111111111111111111111111111111111"
          ),
          relay: "wss://relay.example.com",
        }

        const result = yield* followList.addFollow(newFollow, privateKey)
        expect(result.accepted).toBe(true)

        yield* Effect.sleep(500)

        const { follows } = yield* followList.getFollows(pubkey)
        expect(follows.length).toBe(1)
        expect(follows[0]?.pubkey).toBe(newFollow.pubkey)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("adds a follow to existing list", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        // Set initial follows
        const initialFollow: Follow = {
          pubkey: decodePublicKey(
            "2222222222222222222222222222222222222222222222222222222222222222"
          ),
        }
        yield* followList.setFollows([initialFollow], privateKey)
        yield* Effect.sleep(1100) // Wait for different timestamp (Nostr uses seconds)

        // Add another follow
        const newFollow: Follow = {
          pubkey: decodePublicKey(
            "3333333333333333333333333333333333333333333333333333333333333333"
          ),
        }
        yield* followList.addFollow(newFollow, privateKey)
        yield* Effect.sleep(1100)

        const { follows } = yield* followList.getFollows(pubkey)
        expect(follows.length).toBe(2)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns success for already following", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const follow: Follow = {
          pubkey: decodePublicKey(
            "4444444444444444444444444444444444444444444444444444444444444444"
          ),
        }

        // Add follow
        yield* followList.addFollow(follow, privateKey)
        yield* Effect.sleep(1100) // Wait for different timestamp (Nostr uses seconds)

        // Try to add again
        const result = yield* followList.addFollow(follow, privateKey)
        expect(result.accepted).toBe(true)
        expect(result.message).toBe("already following")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("removeFollow", () => {
    test("removes a follow from list", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const follow1Pubkey = decodePublicKey(
          "5555555555555555555555555555555555555555555555555555555555555555"
        )
        const follow2Pubkey = decodePublicKey(
          "6666666666666666666666666666666666666666666666666666666666666666"
        )

        // Set initial follows
        yield* followList.setFollows(
          [{ pubkey: follow1Pubkey }, { pubkey: follow2Pubkey }],
          privateKey
        )
        yield* Effect.sleep(1100) // Wait for different timestamp (Nostr uses seconds)

        // Remove one
        yield* followList.removeFollow(follow1Pubkey, privateKey)
        yield* Effect.sleep(1100)

        const { follows } = yield* followList.getFollows(pubkey)
        expect(follows.length).toBe(1)
        expect(follows[0]?.pubkey).toBe(follow2Pubkey)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns success for not following", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const result = yield* followList.removeFollow(
          decodePublicKey(
            "7777777777777777777777777777777777777777777777777777777777777777"
          ),
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(result.message).toBe("not following")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("isFollowing", () => {
    test("returns true if following", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const followPubkey = decodePublicKey(
          "8888888888888888888888888888888888888888888888888888888888888888"
        )

        yield* followList.setFollows([{ pubkey: followPubkey }], privateKey)
        yield* Effect.sleep(500)

        const result = yield* followList.isFollowing(pubkey, followPubkey)
        expect(result).toBe(true)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns false if not following", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const notFollowingPubkey = decodePublicKey(
          "9999999999999999999999999999999999999999999999999999999999999999"
        )

        const result = yield* followList.isFollowing(pubkey, notFollowingPubkey)
        expect(result).toBe(false)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("replaceable event semantics", () => {
    test("newer follow list replaces older one", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const followList = yield* FollowListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const oldFollow = decodePublicKey(
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        )
        const newFollow = decodePublicKey(
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        )

        // Set first follow list
        yield* followList.setFollows([{ pubkey: oldFollow }], privateKey)
        yield* Effect.sleep(1100) // Wait for different timestamp

        // Set second follow list (should replace)
        yield* followList.setFollows([{ pubkey: newFollow }], privateKey)
        yield* Effect.sleep(500)

        // Query should return only the newer list
        const { follows } = yield* followList.getFollows(pubkey)
        expect(follows.length).toBe(1)
        expect(follows[0]?.pubkey).toBe(newFollow)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })
})
