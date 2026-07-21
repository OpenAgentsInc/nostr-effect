/**
 * Tests for EngramService (NIP-AE: Agent Engrams)
 *
 * Includes pure helpers, spec reference vectors (seckey 01/02), and local-relay
 * publish/read round-trips.
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { hexToBytes } from "@noble/hashes/utils"
import {
  EngramService,
  EngramServiceLive,
  ENGRAM_KIND,
  CORE_SLUG,
  DEFAULT_ALT,
  deriveDTag,
  isValidSlug,
  isMemorySlug,
  isCoreSlug,
  isTombstone,
  isClockPoisoned,
  serializeBody,
  parseEngramBody,
  hasDuplicateJsonKeys,
  getEngramD,
  getOwnerP,
  selectHead,
  engramMonotonicCreatedAt,
  extractWikiLinks,
  engramAddress,
  type MemoryBody,
} from "./EngramService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { Nip44Service, Nip44ServiceLive } from "../services/Nip44Service.js"
import type { PrivateKey, PublicKey } from "../core/Schema.js"

// ---------------------------------------------------------------------------
// Spec reference keys (TEST KEYS — DO NOT USE IN PRODUCTION)
// ---------------------------------------------------------------------------

const SECKEY_A =
  "0000000000000000000000000000000000000000000000000000000000000001" as PrivateKey
const SECKEY_O =
  "0000000000000000000000000000000000000000000000000000000000000002" as PrivateKey
const PUBKEY_A =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const PUBKEY_O =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
const K_C =
  "c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d"

const D_CORE = "bdc233238ffe52e272b44cc233c8f33a2bc510b08be04495b225964283be4a90"
const D_MEM_EXAMPLE =
  "72d4f9629106451505d7d341ea85bb3ebad4f654fcfd2aad100d5a35f8a85cba"
const D_MEM_NOTES =
  "31651571a312780cfdc1f0b706b682ac9f3f51a053e8dca76fe57710bae5a4d4"

const BODY_1 = '{"slug":"mem/example","value":"hello, agent memory"}'
const BODY_2 =
  '{"slug":"mem/notes/2026-05-12","value":"meeting note: [[mem/example]]"}'
const BODY_3 = '{"slug":"mem/example","value":null}'
const BODY_4 =
  '{"slug":"core","profile":"test agent. see [[mem/example]] and [[mem/notes/2026-05-12]]."}'

const CONTENT_1 =
  "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABedgcxyfmpph68LBjCWZsTI5lb0Cbg8dIPVYVe/WVj/l4Yd8HGgzC8awyBi9bn9ClRdtd2IPsmont0jN/cajVSQhahTOwuNNwoJtZIg35aSsUzeCq4tQfd8E+fLoKomdPxjs="
const CONTENT_2 =
  "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACG/JBPvdZxDwAxOG7bY3AW2q1slZqBjQC3NxfPVtfcR+TGjp2GKtjyXyqNwG08GK+00I1u1vUZ4cCjcun9A7ra92rleKKJ5w57pqgFspbv1vClUJY5487A/5phVDHkw6DhRCSMDpEMw5Tapj3Wm1ponAVr5PciPOrTxltEfTVdSKaPA=="
const CONTENT_3 =
  "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADuau8i0Wu4+ULnp2qTfd+O23jJAapMRrKGGwabNVOlT9hSF8FViBHIS6f86/7xK4qGOin4IH8Wr/3cvHDcQGQd3IXQJr8LHgJkaYpQPdBO1bgqiFu8K3L/CLb1PgG1X7RQ8E="
const CONTENT_4 =
  "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEEeZHAFjhc8DAcKaVSSB7IoKG3nr+dX3LXlU7UIdOKayhIVPXvl4WuFmBSVxLO6yEV5vnLvzbo7rU0uPRYyAJLPNnifVTCw2EQZH70zOwTc/mVvaATHKzqcFo5VHrbpKNTzeNnz1Vds2yg2DXmdxaoWQA4YfnlLwZDOpyu9JP1uB1Yw=="

// ---------------------------------------------------------------------------
// Pure helper tests (no relay)
// ---------------------------------------------------------------------------

describe("NIP-AE helpers", () => {
  test("slug grammar accepts core and mem/… forms", () => {
    expect(isValidSlug("core")).toBe(true)
    expect(isCoreSlug("core")).toBe(true)
    expect(isMemorySlug("core")).toBe(false)

    expect(isValidSlug("mem/example")).toBe(true)
    expect(isValidSlug("mem/notes/2026-05-12")).toBe(true)
    expect(isValidSlug("mem/a")).toBe(true)
    expect(isValidSlug("mem/a_b-c/d0")).toBe(true)
    expect(isMemorySlug("mem/example")).toBe(true)
  })

  test("slug grammar rejects invalid forms", () => {
    expect(isValidSlug("")).toBe(false)
    expect(isValidSlug("Core")).toBe(false)
    expect(isValidSlug("mem")).toBe(false)
    expect(isValidSlug("mem/")).toBe(false)
    expect(isValidSlug("mem//x")).toBe(false)
    expect(isValidSlug("mem/-bad")).toBe(false)
    expect(isValidSlug("mem/Bad")).toBe(false)
    expect(isValidSlug("memory/x")).toBe(false)
    // segment: first char + up to 63 more → 65 a's after mem/ is invalid
    expect(isValidSlug("mem/" + "a".repeat(65))).toBe(false)
    expect(isValidSlug("x".repeat(256))).toBe(false)
  })

  test("deriveDTag matches NIP-AE reference vectors", () => {
    expect(deriveDTag(K_C, "core")).toBe(D_CORE)
    expect(deriveDTag(K_C, "mem/example")).toBe(D_MEM_EXAMPLE)
    expect(deriveDTag(K_C, "mem/notes/2026-05-12")).toBe(D_MEM_NOTES)
  })

  test("serializeBody pins compact JSON key order", () => {
    expect(
      serializeBody({ slug: "mem/example", value: "hello, agent memory" })
    ).toBe(BODY_1)
    expect(
      serializeBody({
        slug: "mem/notes/2026-05-12",
        value: "meeting note: [[mem/example]]",
      })
    ).toBe(BODY_2)
    expect(serializeBody({ slug: "mem/example", value: null })).toBe(BODY_3)
    expect(
      serializeBody({
        slug: "core",
        profile: "test agent. see [[mem/example]] and [[mem/notes/2026-05-12]].",
      })
    ).toBe(BODY_4)
  })

  test("parseEngramBody accepts valid core and memory bodies", () => {
    const core = parseEngramBody(BODY_4)
    expect(core).toEqual({
      slug: "core",
      profile: "test agent. see [[mem/example]] and [[mem/notes/2026-05-12]].",
    })
    const mem = parseEngramBody(BODY_1) as MemoryBody
    expect(mem.slug).toBe("mem/example")
    expect(mem.value).toBe("hello, agent memory")
    const tomb = parseEngramBody(BODY_3) as MemoryBody
    expect(tomb.value).toBeNull()
    expect(isTombstone(tomb)).toBe(true)
  })

  test("parseEngramBody rejects invalid shapes and slugs", () => {
    expect(parseEngramBody("not json")).toBeNull()
    expect(parseEngramBody(JSON.stringify(["a"]))).toBeNull()
    expect(parseEngramBody(JSON.stringify({ slug: "core" }))).toBeNull() // missing profile
    expect(
      parseEngramBody(JSON.stringify({ slug: "mem/example" }))
    ).toBeNull() // missing value
    expect(
      parseEngramBody(JSON.stringify({ slug: "bad", value: "x" }))
    ).toBeNull()
    expect(
      parseEngramBody(JSON.stringify({ slug: "core", profile: 1 }))
    ).toBeNull()
    expect(
      parseEngramBody(JSON.stringify({ slug: "mem/x", value: 1 }))
    ).toBeNull()
  })

  test("parseEngramBody ignores unknown fields but requires shape", () => {
    const parsed = parseEngramBody(
      JSON.stringify({ slug: "mem/x", value: "v", extra: true })
    )
    expect(parsed).toEqual({ slug: "mem/x", value: "v" })
  })

  test("hasDuplicateJsonKeys / parseEngramBody reject duplicate keys", () => {
    expect(hasDuplicateJsonKeys('{"slug":"core","slug":"core","profile":"x"}')).toBe(
      true
    )
    expect(parseEngramBody('{"slug":"core","slug":"core","profile":"x"}')).toBeNull()
    expect(hasDuplicateJsonKeys(BODY_1)).toBe(false)
  })

  test("getEngramD / getOwnerP require exactly one valid tag", () => {
    expect(getEngramD({ tags: [["d", D_CORE]] })).toBe(D_CORE)
    expect(getEngramD({ tags: [["d", D_CORE], ["d", D_CORE]] })).toBeNull()
    expect(getEngramD({ tags: [["d", "short"]] })).toBeNull()
    expect(getOwnerP({ tags: [["p", PUBKEY_O]] })).toBe(PUBKEY_O)
    expect(getOwnerP({ tags: [["p", PUBKEY_O], ["p", PUBKEY_A]] })).toBeNull()
  })

  test("selectHead picks greatest created_at, then lowest id", () => {
    const events = [
      { created_at: 10, id: "bb" },
      { created_at: 11, id: "cc" },
      { created_at: 11, id: "aa" },
    ]
    expect(selectHead(events)?.id).toBe("aa")
    expect(selectHead([])).toBeNull()
  })

  test("engramMonotonicCreatedAt enforces T+1", () => {
    expect(engramMonotonicCreatedAt(100, 0)).toBe(100)
    expect(engramMonotonicCreatedAt(100, 50)).toBe(100)
    expect(engramMonotonicCreatedAt(100, 100)).toBe(101)
    expect(engramMonotonicCreatedAt(100, 200)).toBe(201)
  })

  test("isClockPoisoned flags heads far ahead of wall-clock", () => {
    expect(isClockPoisoned(100, 100)).toBe(false)
    expect(isClockPoisoned(100 + 25 * 3600, 100)).toBe(true)
  })

  test("extractWikiLinks finds valid [[slug]] references", () => {
    expect(extractWikiLinks(BODY_4)).toEqual([
      "mem/example",
      "mem/notes/2026-05-12",
    ])
    expect(extractWikiLinks("no links here")).toEqual([])
    expect(extractWikiLinks("[[not valid]]")).toEqual([])
  })

  test("engramAddress formats NIP-01 a-tag coordinate", () => {
    expect(engramAddress(PUBKEY_A, D_CORE)).toBe(`30174:${PUBKEY_A}:${D_CORE}`)
  })
})

// ---------------------------------------------------------------------------
// Spec crypto vectors (conversation key + encryptWithNonce content)
// ---------------------------------------------------------------------------

describe("NIP-AE reference vectors", () => {
  const layers = Layer.merge(CryptoServiceLive, Nip44ServiceLive)

  test("K_c matches nip44 vector for seckey 01/02", async () => {
    const program = Effect.gen(function* () {
      const nip44 = yield* Nip44Service
      const crypto = yield* CryptoService

      const pubA = yield* crypto.getPublicKey(SECKEY_A)
      const pubO = yield* crypto.getPublicKey(SECKEY_O)
      expect(pubA as string).toBe(PUBKEY_A)
      expect(pubO as string).toBe(PUBKEY_O)

      const kcFromAgent = yield* nip44.getConversationKey(SECKEY_A, pubO)
      const kcFromOwner = yield* nip44.getConversationKey(SECKEY_O, pubA)
      expect(kcFromAgent as string).toBe(K_C)
      expect(kcFromOwner as string).toBe(K_C)

      // d-tags under the derived K_c
      expect(deriveDTag(kcFromAgent, "core")).toBe(D_CORE)
      expect(deriveDTag(kcFromAgent, "mem/example")).toBe(D_MEM_EXAMPLE)
      expect(deriveDTag(kcFromAgent, "mem/notes/2026-05-12")).toBe(D_MEM_NOTES)
    })
    await Effect.runPromise(program.pipe(Effect.provide(layers)))
  })

  test("encryptWithNonce pins event content vectors 1–4", async () => {
    const program = Effect.gen(function* () {
      const nip44 = yield* Nip44Service
      const crypto = yield* CryptoService
      const pubO = yield* crypto.getPublicKey(SECKEY_O)
      const ck = yield* nip44.getConversationKey(SECKEY_A, pubO)

      const c1 = yield* nip44.encryptWithNonce(
        BODY_1,
        ck,
        hexToBytes("0000000000000000000000000000000000000000000000000000000000000001")
      )
      const c2 = yield* nip44.encryptWithNonce(
        BODY_2,
        ck,
        hexToBytes("0000000000000000000000000000000000000000000000000000000000000002")
      )
      const c3 = yield* nip44.encryptWithNonce(
        BODY_3,
        ck,
        hexToBytes("0000000000000000000000000000000000000000000000000000000000000003")
      )
      const c4 = yield* nip44.encryptWithNonce(
        BODY_4,
        ck,
        hexToBytes("0000000000000000000000000000000000000000000000000000000000000004")
      )

      expect(c1 as string).toBe(CONTENT_1)
      expect(c2 as string).toBe(CONTENT_2)
      expect(c3 as string).toBe(CONTENT_3)
      expect(c4 as string).toBe(CONTENT_4)

      // Round-trip decrypt
      expect(yield* nip44.decrypt(c1, ck)).toBe(BODY_1)
      expect(yield* nip44.decrypt(c3, ck)).toBe(BODY_3)
      expect(parseEngramBody(yield* nip44.decrypt(c4, ck))?.slug).toBe("core")
    })
    await Effect.runPromise(program.pipe(Effect.provide(layers)))
  })
})

// ---------------------------------------------------------------------------
// Relay round-trip tests
// ---------------------------------------------------------------------------

describe("EngramService (NIP-AE)", () => {
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
    const RelayLayer = makeRelayService({
      url: `ws://localhost:${port}`,
      reconnect: false,
    })
    const ServiceLayer = Layer.mergeAll(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive)),
      Nip44ServiceLive
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        EngramServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  test("writeMemory -> owner decrypts; stranger cannot", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EngramService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const agentSk = yield* crypto.generatePrivateKey()
      const agentPk = yield* crypto.getPublicKey(agentSk)
      const ownerSk = yield* crypto.generatePrivateKey()
      const ownerPk = yield* crypto.getPublicKey(ownerSk)

      const now = Math.floor(Date.now() / 1000)
      const written = yield* svc.writeMemory(
        {
          ownerPubkey: ownerPk,
          slug: "mem/example",
          value: "hello, agent memory",
          createdAt: now,
          priorCreatedAt: 0,
        },
        agentSk
      )
      expect(written.result.accepted).toBe(true)
      expect(written.slug).toBe("mem/example")
      expect(written.d).toMatch(/^[0-9a-f]{64}$/)
      expect((written.event.kind as number) ?? 0).toBe(ENGRAM_KIND)
      expect(written.event.content.startsWith("{")).toBe(false) // encrypted
      expect(getOwnerP(written.event)).toBe(ownerPk)
      expect(written.event.tags.find((t) => t[0] === "alt")?.[1]).toBe(DEFAULT_ALT)

      // Owner decrypts via decryptEngram (asOwner default)
      const asOwner = yield* svc.decryptEngram({
        event: written.event,
        readerPrivateKey: ownerSk,
        asOwner: true,
      })
      expect(asOwner).toEqual({
        slug: "mem/example",
        value: "hello, agent memory",
      })

      // Agent also decrypts
      const asAgent = yield* svc.decryptEngram({
        event: written.event,
        readerPrivateKey: agentSk,
        asOwner: false,
      })
      expect(asAgent).toEqual({
        slug: "mem/example",
        value: "hello, agent memory",
      })

      // Stranger cannot decrypt
      const otherSk = yield* crypto.generatePrivateKey()
      const other = yield* svc.decryptEngram({
        event: written.event,
        readerPrivateKey: otherSk,
        asOwner: true,
      })
      expect(other).toBeNull()

      // read() via owner recovers the head
      const decoded = yield* svc.read({
        agentPubkey: agentPk,
        ownerPubkey: ownerPk,
        slug: "mem/example",
        readerPrivateKey: ownerSk,
        timeoutMs: 1500,
      })
      expect(decoded?.body).toEqual({
        slug: "mem/example",
        value: "hello, agent memory",
      })
      expect(decoded?.d).toBe(written.d)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("writeCore / readCore round-trip and wiki-link extraction", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EngramService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const agentSk = yield* crypto.generatePrivateKey()
      const agentPk = yield* crypto.getPublicKey(agentSk)
      const ownerSk = yield* crypto.generatePrivateKey()
      const ownerPk = yield* crypto.getPublicKey(ownerSk)

      const profile =
        "test agent. see [[mem/example]] and [[mem/notes/2026-05-12]]."
      const now = Math.floor(Date.now() / 1000)
      const written = yield* svc.writeCore(
        {
          ownerPubkey: ownerPk,
          profile,
          createdAt: now,
          priorCreatedAt: 0,
        },
        agentSk
      )
      expect(written.result.accepted).toBe(true)
      expect(written.slug).toBe(CORE_SLUG)

      const core = yield* svc.readCore({
        agentPubkey: agentPk,
        ownerPubkey: ownerPk,
        readerPrivateKey: ownerSk,
        timeoutMs: 1500,
      })
      expect(core?.profile).toBe(profile)
      expect(extractWikiLinks(core!.profile)).toEqual([
        "mem/example",
        "mem/notes/2026-05-12",
      ])

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("tombstone supersedes prior memory; list omits it", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EngramService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const agentSk = yield* crypto.generatePrivateKey()
      const agentPk = yield* crypto.getPublicKey(agentSk)
      const ownerSk = yield* crypto.generatePrivateKey()
      const ownerPk = yield* crypto.getPublicKey(ownerSk)

      const now = Math.floor(Date.now() / 1000)
      const w1 = yield* svc.writeMemory(
        {
          ownerPubkey: ownerPk,
          slug: "mem/example",
          value: "keep me",
          createdAt: now,
          priorCreatedAt: 0,
        },
        agentSk
      )
      expect(w1.result.accepted).toBe(true)

      // Second memory stays listed
      const w2 = yield* svc.writeMemory(
        {
          ownerPubkey: ownerPk,
          slug: "mem/notes/day",
          value: "other",
          createdAt: now + 1,
          priorCreatedAt: 0,
        },
        agentSk
      )
      expect(w2.result.accepted).toBe(true)

      const tomb = yield* svc.tombstone(
        {
          ownerPubkey: ownerPk,
          slug: "mem/example",
          createdAt: now + 2,
          priorCreatedAt: now,
        },
        agentSk
      )
      expect(tomb.result.accepted).toBe(true)
      expect(tomb.d).toBe(w1.d) // same address

      // read returns null for tombstoned slug
      const gone = yield* svc.read({
        agentPubkey: agentPk,
        ownerPubkey: ownerPk,
        slug: "mem/example",
        readerPrivateKey: ownerSk,
        timeoutMs: 1500,
      })
      expect(gone).toBeNull()

      const listed = yield* svc.list({
        agentPubkey: agentPk,
        ownerPubkey: ownerPk,
        readerPrivateKey: ownerSk,
        timeoutMs: 1500,
      })
      expect(listed.find((e) => e.slug === "mem/example")).toBeUndefined()
      expect(listed.find((e) => e.slug === "mem/notes/day")?.value).toBe("other")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("replacement is monotonic and list/read see latest head", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EngramService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const agentSk = yield* crypto.generatePrivateKey()
      const agentPk = yield* crypto.getPublicKey(agentSk)
      const ownerSk = yield* crypto.generatePrivateKey()
      const ownerPk = yield* crypto.getPublicKey(ownerSk)

      const now = Math.floor(Date.now() / 1000)
      const v1 = yield* svc.writeMemory(
        {
          ownerPubkey: ownerPk,
          slug: "mem/counter",
          value: "one",
          createdAt: now,
          priorCreatedAt: 0,
        },
        agentSk
      )
      const v2 = yield* svc.writeMemory(
        {
          ownerPubkey: ownerPk,
          slug: "mem/counter",
          value: "two",
          createdAt: now + 5,
          priorCreatedAt: now,
        },
        agentSk
      )
      expect(v2.d).toBe(v1.d)
      expect(v2.createdAt).toBeGreaterThan(v1.createdAt)

      const head = yield* svc.read({
        agentPubkey: agentPk,
        ownerPubkey: ownerPk,
        slug: "mem/counter",
        readerPrivateKey: agentSk,
        timeoutMs: 1500,
      })
      expect((head?.body as MemoryBody)?.value).toBe("two")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("deleteEngram publishes NIP-09 a/k tags and removes the head", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EngramService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const agentSk = yield* crypto.generatePrivateKey()
      const agentPk = yield* crypto.getPublicKey(agentSk)
      const ownerSk = yield* crypto.generatePrivateKey()
      const ownerPk = yield* crypto.getPublicKey(ownerSk)

      const written = yield* svc.writeMemory(
        {
          ownerPubkey: ownerPk,
          slug: "mem/temp",
          value: "delete me",
          priorCreatedAt: 0,
        },
        agentSk
      )

      const del = yield* svc.deleteEngram({ d: written.d, reason: "cleanup" }, agentSk)
      expect(del.accepted).toBe(true)

      const after = yield* svc.read({
        agentPubkey: agentPk,
        ownerPubkey: ownerPk,
        slug: "mem/temp",
        readerPrivateKey: ownerSk,
        timeoutMs: 1500,
      })
      expect(after).toBeNull()

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("writeMemory rejects invalid slugs client-side", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EngramService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const agentSk = yield* crypto.generatePrivateKey()
      const ownerPk = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

      const bad = yield* svc
        .writeMemory(
          { ownerPubkey: ownerPk, slug: "not-a-mem-slug", value: "x" },
          agentSk
        )
        .pipe(
          Effect.matchEffect({
            onFailure: (e) => Effect.succeed(e.message),
            onSuccess: () => Effect.succeed("unexpected success"),
          })
        )
      expect(bad).toMatch(/invalid memory slug/)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("spec vector keys publish with encryptWithNonce content", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* EngramService
      yield* relayService.connect()

      const nonce1 = hexToBytes(
        "0000000000000000000000000000000000000000000000000000000000000001"
      )
      const ownerPk = PUBKEY_O as PublicKey
      const written = yield* svc.writeMemory(
        {
          ownerPubkey: ownerPk,
          slug: "mem/example",
          value: "hello, agent memory",
          createdAt: 1700000000,
          priorCreatedAt: 0,
          nonce: nonce1,
        },
        SECKEY_A
      )
      expect(written.result.accepted).toBe(true)
      expect(written.d).toBe(D_MEM_EXAMPLE)
      expect(written.event.content).toBe(CONTENT_1)
      expect(written.event.pubkey as string).toBe(PUBKEY_A)

      // Owner (seckey 02) can decrypt
      const body = yield* svc.decryptEngram({
        event: written.event,
        readerPrivateKey: SECKEY_O,
        asOwner: true,
      })
      expect(body).toEqual({
        slug: "mem/example",
        value: "hello, agent memory",
      })

      // Core vector
      const nonce4 = hexToBytes(
        "0000000000000000000000000000000000000000000000000000000000000004"
      )
      const core = yield* svc.writeCore(
        {
          ownerPubkey: ownerPk,
          profile:
            "test agent. see [[mem/example]] and [[mem/notes/2026-05-12]].",
          createdAt: 1700000003,
          priorCreatedAt: 0,
          nonce: nonce4,
        },
        SECKEY_A
      )
      expect(core.d).toBe(D_CORE)
      expect(core.event.content).toBe(CONTENT_4)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
