/**
 * Tests for ChannelWindowService (NIP-CW: Channel Window)
 */
import { test, expect, describe } from "vite-plus/test"
import { Effect, Layer } from "effect"
import {
  ChannelWindowService,
  ChannelWindowServiceLive,
  THREAD_SUMMARY_KIND,
  WINDOW_BOUNDS_KIND,
  buildWindowFilter,
  continueWindowFilter,
  stripWindowExtensions,
  partitionWindowResponse,
  parseThreadSummary,
  parseWindowBounds,
  readWindowPageStructural,
  hasMarkedReplyTag,
  isBroadcast,
  isTopLevelByWire,
  boundsDTag,
  requestCursorBinding,
  type CompositeCursor,
  type ChannelWindowFilter,
} from "./ChannelWindowService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { EventKind, Tag, type NostrEvent, type PrivateKey } from "../core/Schema.js"
import { Schema } from "effect"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROW_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const ROW_ID_2 =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const CHANNEL = "group-abc"
const PK_A =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const PK_B =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"

const fakeEvent = (partial: {
  kind: number
  tags?: string[][]
  content?: string
  id?: string
  pubkey?: string
  created_at?: number
  sig?: string
}): NostrEvent =>
  ({
    id: partial.id ?? "0".repeat(64),
    pubkey: partial.pubkey ?? "1".repeat(64),
    created_at: partial.created_at ?? 1_700_000_000,
    kind: partial.kind,
    tags: (partial.tags ?? []).map((t) => decodeTag(t)),
    content: partial.content ?? "",
    sig: partial.sig ?? "2".repeat(128),
  }) as unknown as NostrEvent

const ServiceLayer = ChannelWindowServiceLive.pipe(
  Layer.provide(EventServiceLive),
  Layer.provide(CryptoServiceLive)
)

const CryptoLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

const signOverlay = (
  kind: number,
  tags: string[][],
  content: string,
  privateKey: PrivateKey,
  createdAt = 1_700_000_000
) =>
  Effect.gen(function* () {
    const events = yield* EventService
    return yield* events.createEvent(
      {
        kind: decodeKind(kind),
        tags: tags.map((t) => decodeTag(t)),
        content,
        created_at: createdAt as never,
      },
      privateKey
    )
  })

// ---------------------------------------------------------------------------
// Constants & classification
// ---------------------------------------------------------------------------

describe("NIP-CW constants and top-level classification", () => {
  test("overlay kinds are 39005 / 39006", () => {
    expect(THREAD_SUMMARY_KIND).toBe(39005)
    expect(WINDOW_BOUNDS_KIND).toBe(39006)
  })

  test("hasMarkedReplyTag requires marker and 64-hex parent", () => {
    expect(
      hasMarkedReplyTag({
        tags: [["e", ROW_ID, "wss://r", "reply"]],
      })
    ).toBe(true)
    expect(
      hasMarkedReplyTag({
        tags: [["e", ROW_ID, "wss://r", "root"]],
      })
    ).toBe(false)
    expect(
      hasMarkedReplyTag({
        tags: [["e", ROW_ID]],
      })
    ).toBe(false)
    expect(
      hasMarkedReplyTag({
        tags: [["e", "short", "", "reply"]],
      })
    ).toBe(false)
  })

  test("isBroadcast requires exact [broadcast, 1]", () => {
    expect(isBroadcast({ tags: [["broadcast", "1"]] })).toBe(true)
    expect(isBroadcast({ tags: [["broadcast", "0"]] })).toBe(false)
    expect(isBroadcast({ tags: [["broadcast"]] })).toBe(false)
  })

  test("isTopLevelByWire: no reply marker or broadcast reply", () => {
    expect(isTopLevelByWire({ tags: [] })).toBe(true)
    expect(
      isTopLevelByWire({ tags: [["e", ROW_ID, "", "root"]] })
    ).toBe(true)
    expect(
      isTopLevelByWire({ tags: [["e", ROW_ID, "", "reply"]] })
    ).toBe(false)
    expect(
      isTopLevelByWire({
        tags: [
          ["e", ROW_ID, "", "reply"],
          ["broadcast", "1"],
        ],
      })
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Filter construction
// ---------------------------------------------------------------------------

describe("NIP-CW filter helpers", () => {
  test("buildWindowFilter head request", async () => {
    const filter = await Effect.runPromise(
      buildWindowFilter({
        channelId: CHANNEL,
        kinds: [9],
        limit: 50,
        includeSummaries: true,
        includeAux: true,
      })
    )
    expect(filter).toEqual({
      kinds: [9],
      "#h": [CHANNEL],
      limit: 50,
      top_level: true,
      include_summaries: true,
      include_aux: true,
    })
  })

  test("buildWindowFilter with composite cursor", async () => {
    const cursor: CompositeCursor = { created_at: 1_751_499_000, id: ROW_ID }
    const filter = await Effect.runPromise(
      buildWindowFilter({ channelId: CHANNEL, cursor })
    )
    expect(filter.until).toBe(1_751_499_000)
    expect(filter.before_id).toBe(ROW_ID)
    expect(filter.top_level).toBe(true)
    expect(filter.include_summaries).toBeUndefined()
  })

  test("buildWindowFilter rejects empty channel and bad limit", async () => {
    const empty = await Effect.runPromiseExit(
      buildWindowFilter({ channelId: "" })
    )
    expect(empty._tag).toBe("Failure")

    const badLimit = await Effect.runPromiseExit(
      buildWindowFilter({ channelId: CHANNEL, limit: 0 })
    )
    expect(badLimit._tag).toBe("Failure")
  })

  test("buildWindowFilter rejects malformed cursor id", async () => {
    const exit = await Effect.runPromiseExit(
      buildWindowFilter({
        channelId: CHANNEL,
        cursor: { created_at: 1, id: "not-hex" },
      })
    )
    expect(exit._tag).toBe("Failure")
  })

  test("bounds d-tag binding helpers", () => {
    expect(requestCursorBinding(null)).toBe("head")
    expect(requestCursorBinding(undefined)).toBe("head")
    expect(requestCursorBinding({ created_at: 10, id: ROW_ID })).toBe(
      `10:${ROW_ID}`
    )
    expect(boundsDTag(CHANNEL, null)).toBe(`${CHANNEL}:head`)
    expect(boundsDTag(CHANNEL, { created_at: 10, id: ROW_ID })).toBe(
      `${CHANNEL}:10:${ROW_ID}`
    )
  })

  test("continueWindowFilter echoes next_cursor", async () => {
    const previous: ChannelWindowFilter = {
      "#h": [CHANNEL],
      top_level: true,
      kinds: [9],
      limit: 25,
      include_summaries: true,
    }
    const next = await Effect.runPromise(
      continueWindowFilter(previous, {
        has_more: true,
        next_cursor: { created_at: 99, id: ROW_ID_2 },
      })
    )
    expect(next).toEqual({
      "#h": [CHANNEL],
      top_level: true,
      kinds: [9],
      limit: 25,
      include_summaries: true,
      until: 99,
      before_id: ROW_ID_2,
    })
  })

  test("continueWindowFilter fails when exhausted", async () => {
    const previous: ChannelWindowFilter = {
      "#h": [CHANNEL],
      top_level: true,
    }
    const exit = await Effect.runPromiseExit(
      continueWindowFilter(previous, { has_more: false, next_cursor: null })
    )
    expect(exit._tag).toBe("Failure")
  })

  test("stripWindowExtensions removes CW keys", () => {
    const stripped = stripWindowExtensions({
      "#h": [CHANNEL],
      top_level: true,
      include_summaries: true,
      include_aux: true,
      before_id: ROW_ID,
      until: 10,
      kinds: [9],
      limit: 5,
    })
    expect(stripped).toEqual({
      "#h": [CHANNEL],
      kinds: [9],
      limit: 5,
      until: 10,
    })
    expect("top_level" in stripped).toBe(false)
    expect("before_id" in stripped).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Partition + parse
// ---------------------------------------------------------------------------

describe("NIP-CW partition and parse", () => {
  test("partitionWindowResponse splits by kind", () => {
    const row = fakeEvent({ kind: 9, id: ROW_ID })
    const reaction = fakeEvent({ kind: 7, content: "+" })
    const summary = fakeEvent({
      kind: THREAD_SUMMARY_KIND,
      tags: [
        ["e", ROW_ID],
        ["d", ROW_ID],
        ["h", CHANNEL],
      ],
    })
    const bounds = fakeEvent({
      kind: WINDOW_BOUNDS_KIND,
      tags: [
        ["d", `${CHANNEL}:head`],
        ["h", CHANNEL],
      ],
    })
    const part = partitionWindowResponse([row, reaction, summary, bounds])
    expect(part.rows).toEqual([row])
    expect(part.aux).toEqual([reaction])
    expect(part.summaries).toEqual([summary])
    expect(part.bounds).toEqual([bounds])
  })

  test("parseThreadSummary accepts valid overlay content", async () => {
    const content = {
      reply_count: 4,
      descendant_count: 7,
      last_reply_at: 1_751_500_123,
      participants: [PK_A, PK_B],
    }
    const event = fakeEvent({
      kind: THREAD_SUMMARY_KIND,
      tags: [
        ["e", ROW_ID],
        ["d", ROW_ID],
        ["h", CHANNEL],
      ],
      content: JSON.stringify(content),
    })
    const parsed = await Effect.runPromise(parseThreadSummary(event))
    expect(parsed.rowId).toBe(ROW_ID)
    expect(parsed.channelId).toBe(CHANNEL)
    expect(parsed.content).toEqual(content)
  })

  test("parseThreadSummary rejects wrong tag cardinality / e≠d", async () => {
    const badCard = await Effect.runPromiseExit(
      parseThreadSummary(
        fakeEvent({
          kind: THREAD_SUMMARY_KIND,
          tags: [
            ["e", ROW_ID],
            ["d", ROW_ID],
            ["h", CHANNEL],
            ["extra", "x"],
          ],
          content: JSON.stringify({
            reply_count: 0,
            descendant_count: 0,
            last_reply_at: null,
            participants: [],
          }),
        })
      )
    )
    expect(badCard._tag).toBe("Failure")

    const mismatch = await Effect.runPromiseExit(
      parseThreadSummary(
        fakeEvent({
          kind: THREAD_SUMMARY_KIND,
          tags: [
            ["e", ROW_ID],
            ["d", ROW_ID_2],
            ["h", CHANNEL],
          ],
          content: JSON.stringify({
            reply_count: 0,
            descendant_count: 0,
            last_reply_at: null,
            participants: [],
          }),
        })
      )
    )
    expect(mismatch._tag).toBe("Failure")
  })

  test("parseThreadSummary rejects bad content types", async () => {
    const exit = await Effect.runPromiseExit(
      parseThreadSummary(
        fakeEvent({
          kind: THREAD_SUMMARY_KIND,
          tags: [
            ["e", ROW_ID],
            ["d", ROW_ID],
            ["h", CHANNEL],
          ],
          content: "not-json",
        })
      )
    )
    expect(exit._tag).toBe("Failure")
  })

  test("parseWindowBounds accepts head page with has_more", async () => {
    const content = {
      has_more: true,
      next_cursor: { created_at: 1_751_499_000, id: ROW_ID },
    }
    const event = fakeEvent({
      kind: WINDOW_BOUNDS_KIND,
      tags: [
        ["d", `${CHANNEL}:head`],
        ["h", CHANNEL],
      ],
      content: JSON.stringify(content),
    })
    const parsed = await Effect.runPromise(
      parseWindowBounds(event, { channelId: CHANNEL, requestCursor: null })
    )
    expect(parsed.content.has_more).toBe(true)
    expect(parsed.content.next_cursor?.id).toBe(ROW_ID)
    expect(parsed.requestBinding).toBe("head")
  })

  test("parseWindowBounds rejects binding mismatch", async () => {
    const event = fakeEvent({
      kind: WINDOW_BOUNDS_KIND,
      tags: [
        ["d", `${CHANNEL}:head`],
        ["h", CHANNEL],
      ],
      content: JSON.stringify({ has_more: false, next_cursor: null }),
    })
    const exit = await Effect.runPromiseExit(
      parseWindowBounds(event, {
        channelId: CHANNEL,
        requestCursor: { created_at: 10, id: ROW_ID },
      })
    )
    expect(exit._tag).toBe("Failure")
  })

  test("parseWindowBounds rejects has_more/next_cursor invariant break", async () => {
    const event = fakeEvent({
      kind: WINDOW_BOUNDS_KIND,
      tags: [
        ["d", `${CHANNEL}:head`],
        ["h", CHANNEL],
      ],
      content: JSON.stringify({ has_more: true, next_cursor: null }),
    })
    const exit = await Effect.runPromiseExit(
      parseWindowBounds(event, { channelId: CHANNEL })
    )
    expect(exit._tag).toBe("Failure")
  })

  test("readWindowPageStructural assembles a page", async () => {
    const row = fakeEvent({ kind: 9, id: ROW_ID, content: "hello" })
    const summary = fakeEvent({
      kind: THREAD_SUMMARY_KIND,
      tags: [
        ["e", ROW_ID],
        ["d", ROW_ID],
        ["h", CHANNEL],
      ],
      content: JSON.stringify({
        reply_count: 1,
        descendant_count: 1,
        last_reply_at: 100,
        participants: [PK_A],
      }),
    })
    const bounds = fakeEvent({
      kind: WINDOW_BOUNDS_KIND,
      tags: [
        ["d", `${CHANNEL}:head`],
        ["h", CHANNEL],
      ],
      content: JSON.stringify({ has_more: false, next_cursor: null }),
    })
    const page = await Effect.runPromise(
      readWindowPageStructural([row, summary, bounds], {
        channelId: CHANNEL,
      })
    )
    expect(page.rows).toHaveLength(1)
    expect(page.summaries).toHaveLength(1)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  test("readWindowPageStructural fails without bounds (degrade signal)", async () => {
    const exit = await Effect.runPromiseExit(
      readWindowPageStructural([fakeEvent({ kind: 9 })], {
        channelId: CHANNEL,
      })
    )
    expect(exit._tag).toBe("Failure")
  })

  test("readWindowPageStructural fails on multiple bounds", async () => {
    const b = fakeEvent({
      kind: WINDOW_BOUNDS_KIND,
      tags: [
        ["d", `${CHANNEL}:head`],
        ["h", CHANNEL],
      ],
      content: JSON.stringify({ has_more: false, next_cursor: null }),
    })
    const exit = await Effect.runPromiseExit(
      readWindowPageStructural([b, b], { channelId: CHANNEL })
    )
    expect(exit._tag).toBe("Failure")
  })
})

// ---------------------------------------------------------------------------
// Identity-verified overlays (signed)
// ---------------------------------------------------------------------------

describe("ChannelWindowService identity-verified overlays", () => {
  test("verifyRelayOverlay accepts relay-signed 39006 and rejects wrong signer", async () => {
    const program = Effect.gen(function* () {
      const crypto = yield* CryptoService
      const cw = yield* ChannelWindowService
      const relaySk = yield* crypto.generatePrivateKey()
      const relayPk = yield* crypto.getPublicKey(relaySk)
      const otherSk = yield* crypto.generatePrivateKey()

      const bounds = yield* signOverlay(
        WINDOW_BOUNDS_KIND,
        [
          ["d", `${CHANNEL}:head`],
          ["h", CHANNEL],
        ],
        JSON.stringify({ has_more: false, next_cursor: null }),
        relaySk
      )

      yield* cw.verifyRelayOverlay(bounds, relayPk)

      const wrong = yield* Effect.flip(
        cw.verifyRelayOverlay(bounds, yield* crypto.getPublicKey(otherSk))
      )
      expect(wrong.reason).toBe("wrong_signer")

      // Tamper content → bad signature / id
      const tampered = { ...bounds, content: '{"has_more":true,"next_cursor":null}' }
      const bad = yield* Effect.flip(cw.verifyRelayOverlay(tampered, relayPk))
      expect(bad.reason).toBe("bad_signature")
    })

    await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(ServiceLayer, CryptoLayer)))
    )
  })

  test("readPage verifies all overlays when relay identity is provided", async () => {
    const program = Effect.gen(function* () {
      const crypto = yield* CryptoService
      const events = yield* EventService
      const cw = yield* ChannelWindowService
      const relaySk = yield* crypto.generatePrivateKey()
      const relayPk = yield* crypto.getPublicKey(relaySk)
      const authorSk = yield* crypto.generatePrivateKey()

      const row = yield* events.createEvent(
        {
          kind: decodeKind(9),
          tags: [decodeTag(["h", CHANNEL])],
          content: "top-level message",
          created_at: 1_700_000_010 as never,
        },
        authorSk
      )

      const summary = yield* signOverlay(
        THREAD_SUMMARY_KIND,
        [
          ["e", row.id],
          ["d", row.id],
          ["h", CHANNEL],
        ],
        JSON.stringify({
          reply_count: 2,
          descendant_count: 3,
          last_reply_at: 1_700_000_020,
          participants: [row.pubkey],
        }),
        relaySk
      )

      const bounds = yield* signOverlay(
        WINDOW_BOUNDS_KIND,
        [
          ["d", `${CHANNEL}:head`],
          ["h", CHANNEL],
        ],
        JSON.stringify({
          has_more: true,
          next_cursor: { created_at: row.created_at, id: row.id },
        }),
        relaySk
      )

      const page = yield* cw.readPage({
        events: [row, summary, bounds],
        channelId: CHANNEL,
        relayIdentityPubkey: relayPk,
      })

      expect(page.rows).toHaveLength(1)
      expect(page.summaries[0]?.rowId).toBe(row.id)
      expect(page.hasMore).toBe(true)
      expect(page.nextCursor?.id).toBe(row.id)

      // Continuation filter from bounds
      const headFilter = yield* cw.buildFilter({
        channelId: CHANNEL,
        kinds: [9],
        includeSummaries: true,
      })
      const nextFilter = yield* cw.continueFilter(
        headFilter,
        page.bounds.content
      )
      expect(nextFilter.until).toBe(row.created_at)
      expect(nextFilter.before_id).toBe(row.id)
    })

    await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(ServiceLayer, CryptoLayer)))
    )
  })

  test("readPage without relay identity still applies structural checks", async () => {
    const program = Effect.gen(function* () {
      const cw = yield* ChannelWindowService
      const bounds = fakeEvent({
        kind: WINDOW_BOUNDS_KIND,
        tags: [
          ["d", `${CHANNEL}:head`],
          ["h", CHANNEL],
        ],
        content: JSON.stringify({ has_more: false, next_cursor: null }),
      })
      const page = yield* cw.readPage({
        events: [fakeEvent({ kind: 9, content: "x" }), bounds],
        channelId: CHANNEL,
      })
      expect(page.hasMore).toBe(false)
      expect(page.rows).toHaveLength(1)
    })

    await Effect.runPromise(program.pipe(Effect.provide(ServiceLayer)))
  })
})
