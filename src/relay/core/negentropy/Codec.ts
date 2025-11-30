/**
 * Minimal Negentropy V1 codec helpers (IdList mode only)
 *
 * Message := 0x61 <Range>*
 * Range := <Bound> <mode Varint> <payload>
 * Bound := <encodedTimestamp Varint> <length Varint> <idPrefix bytes>
 * For our minimal implementation, we emit a single Range with upperBound = Infinity
 * (encodedTimestamp=0, length=0), mode=2 (IdList), and payload of ids.
 */

// =============================================================================
// Hex helpers
// =============================================================================

export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

// =============================================================================
// Varint (MSB set on all but last byte, big-endian base-128)
// =============================================================================

export const encodeVarint = (n: number): Uint8Array => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid varint")
  // Encode to base128 big-endian with msb set except last
  const digits: number[] = []
  do {
    digits.push(n & 0x7f)
    n >>>= 7
  } while (n > 0)
  digits.reverse()
  for (let i = 0; i < digits.length - 1; i++) digits[i] = (digits[i]! | 0x80)
  return Uint8Array.from(digits)
}

export const decodeVarint = (buf: Uint8Array, offset: number): { value: number; next: number } => {
  let value = 0
  let i = offset
  while (i < buf.length) {
    const byte = buf[i]!
    i++
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) return { value, next: i }
  }
  throw new Error("varint truncated")
}

// =============================================================================
// Message encode/decode (IdList only)
// =============================================================================

export const encodeIdListMessage = (ids: readonly string[]): string => {
  const parts: Uint8Array[] = []
  // version
  parts.push(Uint8Array.from([0x61]))
  // Bound: Infinity → encodedTimestamp = 0, length = 0
  parts.push(Uint8Array.from([0x00, 0x00]))
  // mode = 2 (IdList)
  parts.push(encodeVarint(2))
  // payload length (number of ids)
  parts.push(encodeVarint(ids.length))
  // ids bytes
  for (const h of ids) parts.push(hexToBytes(h))
  // concat
  const len = parts.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(len)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return bytesToHex(out)
}

export const decodeIdListMessage = (hex: string): { ids: string[] } => {
  const buf = hexToBytes(hex)
  if (buf.length === 0) throw new Error("empty message")
  const ver = buf[0]
  if (ver !== 0x61) throw new Error("unsupported version")
  let i = 1
  // Bound: encodedTimestamp varint
  const ts = decodeVarint(buf, i)
  i = ts.next
  // idPrefix length
  const ln = decodeVarint(buf, i)
  i = ln.next + ln.value // skip idPrefix bytes
  // mode
  const mode = decodeVarint(buf, i)
  i = mode.next
  if (mode.value !== 2) throw new Error("unsupported mode")
  // length
  const len = decodeVarint(buf, i)
  i = len.next
  const ids: string[] = []
  for (let k = 0; k < len.value; k++) {
    if (i + 32 > buf.length) throw new Error("truncated id list")
    ids.push(bytesToHex(buf.slice(i, i + 32)))
    i += 32
  }
  return { ids }
}
