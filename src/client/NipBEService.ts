/**
 * NipBEService
 *
 * NIP-BE: Nostr BLE Communications Protocol (chunking + DEFLATE framing)
 * Client-side utilities to fragment and reassemble NIP-01 messages
 * for BLE transport using compressed chunks per the spec.
 */
import { Context, Effect, Layer } from "effect"
import { deflate, inflate } from "pako"

// =============================================================================
// Constants
// =============================================================================

/** Maximum uncompressed message size in bytes (64 KiB) */
export const MAX_MESSAGE_BYTES = 64 * 1024

/** Default BLE-safe chunk payload size (bytes) */
export const DEFAULT_CHUNK_SIZE = 200

// Frame layout:
// [ index_hi (1 byte) | index_lo (1 byte) | ...payload... | last_flag (1 byte: 0|1) ]
// - index is big-endian 16-bit (0..65534)
// - last_flag = 1 for the final chunk, otherwise 0

// =============================================================================
// Types
// =============================================================================

export interface FragmentOptions {
  readonly chunkSize?: number
}

export interface NipBEService {
  readonly _tag: "NipBEService"

  /**
   * Compress and fragment a JSON NIP-01 message string into BLE-sized chunks.
   * Enforces 64KiB max for the input (uncompressed) message.
   */
  fragment(message: string, opts?: FragmentOptions): Effect.Effect<readonly Uint8Array[], Error>

  /**
   * Reassemble and decompress BLE chunks back into the original JSON string.
   * Validates chunk ordering and last-flag presence.
   */
  reassemble(chunks: readonly Uint8Array[]): Effect.Effect<string, Error>

  /** Low-level helpers exposed for testing */
  compress(data: Uint8Array): Effect.Effect<Uint8Array, never>
  decompress(data: Uint8Array): Effect.Effect<Uint8Array, Error>
}

export const NipBEService = Context.GenericTag<NipBEService>("NipBEService")

// =============================================================================
// Implementation
// =============================================================================

function u8(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function beIndex(i: number): [number, number] {
  return [(i >> 8) & 0xff, i & 0xff]
}

const make = Effect.gen(function* () {
  const compress: NipBEService["compress"] = (data) => Effect.succeed(u8(deflate(data)))

  const decompress: NipBEService["decompress"] = (data) =>
    Effect.try({
      try: () => u8(inflate(data)),
      catch: (e) => new Error(`inflate failed: ${String(e)}`),
    })

  const fragment: NipBEService["fragment"] = (message, opts) =>
    Effect.gen(function* () {
      // Validate input size (UTF-8)
      const encoded = new TextEncoder().encode(message)
      if (encoded.byteLength > MAX_MESSAGE_BYTES) {
        return yield* Effect.fail(
          new Error(`message too large: ${encoded.byteLength} bytes (max ${MAX_MESSAGE_BYTES})`)
        )
      }

      const compressed = yield* compress(encoded)
      const chunkSize = Math.max(32, Math.min(1024, opts?.chunkSize ?? DEFAULT_CHUNK_SIZE))
      const head = 2 // index bytes
      const tail = 1 // last flag
      const payloadSize = Math.max(1, chunkSize - head - tail)

      const chunks: Uint8Array[] = []
      let index = 0
      for (let offset = 0; offset < compressed.byteLength; offset += payloadSize) {
        const end = Math.min(offset + payloadSize, compressed.byteLength)
        const slice = compressed.subarray(offset, end)
        const buf = new Uint8Array(head + slice.byteLength + tail)
        const [hi, lo] = beIndex(index)
        buf[0] = hi
        buf[1] = lo
        buf.set(slice, head)
        const isLast = end >= compressed.byteLength ? 1 : 0
        buf[buf.length - 1] = isLast
        chunks.push(buf)
        index++
      }

      if (chunks.length === 0) {
        // Even empty string should produce a single empty payload chunk
        const buf = new Uint8Array(3)
        buf[0] = 0
        buf[1] = 0
        buf[2] = 1 // last
        chunks.push(buf)
      }

      return chunks
    })

  const reassemble: NipBEService["reassemble"] = (chunks) =>
    Effect.gen(function* () {
      if (chunks.length === 0) return ""

      // Sort by index and validate continuity; also check last-flag on the last chunk
      const sorted = [...chunks].sort(
        (a, b) => ((a[0]! << 8) + a[1]!) - (((b[0]! << 8) + b[1]!))
      )
      for (let i = 0; i < sorted.length; i++) {
        const ci = sorted[i]!
        const idx = (ci[0]! << 8) + (ci[1]!)
        if (idx !== i) return yield* Effect.fail(new Error(`chunk index gap at ${i}`))
      }
      const last = sorted[sorted.length - 1]!
      if (last[last.length - 1] !== 1) {
        return yield* Effect.fail(new Error("missing last flag on final chunk"))
      }

      // Join payloads (strip 2-byte index and 1-byte last flag)
      const total = sorted.reduce((acc, c) => acc + (c.length - 3), 0)
      const joined = new Uint8Array(total)
      let pos = 0
      for (const c of sorted) {
        const payload = c.subarray(2, c.length - 1)
        joined.set(payload, pos)
        pos += payload.length
      }

      const decompressed = yield* decompress(joined)
      const text = new TextDecoder().decode(decompressed)
      return text
    })

  return {
    _tag: "NipBEService" as const,
    fragment,
    reassemble,
    compress,
    decompress,
  }
})

export const NipBEServiceLive = Layer.effect(NipBEService, make)
