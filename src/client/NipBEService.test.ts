/**
 * NipBEService tests (NIP-BE BLE framing)
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { NipBEService, NipBEServiceLive, DEFAULT_CHUNK_SIZE, MAX_MESSAGE_BYTES } from "./NipBEService.js"

const provide = (eff: any) => eff.pipe(Effect.provide(NipBEServiceLive))

describe("NipBEService (NIP-BE)", () => {
  test("fragment + reassemble roundtrip small message", async () => {
    const program = Effect.gen(function* () {
      const be = yield* NipBEService
      const msg = JSON.stringify(["EVENT", { id: "x" }])
      const chunks = yield* be.fragment(msg, { chunkSize: 64 })
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      // last flag set on final
      const last = chunks[chunks.length - 1]!
      expect(last[last.length - 1]).toBe(1)
      const text = yield* be.reassemble(chunks)
      expect(text).toBe(msg)
    })
    await Effect.runPromise(provide(program))
  })

  test("fragment splits large message into many chunks and reassembles", async () => {
    const program = Effect.gen(function* () {
      const be = yield* NipBEService
      // Build semi-random content that doesn't compress too aggressively
      const big = Array.from({ length: 50_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 90))).join("")
      const msg = JSON.stringify(["EVENT", { id: "y", content: big }])
      const chunks = yield* be.fragment(msg, { chunkSize: 64 })
      expect(chunks.length).toBeGreaterThan(1)
      const text = yield* be.reassemble(chunks)
      expect(text).toBe(msg)
    })
    await Effect.runPromise(provide(program))
  })

  test("rejects message larger than 64KiB", async () => {
    const tooBigContent = "B".repeat(MAX_MESSAGE_BYTES + 10)
    const msg = tooBigContent
    const eff = Effect.gen(function* () {
      const be = yield* NipBEService
      return yield* be.fragment(msg)
    }).pipe(Effect.provide(NipBEServiceLive))
    await expect(Effect.runPromise(eff)).rejects.toThrow(/message too large/i)
  })

  test("reassemble fails when last flag missing", async () => {
    const program = Effect.gen(function* () {
      const be = yield* NipBEService
      const msg = JSON.stringify(["EVENT", { id: "z" }])
      const chunks = (yield* be.fragment(msg, { chunkSize: DEFAULT_CHUNK_SIZE })).map((c) => new Uint8Array(c))
      // Flip last flag off
      const last = chunks[chunks.length - 1]!
      last[last.length - 1] = 0
      const eff = be.reassemble(chunks)
      return yield* eff
    }).pipe(Effect.provide(NipBEServiceLive))
    await expect(Effect.runPromise(program)).rejects.toThrow(/missing last flag/i)
  })
})
