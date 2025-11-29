/**
 * Tests for Nip52Service (NIP-52)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { Nip52Service, Nip52ServiceLive } from "./Nip52Service.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("Nip52Service (NIP-52)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 22000 + Math.floor(Math.random() * 10000)
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
      Layer.merge(ServiceLayer, Nip52ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish date event and fetch by d", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip52Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const r = yield* svc.publishDateEvent({ d: "day-1", title: "Holiday", content: "Off", start: "2025-01-01" }, sk)
      expect(r.accepted).toBe(true)

      const evt = yield* svc.getByD(31922, pk, "day-1")
      expect(evt?.kind as number).toBe(31922)
      expect(evt?.tags.find((t) => t[0] === "start")?.[1]).toBe("2025-01-01")
      expect(evt?.tags.find((t) => t[0] === "title")?.[1]).toBe("Holiday")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("publish time event with tz and calendar ref", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip52Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const calendar = yield* svc.publishCalendar({ d: "cal-main", title: "Meetups" }, sk)
      expect(calendar.accepted).toBe(true)

      const r = yield* svc.publishTimeEvent(
        {
          d: "meet-1",
          title: "Weekly",
          content: "Standup",
          start: Math.floor(Date.now() / 1000),
          start_tzid: "UTC",
          calendarRefs: [{ kind: 31924, pubkey: pk, d: "cal-main" }],
        },
        sk
      )
      expect(r.accepted).toBe(true)

      const evt = yield* svc.getByD(31923, pk, "meet-1")
      expect(evt?.kind as number).toBe(31923)
      expect(evt?.tags.find((t) => t[0] === "start_tzid")?.[1]).toBe("UTC")
      const a = evt?.tags.find((t) => t[0] === "a")?.[1]
      expect(a?.startsWith("31924:"))

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("publish RSVP for event", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* Nip52Service
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      yield* svc.publishDateEvent({ d: "day-2", title: "Holiday 2", start: "2025-02-01" }, sk)

      const rsvp = yield* svc.publishRsvp(
        { a: { kind: 31922, pubkey: pk, d: "day-2" }, d: "rsvp-1", status: "accepted" },
        sk
      )
      expect(rsvp.accepted).toBe(true)

      const evt = yield* svc.getByD(31925, pk, "rsvp-1")
      expect(evt?.kind as number).toBe(31925)
      expect(evt?.tags.find((t) => t[0] === "status")?.[1]).toBe("accepted")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
