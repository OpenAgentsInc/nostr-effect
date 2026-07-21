/**
 * Tests for DmVisibilityService (NIP-DV: DM Visibility)
 *
 * Covers pure parse/filter helpers, relay-identity verification, and query
 * of a signed kind:30622 snapshot via a local test relay.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import {
  DmVisibilityService,
  DmVisibilityServiceLive,
  DmVisibilityError,
  DM_VISIBILITY_SNAPSHOT_KIND,
  buildVisibilitySnapshotTags,
  buildVisibilitySnapshotParams,
  buildVisibilitySnapshotFilter,
  parseVisibilitySnapshot,
  collectHiddenChannelIds,
  isDmHidden,
  filterVisibleDmChannels,
  isHex64,
} from "./DmVisibilityService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import type { NostrEvent, PrivateKey } from "../core/Schema.js"
import { DmVisibilitySnapshot } from "../wrappers/kinds.js"

const VIEWER =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const CHANNEL_A =
  "1111111111111111111111111111111111111111111111111111111111111111"
const CHANNEL_B =
  "2222222222222222222222222222222222222222222222222222222222222222"
const CHANNEL_C =
  "3333333333333333333333333333333333333333333333333333333333333333"

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect))

describe("DmVisibilityService (NIP-DV) — pure helpers", () => {
  test("kind constant is 30622 and matches kinds.ts", () => {
    expect(DM_VISIBILITY_SNAPSHOT_KIND).toBe(30622)
    expect(DmVisibilitySnapshot).toBe(30622)
  })

  test("isHex64 accepts only 64-char lowercase hex", () => {
    expect(isHex64(VIEWER)).toBe(true)
    expect(isHex64("AA" + "a".repeat(62))).toBe(false)
    expect(isHex64("a".repeat(63))).toBe(false)
    expect(isHex64("g".repeat(64))).toBe(false)
  })

  test("buildVisibilitySnapshotTags emits d, p, and h tags", () => {
    const tags = buildVisibilitySnapshotTags(VIEWER, [CHANNEL_A, CHANNEL_B, CHANNEL_A])
    expect(tags[0]).toEqual(["d", VIEWER])
    expect(tags[1]).toEqual(["p", VIEWER])
    // de-duplicated h tags
    expect(tags.filter((t) => t[0] === "h")).toEqual([
      ["h", CHANNEL_A],
      ["h", CHANNEL_B],
    ])
  })

  test("empty hidden set is valid (no h tags)", () => {
    const tags = buildVisibilitySnapshotTags(VIEWER, [])
    expect(tags).toEqual([
      ["d", VIEWER],
      ["p", VIEWER],
    ])
    const built = buildVisibilitySnapshotParams({ viewerPubkey: VIEWER })
    expect(built.kind).toBe(30622)
    expect(built.content).toBe("")
    expect(built.tags).toEqual(tags)
  })

  test("buildVisibilitySnapshotFilter is keyed by #p", () => {
    const filter = buildVisibilitySnapshotFilter(VIEWER)
    expect([...(filter.kinds ?? [])].map(Number)).toEqual([30622])
    expect([...(filter["#p"] ?? [])].map(String)).toEqual([VIEWER])
    expect(filter.limit).toBe(1)
  })

  const fakeEvent = (overrides: Record<string, unknown> = {}): NostrEvent =>
    ({
      id: "b".repeat(64),
      pubkey: "c".repeat(64),
      created_at: 1_700_000_000,
      kind: 30622,
      tags: [
        ["d", VIEWER],
        ["p", VIEWER],
        ["h", CHANNEL_A],
        ["h", CHANNEL_B],
      ],
      content: "ignored",
      sig: "d".repeat(128),
      ...overrides,
    }) as unknown as NostrEvent

  test("parseVisibilitySnapshot extracts projection fields", async () => {
    const event = fakeEvent()
    const snap = await Effect.runPromise(parseVisibilitySnapshot(event))
    expect(snap.viewerPubkey).toBe(VIEWER)
    expect(snap.relayPubkey).toBe("c".repeat(64))
    expect(snap.hiddenChannelIds).toEqual(new Set([CHANNEL_A, CHANNEL_B]))
    // content is not parsed into the projection
    expect(collectHiddenChannelIds(event).size).toBe(2)
  })

  test("parse rejects wrong kind", async () => {
    const event = fakeEvent({
      kind: 1,
      tags: [
        ["d", VIEWER],
        ["p", VIEWER],
      ],
      content: "",
    })
    const err = await runFail(parseVisibilitySnapshot(event))
    expect(err).toBeInstanceOf(DmVisibilityError)
    expect(err.reason).toBe("wrong_kind")
  })

  test("parse rejects missing d/p or d≠p", async () => {
    const missingD = await runFail(
      parseVisibilitySnapshot(fakeEvent({ tags: [["p", VIEWER]] }))
    )
    expect(missingD.reason).toBe("malformed")

    const mismatch = await runFail(
      parseVisibilitySnapshot(
        fakeEvent({
          tags: [
            ["d", VIEWER],
            ["p", CHANNEL_A],
          ],
        })
      )
    )
    expect(mismatch.reason).toBe("malformed")
  })

  test("isDmHidden and filterVisibleDmChannels", () => {
    const snap = {
      hiddenChannelIds: new Set([CHANNEL_A, CHANNEL_B]),
    }
    expect(isDmHidden(CHANNEL_A, snap)).toBe(true)
    expect(isDmHidden(CHANNEL_C, snap)).toBe(false)
    expect(isDmHidden(CHANNEL_A, null)).toBe(false)

    const visible = filterVisibleDmChannels(
      [CHANNEL_A, CHANNEL_C, CHANNEL_B],
      snap
    )
    expect(visible).toEqual([CHANNEL_C])
    expect(filterVisibleDmChannels([CHANNEL_A], null)).toEqual([CHANNEL_A])
  })
})

describe("DmVisibilityService (NIP-DV) — verify + query", () => {
  let handle: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 33000 + Math.floor(Math.random() * 10000)
    handle = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(handle.stop())
  })

  const makeLayers = () => {
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
        DmVisibilityServiceLive.pipe(
          Layer.provide(RelayLayer),
          Layer.provide(ServiceLayer)
        )
      )
    )
  }

  test("signSnapshot produces a valid relay-signed 30622", async () => {
    const program = Effect.gen(function* () {
      const crypto = yield* CryptoService
      const events = yield* EventService
      const dv = yield* DmVisibilityService

      const relaySk = yield* crypto.generatePrivateKey()
      const relayPk = yield* crypto.getPublicKey(relaySk)

      const signed = yield* dv.signSnapshot(
        {
          viewerPubkey: VIEWER,
          hiddenChannelIds: [CHANNEL_A, CHANNEL_B],
        },
        relaySk
      )

      expect(signed.kind as number).toBe(30622)
      expect(signed.pubkey).toBe(relayPk)
      expect(signed.content).toBe("")
      expect(signed.tags.find((t) => t[0] === "d")?.[1]).toBe(VIEWER)
      expect(signed.tags.find((t) => t[0] === "p")?.[1]).toBe(VIEWER)
      expect(signed.tags.filter((t) => t[0] === "h").map((t) => t[1])).toEqual([
        CHANNEL_A,
        CHANNEL_B,
      ])

      const ok = yield* events.verifyEvent(signed)
      expect(ok).toBe(true)

      const projection = yield* dv.readSnapshot(signed, relayPk)
      expect(projection.viewerPubkey).toBe(VIEWER)
      expect(projection.relayPubkey).toBe(relayPk)
      expect(projection.hiddenChannelIds).toEqual(new Set([CHANNEL_A, CHANNEL_B]))
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("readSnapshot rejects wrong relay identity and bad sig", async () => {
    const program = Effect.gen(function* () {
      const crypto = yield* CryptoService
      const dv = yield* DmVisibilityService

      const relaySk = yield* crypto.generatePrivateKey()
      const otherSk = yield* crypto.generatePrivateKey()
      const otherPk = yield* crypto.getPublicKey(otherSk)

      const signed = yield* dv.signSnapshot(
        { viewerPubkey: VIEWER, hiddenChannelIds: [CHANNEL_A] },
        relaySk
      )

      const mismatch = yield* Effect.flip(dv.readSnapshot(signed, otherPk))
      expect(mismatch).toBeInstanceOf(DmVisibilityError)
      expect(mismatch.reason).toBe("relay_mismatch")

      // Tamper content → id/sig fail
      const tampered = { ...signed, content: "x" } as NostrEvent
      const bad = yield* Effect.flip(dv.readSnapshot(tampered, signed.pubkey))
      expect(bad.reason).toBe("bad_signature")

      const verified = yield* dv.verifyRelaySignature(signed, signed.pubkey)
      expect(verified).toBe(true)
      const notVerified = yield* dv.verifyRelaySignature(signed, otherPk)
      expect(notVerified).toBe(false)
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("getSnapshot queries #p and verifies against relay identity", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const crypto = yield* CryptoService
      const dv = yield* DmVisibilityService
      yield* relaySvc.connect()

      const relaySk = (yield* crypto.generatePrivateKey()) as PrivateKey
      const relayPk = yield* crypto.getPublicKey(relaySk)

      // Sign as "relay" and publish (test relay accepts client-submitted 30622)
      const snapshot = yield* dv.signSnapshot(
        {
          viewerPubkey: VIEWER,
          hiddenChannelIds: [CHANNEL_A, CHANNEL_C],
          createdAt: Math.floor(Date.now() / 1000),
        },
        relaySk
      )
      const pub = yield* relaySvc.publish(snapshot)
      expect(pub.accepted).toBe(true)

      const got = yield* dv.getSnapshot({
        viewerPubkey: VIEWER,
        relayIdentity: relayPk,
        timeoutMs: 1000,
      })
      expect(got).not.toBeNull()
      expect(got!.hiddenChannelIds).toEqual(new Set([CHANNEL_A, CHANNEL_C]))
      expect(got!.viewerPubkey).toBe(VIEWER)
      expect(got!.relayPubkey).toBe(relayPk)

      const hidden = yield* dv.getHiddenChannelIds({
        viewerPubkey: VIEWER,
        relayIdentity: relayPk,
        timeoutMs: 800,
      })
      expect(hidden.has(CHANNEL_A)).toBe(true)
      expect(hidden.has(CHANNEL_B)).toBe(false)

      // Wrong identity → treated as missing
      const wrong = yield* dv.getSnapshot({
        viewerPubkey: VIEWER,
        relayIdentity: "e".repeat(64),
        timeoutMs: 600,
      })
      expect(wrong).toBeNull()

      // Unknown viewer → empty
      const empty = yield* dv.getHiddenChannelIds({
        viewerPubkey: "f".repeat(64),
        relayIdentity: relayPk,
        timeoutMs: 400,
      })
      expect(empty.size).toBe(0)

      yield* relaySvc.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
