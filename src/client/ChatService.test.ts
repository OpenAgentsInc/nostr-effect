/**
 * Tests for ChatService (NIP-28)
 *
 * Test parity with nostr-tools nip28.test.ts
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { ChatService, ChatServiceLive, type ChannelMetadata } from "./ChatService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import type { EventId } from "../core/Schema.js"

// NIP-28 kinds as plain numbers for comparison
const CHANNEL_CREATE = 40
const CHANNEL_METADATA = 41
const CHANNEL_MESSAGE = 42
const CHANNEL_HIDE_MESSAGE = 43
const CHANNEL_MUTE_USER = 44

describe("ChatService (NIP-28)", () => {
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
        ChatServiceLive.pipe(
          Layer.provide(RelayLayer),
          Layer.provide(ServiceLayer)
        )
      )
    )
  }

  describe("createChannel (nostr-tools parity)", () => {
    test("creates channel with correct kind and metadata", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const metadata: ChannelMetadata = {
          name: "Test Channel",
          about: "This is a test channel",
          picture: "https://example.com/picture.jpg",
        }

        const event = yield* chatService.createChannel(
          { content: metadata },
          privateKey
        )

        // Matches nostr-tools nip28.test.ts assertions
        expect(event.kind as number).toBe(CHANNEL_CREATE)
        expect(event.content).toBe(JSON.stringify(metadata))
        expect(event.pubkey).toBe(pubkey)
        expect(typeof event.id).toBe("string")
        expect(typeof event.sig).toBe("string")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("creates channel with string content", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const content = '{"name": "String Channel", "about": "From string", "picture": ""}'

        const event = yield* chatService.createChannel(
          { content },
          privateKey
        )

        expect(event.kind as number).toBe(CHANNEL_CREATE)
        expect(event.content).toBe(content)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("updateChannelMetadata (nostr-tools parity)", () => {
    test("creates metadata event with e tag reference", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const channelCreateEventId = "channel_creation_event_id"
        const metadata: ChannelMetadata = {
          name: "Updated Channel",
          about: "Updated description",
          picture: "https://example.com/new.jpg",
        }

        const event = yield* chatService.updateChannelMetadata(
          {
            channelCreateEventId,
            content: metadata,
          },
          privateKey
        )

        // Matches nostr-tools nip28.test.ts assertions
        expect(event.kind as number).toBe(CHANNEL_METADATA)
        // Check that the e tag exists
        const eTag = event.tags.find(t => t[0] === "e" && t[1] === channelCreateEventId)
        expect(eTag).toBeDefined()
        expect(event.content).toBe(JSON.stringify(metadata))
        expect(event.pubkey).toBe(pubkey)
        expect(typeof event.id).toBe("string")
        expect(typeof event.sig).toBe("string")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("includes relay hint and root marker", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const event = yield* chatService.updateChannelMetadata(
          {
            channelCreateEventId: "channel_id",
            content: { name: "Test", about: "", picture: "" },
            relayUrl: "wss://relay.example.com",
          },
          privateKey
        )

        const firstTag = event.tags[0]!
        expect(firstTag[0]).toBe("e")
        expect(firstTag[1]).toBe("channel_id")
        expect(firstTag[2]).toBe("wss://relay.example.com")
        expect(firstTag[3]).toBe("root")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("includes category tags", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const event = yield* chatService.updateChannelMetadata(
          {
            channelCreateEventId: "channel_id",
            content: { name: "Test", about: "", picture: "" },
            categories: ["tech", "programming"],
          },
          privateKey
        )

        const techTag = event.tags.find(t => t[0] === "t" && t[1] === "tech")
        const progTag = event.tags.find(t => t[0] === "t" && t[1] === "programming")
        expect(techTag).toBeDefined()
        expect(progTag).toBeDefined()

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("sendMessage (nostr-tools parity)", () => {
    test("creates message event with root tag", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const channelCreateEventId = "channel_creation_event_id"
        const relayUrl = "wss://relay.example.com"
        const content = "Hello, world!"

        const event = yield* chatService.sendMessage(
          {
            channelCreateEventId,
            relayUrl,
            content,
          },
          privateKey
        )

        // Matches nostr-tools nip28.test.ts assertions
        expect(event.kind as number).toBe(CHANNEL_MESSAGE)
        const firstTag = event.tags[0]!
        expect(firstTag[0]).toBe("e")
        expect(firstTag[1]).toBe(channelCreateEventId)
        expect(firstTag[2]).toBe(relayUrl)
        expect(firstTag[3]).toBe("root")
        expect(event.content).toBe(content)
        expect(event.pubkey).toBe(pubkey)
        expect(typeof event.id).toBe("string")
        expect(typeof event.sig).toBe("string")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("creates reply event with root and reply tags", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const channelCreateEventId = "channel_creation_event_id"
        const replyToEventId = "channel_message_event_id"
        const relayUrl = "wss://relay.example.com"
        const content = "This is a reply!"

        const event = yield* chatService.sendMessage(
          {
            channelCreateEventId,
            relayUrl,
            content,
            replyToEventId,
          },
          privateKey
        )

        // Matches nostr-tools nip28.test.ts assertions for reply messages
        expect(event.kind as number).toBe(CHANNEL_MESSAGE)

        const rootTag = event.tags.find(tag => tag[0] === "e" && tag[1] === channelCreateEventId)
        expect(rootTag).toBeDefined()
        expect(rootTag![2]).toBe(relayUrl)
        expect(rootTag![3]).toBe("root")

        const replyTag = event.tags.find(tag => tag[0] === "e" && tag[1] === replyToEventId)
        expect(replyTag).toBeDefined()
        expect(replyTag![2]).toBe(relayUrl)
        expect(replyTag![3]).toBe("reply")

        expect(event.content).toBe(content)
        expect(event.pubkey).toBe(pubkey)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("hideMessage (nostr-tools parity)", () => {
    test("creates hide event with e tag and reason", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const channelMessageEventId = "channel_message_event_id"
        const reason = { reason: "Inappropriate content" }

        const event = yield* chatService.hideMessage(
          {
            channelMessageEventId,
            content: reason,
          },
          privateKey
        )

        // Matches nostr-tools nip28.test.ts assertions
        expect(event.kind as number).toBe(CHANNEL_HIDE_MESSAGE)
        const eTag = event.tags.find(t => t[0] === "e" && t[1] === channelMessageEventId)
        expect(eTag).toBeDefined()
        expect(event.content).toBe(JSON.stringify(reason))
        expect(event.pubkey).toBe(pubkey)
        expect(typeof event.id).toBe("string")
        expect(typeof event.sig).toBe("string")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("accepts string content", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const event = yield* chatService.hideMessage(
          {
            channelMessageEventId: "msg_id",
            content: '{"reason": "Spam"}',
          },
          privateKey
        )

        expect(event.content).toBe('{"reason": "Spam"}')

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("muteUser (nostr-tools parity)", () => {
    test("creates mute event with p tag and reason", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const pubkey = yield* crypto.getPublicKey(privateKey)

        const pubkeyToMute = "pubkey_to_mute"
        const reason = { reason: "Spamming" }

        const event = yield* chatService.muteUser(
          {
            pubkeyToMute,
            content: reason,
          },
          privateKey
        )

        // Matches nostr-tools nip28.test.ts assertions
        expect(event.kind as number).toBe(CHANNEL_MUTE_USER)
        const pTag = event.tags.find(t => t[0] === "p" && t[1] === pubkeyToMute)
        expect(pTag).toBeDefined()
        expect(event.content).toBe(JSON.stringify(reason))
        expect(event.pubkey).toBe(pubkey)
        expect(typeof event.id).toBe("string")
        expect(typeof event.sig).toBe("string")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("getChannel", () => {
    test("retrieves channel by creation event id", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const metadata: ChannelMetadata = {
          name: "Queryable Channel",
          about: "Can be queried",
          picture: "https://example.com/pic.jpg",
        }

        // Create channel
        const createEvent = yield* chatService.createChannel(
          { content: metadata },
          privateKey
        )

        yield* Effect.sleep(500)

        // Query channel
        const result = yield* chatService.getChannel(createEvent.id)

        expect(result.createEvent).toBeDefined()
        expect(result.createEvent?.id).toBe(createEvent.id)
        expect(result.metadata?.name).toBe(metadata.name)
        expect(result.metadata?.about).toBe(metadata.about)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns empty result for unknown channel", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService

        yield* relayService.connect()

        // Use a fake event ID
        const fakeChannelId = "0000000000000000000000000000000000000000000000000000000000000000" as EventId

        const result = yield* chatService.getChannel(fakeChannelId)

        expect(result.createEvent).toBeUndefined()
        expect(result.metadata).toBeUndefined()

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("getMessages", () => {
    test("retrieves messages from channel", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const chatService = yield* ChatService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        // Create channel
        const createEvent = yield* chatService.createChannel(
          {
            content: {
              name: "Message Test Channel",
              about: "Testing messages",
              picture: "",
            },
          },
          privateKey
        )

        yield* Effect.sleep(300)

        // Send messages
        yield* chatService.sendMessage(
          {
            channelCreateEventId: createEvent.id,
            relayUrl: `ws://localhost:${port}`,
            content: "First message",
          },
          privateKey
        )

        yield* chatService.sendMessage(
          {
            channelCreateEventId: createEvent.id,
            relayUrl: `ws://localhost:${port}`,
            content: "Second message",
          },
          privateKey
        )

        yield* Effect.sleep(500)

        // Get messages
        const messages = yield* chatService.getMessages(createEvent.id)

        expect(messages.length).toBeGreaterThanOrEqual(2)
        expect(messages.some(m => m.content === "First message")).toBe(true)
        expect(messages.some(m => m.content === "Second message")).toBe(true)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })
})

describe("Nip28Module", () => {
  test("has correct module configuration", async () => {
    const { Nip28Module } = await import("../relay/core/nip/modules/Nip28Module.js")

    expect(Nip28Module.id).toBe("nip-28")
    expect(Nip28Module.nips).toContain(28)
    expect(Nip28Module.kinds).toContain(CHANNEL_CREATE)
    expect(Nip28Module.kinds).toContain(CHANNEL_METADATA)
    expect(Nip28Module.kinds).toContain(CHANNEL_MESSAGE)
    expect(Nip28Module.kinds).toContain(CHANNEL_HIDE_MESSAGE)
    expect(Nip28Module.kinds).toContain(CHANNEL_MUTE_USER)
  })

  test("integrates with NipRegistry", async () => {
    const { Nip28Module } = await import("../relay/core/nip/modules/Nip28Module.js")
    const { NipRegistryLive, NipRegistry } = await import("../relay/core/nip/index.js")
    const { Effect } = await import("effect")

    const program = Effect.gen(function* () {
      const registry = yield* NipRegistry
      expect(registry.supportedNips).toContain(28)
      expect(registry.hasModule("nip-28")).toBe(true)
    })

    await Effect.runPromise(
      program.pipe(Effect.provide(NipRegistryLive([Nip28Module])))
    )
  })
})
