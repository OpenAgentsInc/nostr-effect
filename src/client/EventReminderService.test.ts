/**
 * Tests for EventReminderService (NIP-ER: Event Reminders)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import {
  EventReminderService,
  EventReminderServiceLive,
  REMINDER_KIND,
  parseNotBefore,
  parseReminderContent,
  isDue,
  getNotBefore,
  generateReminderId,
  type ReminderContent,
  type DecodedReminder,
} from "./EventReminderService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/backends/bun/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Nip44ServiceLive } from "../services/Nip44Service.js"

// ---------------------------------------------------------------------------
// Pure helper tests (no relay)
// ---------------------------------------------------------------------------

describe("NIP-ER helpers", () => {
  test("generateReminderId is a fresh 128-bit hex id", () => {
    const a = generateReminderId()
    const b = generateReminderId()
    expect(a).toMatch(/^[0-9a-f]{32}$/) // 16 bytes = 32 hex chars = 128 bits
    expect(a).not.toBe(b)
  })

  test("parseNotBefore accepts strict decimal timestamps", () => {
    expect(parseNotBefore("0")).toBe(0)
    expect(parseNotBefore("1770000000")).toBe(1770000000)
  })

  test("parseNotBefore rejects malformed values", () => {
    expect(parseNotBefore("01")).toBeNull() // leading zero
    expect(parseNotBefore("-1")).toBeNull() // sign
    expect(parseNotBefore("1.5")).toBeNull() // decimal
    expect(parseNotBefore(" 1 ")).toBeNull() // whitespace
    expect(parseNotBefore("")).toBeNull()
    expect(parseNotBefore("9007199254740992")).toBeNull() // out of range
    expect(parseNotBefore(undefined)).toBeNull()
  })

  test("getNotBefore returns null when duplicated", () => {
    expect(
      getNotBefore({ tags: [["not_before", "10"], ["not_before", "20"]] })
    ).toBeNull()
    expect(getNotBefore({ tags: [["not_before", "10"]] })).toBe(10)
  })

  test("parseReminderContent validates a target-backed pending reminder", () => {
    const plaintext = JSON.stringify({
      target: {
        a: "30023:79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798:proposal",
        id: "7b4f3c2a1e9d8c7061524334aabbccddeeff00112233445566778899aabbccdd",
        relays: ["wss://relay.example", "http://bad"],
        preview: "review this",
      },
      status: "pending",
      note: "follow up",
    })
    const parsed = parseReminderContent(plaintext)
    expect(parsed?.status).toBe("pending")
    expect(parsed?.target?.a?.startsWith("30023:")).toBe(true)
    // non-ws relay entries are dropped
    expect(parsed?.target?.relays).toEqual(["wss://relay.example"])
  })

  test("parseReminderContent accepts a note-only pending reminder", () => {
    const parsed = parseReminderContent(
      JSON.stringify({ status: "pending", note: "Submit travel receipt" })
    )
    expect(parsed?.note).toBe("Submit travel receipt")
    expect(parsed?.target).toBeUndefined()
  })

  test("parseReminderContent rejects pending with no target and no note", () => {
    expect(parseReminderContent(JSON.stringify({ status: "pending" }))).toBeNull()
  })

  test("parseReminderContent rejects unknown status and non-objects", () => {
    expect(parseReminderContent(JSON.stringify({ status: "snoozed", note: "x" }))).toBeNull()
    expect(parseReminderContent(JSON.stringify(["a"]))).toBeNull()
    expect(parseReminderContent("not json")).toBeNull()
  })

  test("parseReminderContent rejects malformed target refs", () => {
    expect(
      parseReminderContent(JSON.stringify({ status: "pending", target: { id: "SHORT" } }))
    ).toBeNull()
  })

  test("isDue reflects pending status and not_before boundary", () => {
    const base: DecodedReminder = {
      event: {} as never,
      address: "30300:pk:d",
      d: "d",
      notBefore: 100,
      content: { status: "pending" } as ReminderContent,
    }
    expect(isDue(base, 200)).toBe(true) // past due
    expect(isDue(base, 50)).toBe(false) // not yet
    expect(isDue({ ...base, content: { status: "done" } }, 200)).toBe(false) // terminal
    expect(isDue({ ...base, notBefore: null }, 200)).toBe(false) // bookmark
  })
})

// ---------------------------------------------------------------------------
// Relay round-trip tests
// ---------------------------------------------------------------------------

describe("EventReminderService (NIP-ER)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 28500 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.mergeAll(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive)),
      Nip44ServiceLive
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        EventReminderServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  test("create -> read round-trip self-decrypts the reminder", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EventReminderService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const content: ReminderContent = {
        status: "pending",
        note: "Follow up before planning",
        target: {
          a: "30023:79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798:proposal",
        },
      }
      const notBefore = Math.floor(Date.now() / 1000) + 3600
      const { result, d } = yield* svc.createReminder({ content, notBefore }, sk)
      expect(result.accepted).toBe(true)
      expect(d).toMatch(/^[0-9a-f]{32}$/)

      // Outer event should be opaque ciphertext with a public not_before tag.
      const latest = yield* svc.getReminder({ author, d, timeoutMs: 1500 })
      expect((latest?.kind as number) ?? 0).toBe(REMINDER_KIND)
      expect(latest?.content?.startsWith("{")).toBe(false) // encrypted, not JSON
      expect(getNotBefore(latest!)).toBe(notBefore)
      expect(latest?.tags.find((t) => t[0] === "alt")?.[1]).toBe("Encrypted reminder")
      expect(latest?.tags.some((t) => t[0] === "d" && t[1] === d)).toBe(true)

      // Self-decrypt recovers the plaintext body.
      const decrypted = yield* svc.decryptReminder({ event: latest!, authorPrivateKey: sk })
      expect(decrypted?.status).toBe("pending")
      expect(decrypted?.note).toBe("Follow up before planning")
      expect(decrypted?.target?.a?.startsWith("30023:")).toBe(true)

      // A different key must NOT be able to decrypt (encrypt-to-self).
      const otherSk = yield* crypto.generatePrivateKey()
      const other = yield* svc.decryptReminder({ event: latest!, authorPrivateKey: otherSk })
      expect(other).toBeNull()

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("note-only reminder round-trips and lists as due", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EventReminderService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const pastDue = Math.floor(Date.now() / 1000) - 60
      const { d } = yield* svc.createReminder(
        { content: { status: "pending", note: "Submit travel receipt" }, notBefore: pastDue },
        sk
      )

      const reminders = yield* svc.listReminders({ author, authorPrivateKey: sk, timeoutMs: 1500 })
      const mine = reminders.find((r) => r.d === d)
      expect(mine).toBeDefined()
      expect(mine?.notBefore).toBe(pastDue)
      expect(mine?.content?.note).toBe("Submit travel receipt")
      expect(isDue(mine!)).toBe(true)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("snooze replaces the addressable head with a later not_before", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EventReminderService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const now = Math.floor(Date.now() / 1000)
      const content: ReminderContent = { status: "pending", note: "ping me" }
      const { d } = yield* svc.createReminder(
        { content, notBefore: now + 100, createdAt: now },
        sk
      )

      // Replace same address with a later not_before and higher created_at.
      const snoozed = yield* svc.createReminder(
        { d, content, notBefore: now + 86400, createdAt: now + 10 },
        sk
      )
      expect(snoozed.result.accepted).toBe(true)
      expect(snoozed.d).toBe(d)

      const latest = yield* svc.getReminder({ author, d, timeoutMs: 1500 })
      expect(getNotBefore(latest!)).toBe(now + 86400)

      // Only one head remains for the address.
      const reminders = yield* svc.listReminders({ author, authorPrivateKey: sk, timeoutMs: 1500 })
      const matching = reminders.filter((r) => r.d === d)
      expect(matching.length).toBe(1)
      expect(matching[0]?.notBefore).toBe(now + 86400)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("complete omits not_before and adds an expiration; enforces expiration > not_before", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EventReminderService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const now = Math.floor(Date.now() / 1000)
      const { d } = yield* svc.createReminder(
        { content: { status: "pending", note: "task" }, notBefore: now + 100, createdAt: now },
        sk
      )

      // Complete = done replacement, not_before dropped, expiration set.
      const done = yield* svc.createReminder(
        {
          d,
          content: { status: "done", note: "task" },
          notBefore: now + 100, // must be ignored for terminal status
          expiration: now + 90 * 86400,
          createdAt: now + 20,
        },
        sk
      )
      expect(done.result.accepted).toBe(true)

      const latest = yield* svc.getReminder({ author, d, timeoutMs: 1500 })
      expect(getNotBefore(latest!)).toBeNull() // not_before omitted
      expect(latest?.tags.some((t) => t[0] === "expiration")).toBe(true)
      const decrypted = yield* svc.decryptReminder({ event: latest!, authorPrivateKey: sk })
      expect(decrypted?.status).toBe("done")

      // expiration <= not_before is rejected client-side.
      const bad = yield* svc
        .createReminder(
          {
            content: { status: "pending", note: "bad" },
            notBefore: now + 1000,
            expiration: now + 500,
          },
          sk
        )
        .pipe(
          Effect.matchEffect({
            onFailure: (e) => Effect.succeed(e.message),
            onSuccess: () => Effect.succeed("unexpected success"),
          })
        )
      expect(bad).toMatch(/expiration/)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("cancelReminder writes a terminal 'cancelled' replacement without not_before", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EventReminderService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const now = Math.floor(Date.now() / 1000)
      const content: ReminderContent = { status: "pending", note: "cancel me" }
      const { d } = yield* svc.createReminder(
        { content, notBefore: now + 100, createdAt: now },
        sk
      )

      const cancelled = yield* svc.cancelReminder(
        { d, content, expiration: now + 30 * 86400, createdAt: now + 5 },
        sk
      )
      expect(cancelled.result.accepted).toBe(true)

      const latest = yield* svc.getReminder({ author, d, timeoutMs: 1500 })
      expect(getNotBefore(latest!)).toBeNull()
      const decrypted = yield* svc.decryptReminder({ event: latest!, authorPrivateKey: sk })
      expect(decrypted?.status).toBe("cancelled")
      expect(decrypted?.note).toBe("cancel me")
      // A cancelled reminder is never due.
      const reminders = yield* svc.listReminders({ author, authorPrivateKey: sk, timeoutMs: 1500 })
      const mine = reminders.find((r) => r.d === d)
      expect(isDue(mine!)).toBe(false)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("deleteReminder publishes a NIP-09 request with a/k tags", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EventReminderService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const { d } = yield* svc.createReminder(
        { content: { status: "pending", note: "delete me" } },
        sk
      )

      const del = yield* svc.deleteReminder({ d, reason: "cleanup" }, sk)
      expect(del.accepted).toBe(true)

      // The reminder head is gone after NIP-09 deletion.
      const latest = yield* svc.getReminder({ author, d, timeoutMs: 1500 })
      expect(latest).toBeNull()

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
