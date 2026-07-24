/**
 * Tests for PushLeaseService (NIP-PL: Push Leases — wire format only)
 */
import { test, expect, describe, beforeAll, afterAll } from "vite-plus/test"
import { Effect, Layer } from "effect"
import {
  PushLeaseService,
  PushLeaseServiceLive,
  PUSH_LEASE_KIND,
  generateInstallationId,
  parseJsonRejectDuplicates,
  parseLeaseContent,
  validateLeaseFilter,
  validateLeasePublicTags,
  validateLeaseTtl,
  validateLeaseContent,
  getLeaseD,
  getLeaseExec,
  getLeaseExpiration,
  comparePriorityClass,
  maxPriorityClass,
  serializeLeaseContent,
  type ActiveLeaseContent,
  type InactiveLeaseContent,
} from "./PushLeaseService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/backends/node/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Nip44ServiceLive } from "../services/Nip44Service.js"

const SELF =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const OTHER =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
const EVENT_ID =
  "7b4f3c2a1e9d8c7061524334aabbccddeeff00112233445566778899aabbccdd"
const CHANNEL =
  "550e8400-e29b-41d4-a716-446655440000"

// ---------------------------------------------------------------------------
// Pure helper tests (no relay)
// ---------------------------------------------------------------------------

describe("NIP-PL helpers", () => {
  test("generateInstallationId is a fresh 128-bit hex id", () => {
    const a = generateInstallationId()
    const b = generateInstallationId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  test("parseJsonRejectDuplicates accepts valid JSON", () => {
    const r = parseJsonRejectDuplicates('{"v":1,"origin":"x"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect((r.value as { v: number }).v).toBe(1)
    }
  })

  test("parseJsonRejectDuplicates rejects duplicate keys", () => {
    const r = parseJsonRejectDuplicates('{"v":1,"v":2}')
    expect(r.ok).toBe(false)
  })

  test("parseJsonRejectDuplicates rejects nested duplicate keys", () => {
    const nested = parseJsonRejectDuplicates('{"outer":{"a":1,"a":2}}')
    expect(nested.ok).toBe(false)
  })

  test("priority class ordering", () => {
    expect(comparePriorityClass("silent", "urgent")).toBeLessThan(0)
    expect(comparePriorityClass("urgent", "default")).toBeGreaterThan(0)
    expect(maxPriorityClass(["silent", "time_sensitive", "default"])).toBe(
      "time_sensitive"
    )
    expect(maxPriorityClass([])).toBeNull()
  })

  test("validateLeasePublicTags requires d/expiration/exec and allows one alt", () => {
    expect(
      validateLeasePublicTags([
        ["d", "abc"],
        ["expiration", "2000000000"],
        ["exec", "2026-06"],
        ["alt", "Push lease"],
      ]).ok
    ).toBe(true)

    expect(
      validateLeasePublicTags([
        ["d", "abc"],
        ["expiration", "2000000000"],
        ["exec", "2026-06"],
        ["filter", "nope"],
      ]).ok
    ).toBe(false)

    expect(
      validateLeasePublicTags([
        ["d", "abc"],
        ["d", "def"],
        ["expiration", "2000000000"],
        ["exec", "2026-06"],
      ]).ok
    ).toBe(false)

    expect(
      validateLeasePublicTags([
        ["d", "abc"],
        ["expiration", "2000000000"],
        ["exec", "2026-06"],
        ["alt", "a"],
        ["alt", "b"],
      ]).ok
    ).toBe(false)

    // extra tag value
    expect(
      validateLeasePublicTags([
        ["d", "abc", "extra"],
        ["expiration", "2000000000"],
        ["exec", "2026-06"],
      ]).ok
    ).toBe(false)
  })

  test("getLeaseD/Exec/Expiration parse single well-formed tags", () => {
    const tags = [
      ["d", "inst1"],
      ["expiration", "2000000000"],
      ["exec", "2026-06"],
    ] as const
    expect(getLeaseD({ tags })).toBe("inst1")
    expect(getLeaseExec({ tags })).toBe("2026-06")
    expect(getLeaseExpiration({ tags })).toBe(2000000000)
    expect(getLeaseD({ tags: [["d", "a"], ["d", "b"]] })).toBeNull()
    expect(getLeaseExpiration({ tags: [["expiration", "01"]] })).toBeNull()
  })

  test("validateLeaseTtl enforces window", () => {
    const now = 1_700_000_000
    expect(validateLeaseTtl(now + 3600, now).ok).toBe(true)
    expect(validateLeaseTtl(now - 10_000, now).ok).toBe(false) // expired
    expect(validateLeaseTtl(now + 3_000_000, now).ok).toBe(false) // ttl too long
  })

  test("validateLeaseFilter requires narrowing selector", () => {
    const bare = validateLeaseFilter({ kinds: [9] }, SELF)
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.reason).toContain("not narrowed")
  })

  test("validateLeaseFilter accepts self #p narrowing", () => {
    const ok = validateLeaseFilter(
      { kinds: [9], "#p": [SELF] },
      SELF,
      { pushKinds: [9, 1059] }
    )
    expect(ok.ok).toBe(true)
  })

  test("validateLeaseFilter rejects other-user #p", () => {
    const bad = validateLeaseFilter({ kinds: [9], "#p": [OTHER] }, SELF)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain("p-tag must be self")
  })

  test("validateLeaseFilter rejects non-exact / mixed-case hex", () => {
    expect(
      validateLeaseFilter({ kinds: [9], authors: ["ABCD".repeat(16)] }, SELF).ok
    ).toBe(false)
    expect(
      validateLeaseFilter({ kinds: [9], authors: ["ab"] }, SELF).ok
    ).toBe(false)
    expect(
      validateLeaseFilter({ kinds: [9], "#e": ["nothex"] }, SELF, undefined, {
        requireNarrowing: false,
      }).ok
    ).toBe(false)
  })

  test("validateLeaseFilter rejects since/until/ids/limit/search", () => {
    for (const banned of [
      { since: 1 },
      { until: 1 },
      { ids: [EVENT_ID] },
      { limit: 10 },
      { search: "hello" },
    ]) {
      const r = validateLeaseFilter(
        { kinds: [9], "#p": [SELF], ...banned },
        SELF
      )
      expect(r.ok).toBe(false)
    }
  })

  test("validateLeaseFilter rejects ephemeral kinds and non-push kinds", () => {
    expect(
      validateLeaseFilter({ kinds: [20000], "#p": [SELF] }, SELF).ok
    ).toBe(false)
    expect(
      validateLeaseFilter(
        { kinds: [1], "#p": [SELF] },
        SELF,
        { pushKinds: [9] }
      ).ok
    ).toBe(false)
  })

  test("validateLeaseFilter enforces uuid-v4-lowercase h_grammar", () => {
    const good = validateLeaseFilter(
      { kinds: [9], "#h": [CHANNEL] },
      SELF,
      { hGrammar: "uuid-v4-lowercase", pushKinds: [9] }
    )
    expect(good.ok).toBe(true)

    const bad = validateLeaseFilter(
      { kinds: [9], "#h": ["not-a-uuid"] },
      SELF,
      { hGrammar: "uuid-v4-lowercase", pushKinds: [9] }
    )
    expect(bad.ok).toBe(false)
  })

  test("ignore filters skip the narrowing requirement", () => {
    const r = validateLeaseFilter(
      { kinds: [9] },
      SELF,
      { pushKinds: [9] },
      { requireNarrowing: false }
    )
    expect(r.ok).toBe(true)
  })

  test("validateLeaseContent accepts active and inactive schemas", () => {
    const active: ActiveLeaseContent = {
      v: 1,
      origin: "wss://relay.example",
      app_profile: "com.example.app/ios",
      transport: "apns",
      endpoint: "token-abc",
      generation: 1,
      active: true,
      subscriptions: [
        {
          filter: { kinds: [9], "#p": [SELF] },
          class: "time_sensitive",
          ignore: [{ kinds: [9], authors: [OTHER] }],
          suppress: { p_tags_max: 20 },
        },
      ],
    }
    const a = validateLeaseContent(active, SELF, { pushKinds: [9] })
    expect(a.ok).toBe(true)

    const inactive: InactiveLeaseContent = {
      v: 1,
      origin: "wss://relay.example",
      generation: 2,
      active: false,
    }
    expect(validateLeaseContent(inactive, SELF).ok).toBe(true)
  })

  test("validateLeaseContent rejects unknown fields and inactive extras", () => {
    expect(
      validateLeaseContent(
        {
          v: 1,
          origin: "o",
          generation: 1,
          active: false,
          endpoint: "should-not-be-here",
        },
        SELF
      ).ok
    ).toBe(false)

    expect(
      validateLeaseContent(
        {
          v: 1,
          origin: "o",
          app_profile: "p",
          transport: "apns",
          endpoint: "e",
          generation: 1,
          active: true,
          subscriptions: [{ filter: { kinds: [9], "#p": [SELF] }, class: "default" }],
          extra: true,
        },
        SELF,
        { pushKinds: [9] }
      ).ok
    ).toBe(false)
  })

  test("parseLeaseContent rejects duplicate keys in plaintext", () => {
    const bad = '{"v":1,"origin":"o","generation":1,"active":false,"active":true}'
    expect(parseLeaseContent(bad, SELF)).toBeNull()
  })

  test("serializeLeaseContent round-trips through parseLeaseContent", () => {
    const content: ActiveLeaseContent = {
      v: 1,
      origin: "wss://relay.example",
      app_profile: "com.example.app/ios",
      transport: "apns",
      endpoint: "opaque-grant",
      generation: 3,
      active: true,
      subscriptions: [
        {
          filter: { kinds: [9], "#p": [SELF], "#h": [CHANNEL] },
          class: "default",
        },
      ],
    }
    const text = serializeLeaseContent(content)
    const parsed = parseLeaseContent(text, SELF, {
      pushKinds: [9],
      hGrammar: "uuid-v4-lowercase",
    })
    expect(parsed).toEqual(content)
  })
})

// ---------------------------------------------------------------------------
// Relay round-trip tests
// ---------------------------------------------------------------------------

describe("PushLeaseService (NIP-PL wire format)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 28600 + Math.floor(Math.random() * 10000)
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
        PushLeaseServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  test("create -> read round-trip encrypts to executor and decrypts", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* PushLeaseService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const authorSk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(authorSk)
      const executorSk = yield* crypto.generatePrivateKey()
      const executorPub = yield* crypto.getPublicKey(executorSk)

      const expiration = Math.floor(Date.now() / 1000) + 86_400
      const content: ActiveLeaseContent = {
        v: 1,
        origin: "wss://relay.example",
        app_profile: "com.example.app/ios",
        transport: "apns",
        endpoint: "endpoint-token-xyz",
        generation: 1,
        active: true,
        subscriptions: [
          {
            filter: { kinds: [9], "#p": [author] },
            class: "time_sensitive",
            suppress: { p_tags_max: 20 },
          },
        ],
      }

      const { result, d } = yield* svc.createLease(
        {
          expiration,
          exec: "2026-06",
          executorPubkey: executorPub,
          content,
          limits: { pushKinds: [9] },
        },
        authorSk
      )
      expect(result.accepted).toBe(true)
      expect(d).toMatch(/^[0-9a-f]{32}$/)

      const latest = yield* svc.getLease({ author, d, timeoutMs: 1500 })
      expect((latest?.kind as number) ?? 0).toBe(PUSH_LEASE_KIND)
      expect(latest?.content?.startsWith("{")).toBe(false) // ciphertext, not JSON
      expect(getLeaseExpiration(latest!)).toBe(expiration)
      expect(getLeaseExec(latest!)).toBe("2026-06")
      expect(latest?.tags.find((t) => t[0] === "alt")?.[1]).toBe("Push lease")
      expect(validateLeasePublicTags(latest!.tags).ok).toBe(true)

      // Executor decrypts (peer = author = event.pubkey).
      const asExecutor = yield* svc.decryptLease({
        event: latest!,
        decryptPrivateKey: executorSk,
      })
      expect(asExecutor?.active).toBe(true)
      if (asExecutor?.active) {
        expect(asExecutor.endpoint).toBe("endpoint-token-xyz")
        expect(asExecutor.subscriptions[0]?.class).toBe("time_sensitive")
        expect(asExecutor.subscriptions[0]?.filter["#p"]).toEqual([author])
      }

      // Author decrypts with explicit executor peer pubkey.
      const asAuthor = yield* svc.decryptLease({
        event: latest!,
        decryptPrivateKey: authorSk,
        peerPubkey: executorPub,
      })
      expect(asAuthor?.active).toBe(true)

      // Unrelated key cannot decrypt.
      const strangerSk = yield* crypto.generatePrivateKey()
      const stranger = yield* svc.decryptLease({
        event: latest!,
        decryptPrivateKey: strangerSk,
      })
      expect(stranger).toBeNull()

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("revoke publishes inactive tombstone decryptable by executor", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* PushLeaseService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const authorSk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(authorSk)
      const executorSk = yield* crypto.generatePrivateKey()
      const executorPub = yield* crypto.getPublicKey(executorSk)

      const d = generateInstallationId()
      const expiration = Math.floor(Date.now() / 1000) + 3600

      // Active lease first.
      yield* svc.createLease(
        {
          d,
          expiration,
          exec: "k1",
          executorPubkey: executorPub,
          content: {
            v: 1,
            origin: "wss://relay.example",
            app_profile: "com.example.app/ios",
            transport: "apns",
            endpoint: "tok",
            generation: 1,
            active: true,
            subscriptions: [
              { filter: { kinds: [9], authors: [author] }, class: "default" },
            ],
          },
          limits: { pushKinds: [9] },
          createdAt: Math.floor(Date.now() / 1000) - 5,
        },
        authorSk
      )

      // Higher-generation inactive tombstone.
      const { result } = yield* svc.revokeLease(
        {
          d,
          expiration,
          exec: "k1",
          executorPubkey: executorPub,
          origin: "wss://relay.example",
          generation: 2,
          createdAt: Math.floor(Date.now() / 1000),
        },
        authorSk
      )
      expect(result.accepted).toBe(true)

      const latest = yield* svc.getLease({ author, d, timeoutMs: 1500 })
      const content = yield* svc.decryptLease({
        event: latest!,
        decryptPrivateKey: executorSk,
      })
      expect(content).toEqual({
        v: 1,
        origin: "wss://relay.example",
        generation: 2,
        active: false,
      })
      // Inactive must not carry transport fields.
      expect((content as { endpoint?: string })?.endpoint).toBeUndefined()

      // listLeases as executor returns the tombstone head.
      const listed = yield* svc.listLeases({
        author,
        decryptPrivateKey: executorSk,
        timeoutMs: 1500,
      })
      const found = listed.find((l) => l.d === d)
      expect(found?.content?.active).toBe(false)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("createLease rejects un-narrowed filters before publish", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* PushLeaseService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const authorSk = yield* crypto.generatePrivateKey()
      const executorSk = yield* crypto.generatePrivateKey()
      const executorPub = yield* crypto.getPublicKey(executorSk)

      const result = yield* svc
        .createLease(
          {
            expiration: Math.floor(Date.now() / 1000) + 3600,
            exec: "k1",
            executorPubkey: executorPub,
            content: {
              v: 1,
              origin: "wss://relay.example",
              app_profile: "app",
              transport: "apns",
              endpoint: "tok",
              generation: 1,
              active: true,
              subscriptions: [
                // kinds-only: not narrowed
                { filter: { kinds: [9] }, class: "default" },
              ],
            },
            limits: { pushKinds: [9] },
          },
          authorSk
        )
        .pipe(Effect.result)

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(String(result.failure)).toContain("not narrowed")
      }

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
