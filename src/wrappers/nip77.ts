/**
 * NIP-77: Negentropy Sync Protocol
 *
 * Efficient set reconciliation for syncing events between client and relay.
 *
 * @example
 * ```typescript
 * import { NegentropyStorageVector, Negentropy } from 'nostr-effect/nip77'
 *
 * // Create storage and add items
 * const storage = new NegentropyStorageVector()
 * storage.insert(createdAt, eventId)
 * storage.seal()
 *
 * // Create negentropy instance
 * const neg = new Negentropy(storage)
 * const initMessage = neg.initiate()
 * ```
 */

import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { sha256 } from "@noble/hashes/sha256"

// Negentropy implementation by Doug Hoyte
const PROTOCOL_VERSION = 0x61 // Version 1
const ID_SIZE = 32
const FINGERPRINT_SIZE = 16

const Mode = {
  Skip: 0,
  Fingerprint: 1,
  IdList: 2,
}

class WrappedBuffer {
  _raw: Uint8Array
  length: number

  constructor(buffer?: Uint8Array | number) {
    if (typeof buffer === "number") {
      this._raw = new Uint8Array(buffer)
      this.length = 0
    } else if (buffer instanceof Uint8Array) {
      this._raw = new Uint8Array(buffer)
      this.length = buffer.length
    } else {
      this._raw = new Uint8Array(512)
      this.length = 0
    }
  }

  unwrap(): Uint8Array {
    return this._raw.subarray(0, this.length)
  }

  get capacity(): number {
    return this._raw.byteLength
  }

  extend(buf: Uint8Array | WrappedBuffer): void {
    if (buf instanceof WrappedBuffer) buf = buf.unwrap()
    if (typeof buf.length !== "number") throw Error("bad length")
    const targetSize = buf.length + this.length
    if (this.capacity < targetSize) {
      const oldRaw = this._raw
      const newCapacity = Math.max(this.capacity * 2, targetSize)
      this._raw = new Uint8Array(newCapacity)
      this._raw.set(oldRaw)
    }

    this._raw.set(buf, this.length)
    this.length += buf.length
  }

  shift(): number {
    const first = this._raw[0]!
    this._raw = this._raw.subarray(1)
    this.length--
    return first
  }

  shiftN(n: number = 1): Uint8Array {
    const firstSubarray = this._raw.subarray(0, n)
    this._raw = this._raw.subarray(n)
    this.length -= n
    return firstSubarray
  }
}

function decodeVarInt(buf: WrappedBuffer): number {
  let res = 0

  while (true) {
    if (buf.length === 0) throw Error("parse ends prematurely")
    const byte = buf.shift()
    res = (res << 7) | (byte & 127)
    if ((byte & 128) === 0) break
  }

  return res
}

function encodeVarInt(n: number): WrappedBuffer {
  if (n === 0) return new WrappedBuffer(new Uint8Array([0]))

  const o: number[] = []

  while (n !== 0) {
    o.push(n & 127)
    n >>>= 7
  }

  o.reverse()

  for (let i = 0; i < o.length - 1; i++) o[i]! |= 128

  return new WrappedBuffer(new Uint8Array(o))
}

function getByte(buf: WrappedBuffer): number {
  return getBytes(buf, 1)[0]!
}

function getBytes(buf: WrappedBuffer, n: number): Uint8Array {
  if (buf.length < n) throw Error("parse ends prematurely")
  return buf.shiftN(n)
}

class Accumulator {
  buf!: Uint8Array

  constructor() {
    this.setToZero()
  }

  setToZero(): void {
    this.buf = new Uint8Array(ID_SIZE)
  }

  add(otherBuf: Uint8Array): void {
    let currCarry = 0
    let nextCarry = 0
    const p = new DataView(this.buf.buffer)
    const po = new DataView(otherBuf.buffer)

    for (let i = 0; i < 8; i++) {
      const offset = i * 4
      const orig = p.getUint32(offset, true)
      const otherV = po.getUint32(offset, true)

      let next = orig

      next += currCarry
      next += otherV
      if (next > 0xffffffff) nextCarry = 1

      p.setUint32(offset, next & 0xffffffff, true)
      currCarry = nextCarry
      nextCarry = 0
    }
  }

  getFingerprint(n: number): Uint8Array {
    const input = new WrappedBuffer()
    input.extend(this.buf)
    input.extend(encodeVarInt(n))

    const hash = sha256(input.unwrap())
    return hash.subarray(0, FINGERPRINT_SIZE)
  }
}

/** Item type for storage */
export interface StorageItem {
  timestamp: number
  id: Uint8Array
}

/**
 * Storage vector for Negentropy
 */
export class NegentropyStorageVector {
  items: StorageItem[]
  sealed: boolean

  constructor() {
    this.items = []
    this.sealed = false
  }

  insert(timestamp: number, id: string): void {
    if (this.sealed) throw Error("already sealed")
    const idb = hexToBytes(id)
    if (idb.byteLength !== ID_SIZE) throw Error("bad id size for added item")
    this.items.push({ timestamp, id: idb })
  }

  seal(): void {
    if (this.sealed) throw Error("already sealed")
    this.sealed = true

    this.items.sort(itemCompare)

    for (let i = 1; i < this.items.length; i++) {
      if (itemCompare(this.items[i - 1]!, this.items[i]!) === 0) {
        throw Error("duplicate item inserted")
      }
    }
  }

  unseal(): void {
    this.sealed = false
  }

  size(): number {
    this._checkSealed()
    return this.items.length
  }

  getItem(i: number): StorageItem {
    this._checkSealed()
    if (i >= this.items.length) throw Error("out of range")
    return this.items[i]!
  }

  iterate(
    begin: number,
    end: number,
    cb: (item: StorageItem, i: number) => boolean
  ): void {
    this._checkSealed()
    this._checkBounds(begin, end)

    for (let i = begin; i < end; ++i) {
      if (!cb(this.items[i]!, i)) break
    }
  }

  findLowerBound(begin: number, end: number, bound: StorageItem): number {
    this._checkSealed()
    this._checkBounds(begin, end)

    return this._binarySearch(this.items, begin, end, (a) => itemCompare(a, bound) < 0)
  }

  fingerprint(begin: number, end: number): Uint8Array {
    const out = new Accumulator()
    out.setToZero()

    this.iterate(begin, end, (item) => {
      out.add(item.id)
      return true
    })

    return out.getFingerprint(end - begin)
  }

  _checkSealed(): void {
    if (!this.sealed) throw Error("not sealed")
  }

  _checkBounds(begin: number, end: number): void {
    if (begin > end || end > this.items.length) throw Error("bad range")
  }

  _binarySearch(
    arr: StorageItem[],
    first: number,
    last: number,
    cmp: (a: StorageItem) => boolean
  ): number {
    let count = last - first

    while (count > 0) {
      let it = first
      const step = Math.floor(count / 2)
      it += step

      if (cmp(arr[it]!)) {
        first = ++it
        count -= step + 1
      } else {
        count = step
      }
    }

    return first
  }
}

/**
 * Negentropy reconciliation engine
 */
export class Negentropy {
  storage: NegentropyStorageVector
  frameSizeLimit: number
  lastTimestampIn: number
  lastTimestampOut: number

  constructor(storage: NegentropyStorageVector, frameSizeLimit: number = 60_000) {
    if (frameSizeLimit < 4096) throw Error("frameSizeLimit too small")

    this.storage = storage
    this.frameSizeLimit = frameSizeLimit

    this.lastTimestampIn = 0
    this.lastTimestampOut = 0
  }

  _bound(timestamp: number, id?: Uint8Array): StorageItem {
    return { timestamp, id: id || new Uint8Array(0) }
  }

  initiate(): string {
    const output = new WrappedBuffer()
    output.extend(new Uint8Array([PROTOCOL_VERSION]))
    this.splitRange(0, this.storage.size(), this._bound(Number.MAX_VALUE), output)
    return bytesToHex(output.unwrap())
  }

  reconcile(
    queryMsg: string,
    onhave?: (id: string) => void,
    onneed?: (id: string) => void
  ): string | null {
    const query = new WrappedBuffer(hexToBytes(queryMsg))

    this.lastTimestampIn = this.lastTimestampOut = 0 // reset for each message

    const fullOutput = new WrappedBuffer()
    fullOutput.extend(new Uint8Array([PROTOCOL_VERSION]))

    const protocolVersion = getByte(query)
    if (protocolVersion < 0x60 || protocolVersion > 0x6f) {
      throw Error("invalid negentropy protocol version byte")
    }
    if (protocolVersion !== PROTOCOL_VERSION) {
      throw Error("unsupported negentropy protocol version requested: " + (protocolVersion - 0x60))
    }

    const storageSize = this.storage.size()
    let prevBound = this._bound(0)
    let prevIndex = 0
    let skip = false

    while (query.length !== 0) {
      const o = new WrappedBuffer()

      const doSkip = () => {
        if (skip) {
          skip = false
          o.extend(this.encodeBound(prevBound))
          o.extend(encodeVarInt(Mode.Skip))
        }
      }

      const currBound = this.decodeBound(query)
      const mode = decodeVarInt(query)

      const lower = prevIndex
      const upper = this.storage.findLowerBound(prevIndex, storageSize, currBound)

      if (mode === Mode.Skip) {
        skip = true
      } else if (mode === Mode.Fingerprint) {
        const theirFingerprint = getBytes(query, FINGERPRINT_SIZE)
        const ourFingerprint = this.storage.fingerprint(lower, upper)

        if (compareUint8Array(theirFingerprint, ourFingerprint) !== 0) {
          doSkip()
          this.splitRange(lower, upper, currBound, o)
        } else {
          skip = true
        }
      } else if (mode === Mode.IdList) {
        const numIds = decodeVarInt(query)

        const theirElems: { [key: string]: Uint8Array } = {}
        for (let i = 0; i < numIds; i++) {
          const e = getBytes(query, ID_SIZE)
          theirElems[bytesToHex(e)] = e
        }

        skip = true
        this.storage.iterate(lower, upper, (item) => {
          const k = item.id
          const id = bytesToHex(k)

          if (!theirElems[id]) {
            // ID exists on our side, but not their side
            onhave?.(id)
          } else {
            // ID exists on both sides
            delete theirElems[bytesToHex(k)]
          }

          return true
        })

        if (onneed) {
          for (const v of Object.values(theirElems)) {
            // ID exists on their side, but not our side
            onneed(bytesToHex(v))
          }
        }
      } else {
        throw Error("unexpected mode")
      }

      if (this.exceededFrameSizeLimit(fullOutput.length + o.length)) {
        // frameSizeLimit exceeded: return a fingerprint for the remaining range
        const remainingFingerprint = this.storage.fingerprint(upper, storageSize)

        fullOutput.extend(this.encodeBound(this._bound(Number.MAX_VALUE)))
        fullOutput.extend(encodeVarInt(Mode.Fingerprint))
        fullOutput.extend(remainingFingerprint)
        break
      } else {
        fullOutput.extend(o)
      }

      prevIndex = upper
      prevBound = currBound
    }

    return fullOutput.length === 1 ? null : bytesToHex(fullOutput.unwrap())
  }

  splitRange(
    lower: number,
    upper: number,
    upperBound: StorageItem,
    o: WrappedBuffer
  ): void {
    const numElems = upper - lower
    const buckets = 16

    if (numElems < buckets * 2) {
      o.extend(this.encodeBound(upperBound))
      o.extend(encodeVarInt(Mode.IdList))

      o.extend(encodeVarInt(numElems))
      this.storage.iterate(lower, upper, (item) => {
        o.extend(item.id)
        return true
      })
    } else {
      const itemsPerBucket = Math.floor(numElems / buckets)
      const bucketsWithExtra = numElems % buckets
      let curr = lower

      for (let i = 0; i < buckets; i++) {
        const bucketSize = itemsPerBucket + (i < bucketsWithExtra ? 1 : 0)
        const ourFingerprint = this.storage.fingerprint(curr, curr + bucketSize)
        curr += bucketSize

        let nextBound: StorageItem

        if (curr === upper) {
          nextBound = upperBound
        } else {
          let prevItem: StorageItem | undefined
          let currItem: StorageItem | undefined

          this.storage.iterate(curr - 1, curr + 1, (item, index) => {
            if (index === curr - 1) prevItem = item
            else currItem = item
            return true
          })

          nextBound = this.getMinimalBound(prevItem!, currItem!)
        }

        o.extend(this.encodeBound(nextBound))
        o.extend(encodeVarInt(Mode.Fingerprint))
        o.extend(ourFingerprint)
      }
    }
  }

  exceededFrameSizeLimit(n: number): boolean {
    return n > this.frameSizeLimit - 200
  }

  decodeTimestampIn(encoded: WrappedBuffer): number {
    let timestamp = decodeVarInt(encoded)
    timestamp = timestamp === 0 ? Number.MAX_VALUE : timestamp - 1
    if (this.lastTimestampIn === Number.MAX_VALUE || timestamp === Number.MAX_VALUE) {
      this.lastTimestampIn = Number.MAX_VALUE
      return Number.MAX_VALUE
    }
    timestamp += this.lastTimestampIn
    this.lastTimestampIn = timestamp
    return timestamp
  }

  decodeBound(encoded: WrappedBuffer): StorageItem {
    const timestamp = this.decodeTimestampIn(encoded)
    const len = decodeVarInt(encoded)
    if (len > ID_SIZE) throw Error("bound key too long")
    const id = getBytes(encoded, len)
    return { timestamp, id }
  }

  encodeTimestampOut(timestamp: number): WrappedBuffer {
    if (timestamp === Number.MAX_VALUE) {
      this.lastTimestampOut = Number.MAX_VALUE
      return encodeVarInt(0)
    }

    const temp = timestamp
    timestamp -= this.lastTimestampOut
    this.lastTimestampOut = temp
    return encodeVarInt(timestamp + 1)
  }

  encodeBound(key: StorageItem): WrappedBuffer {
    const output = new WrappedBuffer()

    output.extend(this.encodeTimestampOut(key.timestamp))
    output.extend(encodeVarInt(key.id.length))
    output.extend(key.id)

    return output
  }

  getMinimalBound(prev: StorageItem, curr: StorageItem): StorageItem {
    if (curr.timestamp !== prev.timestamp) {
      return this._bound(curr.timestamp)
    } else {
      let sharedPrefixBytes = 0
      const currKey = curr.id
      const prevKey = prev.id

      for (let i = 0; i < ID_SIZE; i++) {
        if (currKey[i] !== prevKey[i]) break
        sharedPrefixBytes++
      }

      return this._bound(curr.timestamp, curr.id.subarray(0, sharedPrefixBytes + 1))
    }
  }
}

function compareUint8Array(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i]! < b[i]!) return -1
    if (a[i]! > b[i]!) return 1
  }

  if (a.byteLength > b.byteLength) return 1
  if (a.byteLength < b.byteLength) return -1

  return 0
}

function itemCompare(a: StorageItem, b: StorageItem): number {
  if (a.timestamp === b.timestamp) {
    return compareUint8Array(a.id, b.id)
  }

  return a.timestamp - b.timestamp
}
