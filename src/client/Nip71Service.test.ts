/**
 * Tests for Nip71Service (NIP-71)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Nip71Service, Nip71ServiceLive } from "./Nip71Service.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("Nip71Service (NIP-71)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 25000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(ServiceLayer, Nip71ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish and list normal (21) and short (22) video with imeta variants", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip71Service
      const crypto = yield* CryptoService

      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()

      // Publish normal video (kind 21) with two imeta variants
      const res1 = yield* svc.publishVideo(
        {
          kind: 21,
          title: "My HD Video",
          publishedAt: Math.floor(Date.now() / 1000),
          alt: "Short description",
          content: "An example long video",
          hashtags: ["video", "demo"],
          links: ["https://example.com/post"],
          participants: [
            { pubkey: yield* crypto.getPublicKey(yield* crypto.generatePrivateKey()) },
          ],
          segments: [{ start: "00:00:00.000", end: "00:00:10.000", title: "Intro" }],
          textTracks: [{ encodedKind6000: "<6000_event_bech32>", relays: ["wss://relay.example"] }],
          imeta: [
            {
              dim: "1920x1080",
              url: "https://videos.example/1080/abc.mp4",
              x: "3093509d1e0bc604ff60cb9286f4cd7c781553bc8991937befaacfdc28ec5cdc",
              m: "video/mp4",
              images: ["https://videos.example/1080/abc.jpg"],
              fallbacks: ["https://cdn.example/1080/abc.mp4"],
              service: "nip96",
              bitrate: 3_000_000,
              duration: 29.223,
            },
            {
              dim: "1280x720",
              url: "https://videos.example/720/abc.mp4",
              m: "video/mp4",
              images: ["https://videos.example/720/abc.jpg"],
              fallbacks: ["https://cdn.example/720/abc.mp4"],
              duration: 29.24,
            },
          ],
        },
        sk
      )
      expect(res1.accepted).toBe(true)

      // Publish short video (kind 22) minimal
      const res2 = yield* svc.publishVideo(
        {
          kind: 22,
          title: "Short clip",
          imeta: [
            { url: "https://videos.example/shorts/xyz.mp4", m: "video/mp4", duration: 12.5 },
          ],
        },
        sk
      )
      expect(res2.accepted).toBe(true)

      // List videos
      const list = yield* svc.listVideos({ kinds: [21, 22], limit: 3, timeoutMs: 1500 })
      expect(list.length).toBeGreaterThanOrEqual(2)

      const found21 = list.find((x) => x.kind === 21)
      expect(found21?.title).toBe("My HD Video")
      expect(found21?.imeta.length).toBe(2)
      expect(found21?.imeta[0]?.url).toBe("https://videos.example/1080/abc.mp4")
      expect(found21?.imeta[0]?.bitrate).toBe(3_000_000)
      expect(found21?.imeta[0]?.duration).toBeCloseTo(29.223)
      expect(found21?.hashtags).toContain("video")
      expect(found21?.links[0]).toBe("https://example.com/post")

      const found22 = list.find((x) => x.kind === 22)
      expect(found22?.title).toBe("Short clip")
      expect(found22?.imeta[0]?.url).toBe("https://videos.example/shorts/xyz.mp4")

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})

