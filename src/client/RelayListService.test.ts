/**
 * Tests for RelayListService (NIP-65)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { RelayListService, RelayListServiceLive, type RelayEntry } from "./RelayListService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("RelayListService", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 13000 + Math.floor(Math.random() * 10000)
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
        RelayListServiceLive.pipe(
          Layer.provide(RelayLayer),
          Layer.provide(ServiceLayer)
        )
      )
    )
  }

  describe("setRelayList and getRelayList", () => {
    test("publishes and retrieves relay list", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        // Generate test keys
        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const relays: RelayEntry[] = [
          { url: "wss://relay1.example.com", mode: "both" },
          { url: "wss://relay2.example.com", mode: "read" },
          { url: "wss://relay3.example.com", mode: "write" },
        ]

        // Set relay list
        const publishResult = yield* relayList.setRelayList(relays, privateKey)
        expect(publishResult.accepted).toBe(true)

        // Wait for event to be stored
        yield* Effect.sleep(500)

        // Get relay list back
        const result = yield* relayList.getRelayList(pubkey)

        expect(result.relays.length).toBe(3)
        expect(result.relays[0]?.url).toBe("wss://relay1.example.com")
        expect(result.relays[0]?.mode).toBe("both")
        expect(result.relays[1]?.url).toBe("wss://relay2.example.com")
        expect(result.relays[1]?.mode).toBe("read")
        expect(result.relays[2]?.url).toBe("wss://relay3.example.com")
        expect(result.relays[2]?.mode).toBe("write")
        expect(result.event).toBeDefined()
        expect(result.updatedAt).toBeDefined()

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns empty list for unknown pubkey", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        // Generate a key we won't use
        const privateKey = yield* crypto.generatePrivateKey()
        const unknownPubkey = yield* crypto.getPublicKey(privateKey)

        const result = yield* relayList.getRelayList(unknownPubkey)

        expect(result.relays.length).toBe(0)
        expect(result.event).toBeUndefined()

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("addRelay", () => {
    test("adds a relay to empty list", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const newRelay: RelayEntry = {
          url: "wss://new-relay.example.com",
          mode: "both",
        }

        const result = yield* relayList.addRelay(newRelay, privateKey)
        expect(result.accepted).toBe(true)

        yield* Effect.sleep(500)

        const { relays } = yield* relayList.getRelayList(pubkey)
        expect(relays.length).toBe(1)
        expect(relays[0]?.url).toBe(newRelay.url)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("adds a relay to existing list", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        // Set initial relay
        const initialRelay: RelayEntry = {
          url: "wss://initial-relay.example.com",
          mode: "read",
        }
        yield* relayList.setRelayList([initialRelay], privateKey)
        yield* Effect.sleep(1100) // Wait for different timestamp

        // Add another relay
        const newRelay: RelayEntry = {
          url: "wss://new-relay.example.com",
          mode: "write",
        }
        yield* relayList.addRelay(newRelay, privateKey)
        yield* Effect.sleep(1100)

        const { relays } = yield* relayList.getRelayList(pubkey)
        expect(relays.length).toBe(2)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns success for existing relay with same mode", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const relay: RelayEntry = {
          url: "wss://existing-relay.example.com",
          mode: "both",
        }

        // Add relay
        yield* relayList.addRelay(relay, privateKey)
        yield* Effect.sleep(1100)

        // Try to add again with same mode
        const result = yield* relayList.addRelay(relay, privateKey)
        expect(result.accepted).toBe(true)
        expect(result.message).toBe("relay already exists")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("updates mode for existing relay", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        // Add relay with read mode
        const relayRead: RelayEntry = {
          url: "wss://mode-change.example.com",
          mode: "read",
        }
        yield* relayList.addRelay(relayRead, privateKey)
        yield* Effect.sleep(1100)

        // Update to write mode
        const relayWrite: RelayEntry = {
          url: "wss://mode-change.example.com",
          mode: "write",
        }
        yield* relayList.addRelay(relayWrite, privateKey)
        yield* Effect.sleep(1100)

        const { relays } = yield* relayList.getRelayList(pubkey)
        expect(relays.length).toBe(1)
        expect(relays[0]?.mode).toBe("write")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("removeRelay", () => {
    test("removes a relay from list", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        // Set initial relays
        yield* relayList.setRelayList(
          [
            { url: "wss://keep.example.com", mode: "both" },
            { url: "wss://remove.example.com", mode: "read" },
          ],
          privateKey
        )
        yield* Effect.sleep(1100)

        // Remove one
        yield* relayList.removeRelay("wss://remove.example.com", privateKey)
        yield* Effect.sleep(1100)

        const { relays } = yield* relayList.getRelayList(pubkey)
        expect(relays.length).toBe(1)
        expect(relays[0]?.url).toBe("wss://keep.example.com")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns success for non-existent relay", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const result = yield* relayList.removeRelay(
          "wss://nonexistent.example.com",
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(result.message).toBe("relay not in list")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("getReadRelays and getWriteRelays", () => {
    test("filters relays by mode", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        yield* relayList.setRelayList(
          [
            { url: "wss://both.example.com", mode: "both" },
            { url: "wss://read-only.example.com", mode: "read" },
            { url: "wss://write-only.example.com", mode: "write" },
          ],
          privateKey
        )
        yield* Effect.sleep(500)

        const readRelays = yield* relayList.getReadRelays(pubkey)
        const writeRelays = yield* relayList.getWriteRelays(pubkey)

        // Read relays: both + read-only
        expect(readRelays.length).toBe(2)
        expect(readRelays).toContain("wss://both.example.com")
        expect(readRelays).toContain("wss://read-only.example.com")

        // Write relays: both + write-only
        expect(writeRelays.length).toBe(2)
        expect(writeRelays).toContain("wss://both.example.com")
        expect(writeRelays).toContain("wss://write-only.example.com")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("replaceable event semantics", () => {
    test("newer relay list replaces older one", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const relayList = yield* RelayListService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        // Set first relay list
        yield* relayList.setRelayList(
          [{ url: "wss://old.example.com", mode: "both" }],
          privateKey
        )
        yield* Effect.sleep(1100) // Wait for different timestamp

        // Set second relay list (should replace)
        yield* relayList.setRelayList(
          [{ url: "wss://new.example.com", mode: "read" }],
          privateKey
        )
        yield* Effect.sleep(500)

        // Query should return only the newer list
        const { relays } = yield* relayList.getRelayList(pubkey)
        expect(relays.length).toBe(1)
        expect(relays[0]?.url).toBe("wss://new.example.com")
        expect(relays[0]?.mode).toBe("read")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })
})
