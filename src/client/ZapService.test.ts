/**
 * Tests for ZapService (NIP-57)
 *
 * Test parity with nostr-tools nip57.test.ts
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { ZapService, ZapServiceLive } from "./ZapService.js"
import { makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import type { NostrEvent } from "../core/Schema.js"
import { ZAP_REQUEST_KIND, ZAP_RECEIPT_KIND } from "../core/Schema.js"

describe("ZapService (NIP-57)", () => {
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
        ZapServiceLive.pipe(Layer.provide(ServiceLayer))
      )
    )
  }

  describe("validateZapRequest (nostr-tools parity)", () => {
    test("returns an error message for invalid JSON", async () => {
      const program = Effect.gen(function* () {
        const zapService = yield* ZapService
        const result = yield* zapService.validateZapRequest("invalid JSON")
        expect(result).toBe("Invalid zap request JSON.")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns an error message if the Zap request is not a valid Nostr event", async () => {
      const program = Effect.gen(function* () {
        const zapService = yield* ZapService

        const zapRequest = {
          kind: 1234,
          created_at: Math.floor(Date.now() / 1000),
          content: "content",
          tags: [
            ["p", "profile"],
            ["amount", "100"],
            ["relays", "relay1", "relay2"],
          ],
        }

        const result = yield* zapService.validateZapRequest(JSON.stringify(zapRequest))
        expect(result).toBe("Zap request is not a valid Nostr event.")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns an error message if the signature on the Zap request is invalid", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService

        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const zapRequest = {
          id: "0000000000000000000000000000000000000000000000000000000000000000",
          pubkey: publicKey,
          kind: 9734,
          created_at: Math.floor(Date.now() / 1000),
          content: "content",
          sig: "0".repeat(128),
          tags: [
            ["p", publicKey],
            ["amount", "100"],
            ["relays", "relay1", "relay2"],
          ],
        }

        const result = yield* zapService.validateZapRequest(JSON.stringify(zapRequest))
        expect(result).toBe("Invalid signature on zap request.")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns an error message if the Zap request does not have a 'p' tag", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()

        const event = yield* eventService.createEvent(
          {
            kind: ZAP_REQUEST_KIND,
            content: "content",
            tags: [
              ["amount", "100"] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["relays", "relay1", "relay2"] as unknown as typeof import("../core/Schema.js").Tag.Type,
            ],
          },
          privateKey
        )

        const result = yield* zapService.validateZapRequest(JSON.stringify(event))
        expect(result).toBe("Zap request doesn't have a 'p' tag.")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns an error message if the 'p' tag on the Zap request is not valid hex", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()

        const event = yield* eventService.createEvent(
          {
            kind: ZAP_REQUEST_KIND,
            content: "content",
            tags: [
              ["p", "invalid hex"] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["amount", "100"] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["relays", "relay1", "relay2"] as unknown as typeof import("../core/Schema.js").Tag.Type,
            ],
          },
          privateKey
        )

        const result = yield* zapService.validateZapRequest(JSON.stringify(event))
        expect(result).toBe("Zap request 'p' tag is not valid hex.")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns an error message if the 'e' tag on the Zap request is not valid hex", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const event = yield* eventService.createEvent(
          {
            kind: ZAP_REQUEST_KIND,
            content: "content",
            tags: [
              ["p", publicKey] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["e", "invalid hex"] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["amount", "100"] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["relays", "relay1", "relay2"] as unknown as typeof import("../core/Schema.js").Tag.Type,
            ],
          },
          privateKey
        )

        const result = yield* zapService.validateZapRequest(JSON.stringify(event))
        expect(result).toBe("Zap request 'e' tag is not valid hex.")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns an error message if the Zap request does not have a relays tag", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const event = yield* eventService.createEvent(
          {
            kind: ZAP_REQUEST_KIND,
            content: "content",
            tags: [
              ["p", publicKey] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["amount", "100"] as unknown as typeof import("../core/Schema.js").Tag.Type,
            ],
          },
          privateKey
        )

        const result = yield* zapService.validateZapRequest(JSON.stringify(event))
        expect(result).toBe("Zap request doesn't have a 'relays' tag.")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns null for a valid Zap request", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)

        const event = yield* eventService.createEvent(
          {
            kind: ZAP_REQUEST_KIND,
            content: "content",
            tags: [
              ["p", publicKey] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["amount", "100"] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["relays", "relay1", "relay2"] as unknown as typeof import("../core/Schema.js").Tag.Type,
            ],
          },
          privateKey
        )

        const result = yield* zapService.validateZapRequest(JSON.stringify(event))
        expect(result).toBeNull()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("makeZapReceipt (nostr-tools parity)", () => {
    test("returns a valid Zap receipt with a preimage", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)
        const target = "efeb5d6e74ce6ffea6cae4094a9f29c26b5c56d7b44fae9f490f3410fd708c45"

        // Create a zap request
        const zapRequestEvent = yield* eventService.createEvent(
          {
            kind: ZAP_REQUEST_KIND,
            content: "content",
            tags: [
              ["p", target] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["amount", "100"] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["relays", "relay1", "relay2"] as unknown as typeof import("../core/Schema.js").Tag.Type,
            ],
          },
          privateKey
        )

        const zapRequest = JSON.stringify(zapRequestEvent)
        const preimage = "preimage"
        const bolt11 = "bolt11"
        const paidAt = new Date()

        const result = yield* zapService.makeZapReceipt(
          { zapRequest, preimage, bolt11, paidAt },
          privateKey
        )

        expect(result.kind as number).toBe(ZAP_RECEIPT_KIND as number)
        expect(result.created_at).toBeCloseTo(paidAt.getTime() / 1000, 0)
        expect(result.content).toBe("")

        // Check tags
        const bolt11Tag = result.tags.find(t => t[0] === "bolt11" && t[1] === bolt11)
        expect(bolt11Tag).toBeDefined()

        const descriptionTag = result.tags.find(t => t[0] === "description" && t[1] === zapRequest)
        expect(descriptionTag).toBeDefined()

        const pTag = result.tags.find(t => t[0] === "p" && t[1] === target)
        expect(pTag).toBeDefined()

        const PTag = result.tags.find(t => t[0] === "P" && t[1] === publicKey)
        expect(PTag).toBeDefined()

        const preimageTag = result.tags.find(t => t[0] === "preimage" && t[1] === preimage)
        expect(preimageTag).toBeDefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns a valid Zap receipt without a preimage", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()
        const publicKey = yield* crypto.getPublicKey(privateKey)
        const target = "efeb5d6e74ce6ffea6cae4094a9f29c26b5c56d7b44fae9f490f3410fd708c45"

        // Create a zap request
        const zapRequestEvent = yield* eventService.createEvent(
          {
            kind: ZAP_REQUEST_KIND,
            content: "content",
            tags: [
              ["p", target] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["amount", "100"] as unknown as typeof import("../core/Schema.js").Tag.Type,
              ["relays", "relay1", "relay2"] as unknown as typeof import("../core/Schema.js").Tag.Type,
            ],
          },
          privateKey
        )

        const zapRequest = JSON.stringify(zapRequestEvent)
        const bolt11 = "bolt11"
        const paidAt = new Date()

        const result = yield* zapService.makeZapReceipt(
          { zapRequest, bolt11, paidAt },
          privateKey
        )

        expect(result.kind as number).toBe(ZAP_RECEIPT_KIND as number)
        expect(result.created_at).toBeCloseTo(paidAt.getTime() / 1000, 0)
        expect(result.content).toBe("")

        // Check tags
        const bolt11Tag = result.tags.find(t => t[0] === "bolt11" && t[1] === bolt11)
        expect(bolt11Tag).toBeDefined()

        const descriptionTag = result.tags.find(t => t[0] === "description")
        expect(descriptionTag).toBeDefined()

        const pTag = result.tags.find(t => t[0] === "p" && t[1] === target)
        expect(pTag).toBeDefined()

        const PTag = result.tags.find(t => t[0] === "P" && t[1] === publicKey)
        expect(PTag).toBeDefined()

        // Should NOT have preimage tag
        const preimageTag = result.tags.find(t => t[0] === "preimage")
        expect(preimageTag).toBeUndefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("getSatoshisAmountFromBolt11 (nostr-tools parity)", () => {
    test("parses the amount from bolt11 invoices", async () => {
      const program = Effect.gen(function* () {
        const zapService = yield* ZapService

        // Test cases from nostr-tools
        expect(
          zapService.getSatoshisAmountFromBolt11(
            "lnbc4u1p5zcarnpp5djng98r73nxu66nxp6gndjkw24q7rdzgp7p80lt0gk4z3h3krkssdq9tfpygcqzzsxqzjcsp58hz3v5qefdm70g5fnm2cn6q9thzpu6m4f5wjqurhur5xzmf9vl3s9qxpqysgq9v6qv86xaruzeak9jjyz54fygrkn526z7xhm0llh8wl44gcgh0rznhjqdswd4cjurzdgh0pgzrfj4sd7f3mf89jd6kadse008ex7kxgqqa5xrk"
          )
        ).toEqual(400)

        expect(
          zapService.getSatoshisAmountFromBolt11(
            "lnbc8400u1p5zcaz5pp5ltvyhtg4ed7sd8jurj28ugmavezkmqsadpe3t9npufpcrd0uet0scqzyssp5l3hz4ayt5ee0p83ma4a96l2rruhx33eyycewldu2ffa5pk2qx7jq9q7sqqqqqqqqqqqqqqqqqqqsqqqqqysgqdq8w3jhxaqmqz9gxqyjw5qrzjqwryaup9lh50kkranzgcdnn2fgvx390wgj5jd07rwr3vxeje0glclll8qkt3np4rqyqqqqlgqqqqqeqqjqhuhjk5u9r850ncxngne7cfp9s08s2nm6c2rkz7jhl8gjmlx0fga5tlncgeuh4avlsrkq6ljyyhgq8rrxprga03esqhd0gf5455x6tdcqahhw9q"
          )
        ).toEqual(840000)

        expect(
          zapService.getSatoshisAmountFromBolt11(
            "lnbc210n1p5zcuaxpp52nn778cfk46md4ld0hdj2juuzvfrsrdaf4ek2k0yeensae07x2cqdq9tfpygcqzzsxqzjcsp5768c4k79jtnq92pgppan8rjnujcpcqhnqwqwk3lm5dfr7e0k2a7s9qxpqysgqt8lnh9l7ple27t73x7gty570ltas2s33uahc7egke5tdmhxr3ezn590wf2utxyt7d3afnk2lxc2u0enc6n53ck4mxwpmzpxa7ws05aqp0c5x3r"
          )
        ).toEqual(21)

        expect(
          zapService.getSatoshisAmountFromBolt11(
            "lnbc899640n1p5zcuavpp5w72fqrf09286lq33vw364qryrq5nw60z4dhdx56f8w05xkx4massdq9tfpygcqzzsxqzjcsp5qrqn4kpvem5jwpl63kj5pfdlqxg2plaffz0prz7vaqjy29uc66us9qxpqysgqlhzzqmn2jxd2476404krm8nvrarymwq7nj2zecl92xug54ek0mfntdxvxwslf756m8kq0r7jtpantm52fmewc72r5lfmd85505jnemgqw5j0pc"
          )
        ).toEqual(89964)
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("makeZapRequest", () => {
    test("creates a zap request for a profile", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService

        const privateKey = yield* crypto.generatePrivateKey()
        const recipientPubkey = "efeb5d6e74ce6ffea6cae4094a9f29c26b5c56d7b44fae9f490f3410fd708c45"

        const event = yield* zapService.makeZapRequest(
          {
            pubkey: recipientPubkey,
            amount: 21000,
            relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
            comment: "Great post!",
          },
          privateKey
        )

        expect(event.kind as number).toBe(ZAP_REQUEST_KIND as number)
        expect(event.content).toBe("Great post!")

        // Check p tag
        const pTag = event.tags.find(t => t[0] === "p" && t[1] === recipientPubkey)
        expect(pTag).toBeDefined()

        // Check amount tag
        const amountTag = event.tags.find(t => t[0] === "amount" && t[1] === "21000")
        expect(amountTag).toBeDefined()

        // Check relays tag
        const relaysTag = event.tags.find(t => t[0] === "relays")
        expect(relaysTag).toBeDefined()
        expect(relaysTag).toContain("wss://relay1.example.com")
        expect(relaysTag).toContain("wss://relay2.example.com")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("creates a zap request for an event", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()
        const targetPubkey = "efeb5d6e74ce6ffea6cae4094a9f29c26b5c56d7b44fae9f490f3410fd708c45"

        // Create a target event to zap (normal kind 1 note)
        const targetEvent = yield* eventService.createEvent(
          {
            kind: 1 as typeof ZAP_REQUEST_KIND,
            content: "Hello Nostr!",
            tags: [],
          },
          privateKey
        )
        // Override pubkey for test
        const fakeTargetEvent = { ...targetEvent, pubkey: targetPubkey }

        const event = yield* zapService.makeZapRequest(
          {
            event: fakeTargetEvent as unknown as NostrEvent,
            amount: 100000,
            relays: ["wss://relay.example.com"],
            comment: "Zapping this note!",
          },
          privateKey
        )

        expect(event.kind as number).toBe(ZAP_REQUEST_KIND as number)

        // Check p tag (from event author)
        const pTag = event.tags.find(t => t[0] === "p" && t[1] === targetPubkey)
        expect(pTag).toBeDefined()

        // Check e tag (event id)
        const eTag = event.tags.find(t => t[0] === "e")
        expect(eTag).toBeDefined()

        // Check k tag (event kind)
        const kTag = event.tags.find(t => t[0] === "k" && t[1] === "1")
        expect(kTag).toBeDefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("includes lnurl tag when provided", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService

        const privateKey = yield* crypto.generatePrivateKey()
        const recipientPubkey = "efeb5d6e74ce6ffea6cae4094a9f29c26b5c56d7b44fae9f490f3410fd708c45"
        const lnurl = "lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq5fns"

        const event = yield* zapService.makeZapRequest(
          {
            pubkey: recipientPubkey,
            amount: 21000,
            relays: ["wss://relay.example.com"],
            lnurl,
          },
          privateKey
        )

        const lnurlTag = event.tags.find(t => t[0] === "lnurl" && t[1] === lnurl)
        expect(lnurlTag).toBeDefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("getZapEndpoint", () => {
    test("extracts endpoint from lud16 (lightning address)", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()

        // Create a metadata event with lud16
        const metadata = yield* eventService.createEvent(
          {
            kind: 0 as typeof ZAP_REQUEST_KIND,
            content: JSON.stringify({
              name: "Test User",
              lud16: "user@example.com",
            }),
            tags: [],
          },
          privateKey
        )

        const endpoint = yield* zapService.getZapEndpoint(metadata)
        expect(endpoint).toBe("https://example.com/.well-known/lnurlp/user")
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns null for invalid metadata", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()

        const metadata = yield* eventService.createEvent(
          {
            kind: 0 as typeof ZAP_REQUEST_KIND,
            content: "not valid json{",
            tags: [],
          },
          privateKey
        )

        const endpoint = yield* zapService.getZapEndpoint(metadata)
        expect(endpoint).toBeNull()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("returns null for metadata without lightning info", async () => {
      const program = Effect.gen(function* () {
        const crypto = yield* CryptoService
        const zapService = yield* ZapService
        const eventService = yield* EventService

        const privateKey = yield* crypto.generatePrivateKey()

        const metadata = yield* eventService.createEvent(
          {
            kind: 0 as typeof ZAP_REQUEST_KIND,
            content: JSON.stringify({ name: "No Lightning User" }),
            tags: [],
          },
          privateKey
        )

        const endpoint = yield* zapService.getZapEndpoint(metadata)
        expect(endpoint).toBeNull()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })
})

describe("Nip57Module", () => {
  test("has correct module configuration", async () => {
    const { Nip57Module } = await import("../relay/core/nip/modules/Nip57Module.js")

    expect(Nip57Module.id).toBe("nip-57")
    expect(Nip57Module.nips).toContain(57)
    expect(Nip57Module.kinds).toContain(ZAP_REQUEST_KIND as number)
    expect(Nip57Module.kinds).toContain(ZAP_RECEIPT_KIND as number)
  })

  test("integrates with NipRegistry", async () => {
    const { Nip57Module } = await import("../relay/core/nip/modules/Nip57Module.js")
    const { NipRegistryLive, NipRegistry } = await import("../relay/core/nip/index.js")
    const { Effect } = await import("effect")

    const program = Effect.gen(function* () {
      const registry = yield* NipRegistry
      expect(registry.supportedNips).toContain(57)
      expect(registry.hasModule("nip-57")).toBe(true)
    })

    await Effect.runPromise(
      program.pipe(Effect.provide(NipRegistryLive([Nip57Module])))
    )
  })
})
