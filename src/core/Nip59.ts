/**
 * NIP-59: Gift Wrap
 * https://github.com/nostr-protocol/nips/blob/master/59.md
 *
 * Private event wrapping using NIP-44 encryption
 */
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, randomBytes } from "@noble/hashes/utils"
import { schnorr, secp256k1 } from "@noble/curves/secp256k1"
import { extract, expand } from "@noble/hashes/hkdf"
import { hmac } from "@noble/hashes/hmac"
import { chacha20 } from "@noble/ciphers/chacha"
import type { EventKind, PublicKey, UnixTimestamp, EventId, Signature } from "./Schema.js"

/** Kind 13: Seal - encrypted rumor */
export const SEAL_KIND = 13 as EventKind

/** Kind 1059: Gift Wrap - encrypted seal */
export const GIFT_WRAP_KIND = 1059 as EventKind

const TWO_DAYS = 2 * 24 * 60 * 60
const SALT = new TextEncoder().encode("nip44-v2")

const now = () => Math.floor(Date.now() / 1000)
const randomNow = () => Math.floor(now() - Math.random() * TWO_DAYS)

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Unsigned event (rumor) - the actual content being wrapped
 */
export interface UnsignedEvent {
  readonly kind: EventKind
  readonly content: string
  readonly tags: readonly (readonly string[])[]
  readonly created_at?: UnixTimestamp
  readonly pubkey?: PublicKey
}

/**
 * Rumor - unsigned event with id
 */
export interface Rumor extends UnsignedEvent {
  readonly id: EventId
  readonly pubkey: PublicKey
  readonly created_at: UnixTimestamp
}

/**
 * Sealed event structure
 */
export interface SealedEvent {
  readonly id: EventId
  readonly pubkey: PublicKey
  readonly created_at: UnixTimestamp
  readonly kind: typeof SEAL_KIND
  readonly tags: readonly []
  readonly content: string
  readonly sig: Signature
}

/**
 * Gift wrapped event structure
 */
export interface GiftWrappedEvent {
  readonly id: EventId
  readonly pubkey: PublicKey
  readonly created_at: UnixTimestamp
  readonly kind: typeof GIFT_WRAP_KIND
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly sig: Signature
}

// NIP-44 encryption helpers
function getConversationKey(privateKey: Uint8Array, publicKey: string): Uint8Array {
  const shared = secp256k1.getSharedSecret(privateKey, "02" + publicKey)
  return extract(sha256, shared.subarray(1, 33), SALT)
}

function calcPaddedLen(unpaddedLen: number): number {
  if (unpaddedLen <= 32) return 32
  const nextPower = 1 << (Math.floor(Math.log2(unpaddedLen - 1)) + 1)
  const chunk = nextPower <= 256 ? 32 : nextPower / 8
  return chunk * (Math.floor((unpaddedLen - 1) / chunk) + 1)
}

function pad(plaintext: string): Uint8Array {
  const unpadded = utf8Encoder.encode(plaintext)
  const unpaddedLen = unpadded.length
  if (unpaddedLen < 1 || unpaddedLen > 65535) throw new Error("Invalid plaintext length")
  const paddedLen = calcPaddedLen(unpaddedLen)
  const padded = new Uint8Array(2 + paddedLen)
  new DataView(padded.buffer).setUint16(0, unpaddedLen, false)
  padded.set(unpadded, 2)
  return padded
}

function unpad(padded: Uint8Array): string {
  const unpaddedLen = new DataView(padded.buffer, padded.byteOffset).getUint16(0, false)
  const unpadded = padded.subarray(2, 2 + unpaddedLen)
  if (unpaddedLen < 1 || unpaddedLen > 65535 || unpadded.length !== unpaddedLen) {
    throw new Error("Invalid padding")
  }
  return utf8Decoder.decode(unpadded)
}

function nip44Encrypt(plaintext: string, conversationKey: Uint8Array): string {
  const nonce = randomBytes(32)
  const keys = expand(sha256, conversationKey, nonce, 76)
  const chachaKey = keys.subarray(0, 32)
  const chachaNonce = keys.subarray(32, 44)
  const hmacKey = keys.subarray(44, 76)
  const padded = pad(plaintext)
  const ciphertext = chacha20(chachaKey, chachaNonce, padded)
  const mac = hmac(sha256, hmacKey, ciphertext)
  const payload = new Uint8Array(1 + 32 + ciphertext.length + 32)
  payload[0] = 2
  payload.set(nonce, 1)
  payload.set(ciphertext, 33)
  payload.set(mac, 33 + ciphertext.length)
  return btoa(String.fromCharCode(...payload))
}

function nip44Decrypt(payload: string, conversationKey: Uint8Array): string {
  const data = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
  if (data[0] !== 2) throw new Error("Invalid version")
  const nonce = data.subarray(1, 33)
  const ciphertext = data.subarray(33, data.length - 32)
  const mac = data.subarray(data.length - 32)
  const keys = expand(sha256, conversationKey, nonce, 76)
  const chachaKey = keys.subarray(0, 32)
  const chachaNonce = keys.subarray(32, 44)
  const hmacKey = keys.subarray(44, 76)
  const calculatedMac = hmac(sha256, hmacKey, ciphertext)
  if (!calculatedMac.every((b, i) => b === mac[i])) throw new Error("Invalid MAC")
  const padded = chacha20(chachaKey, chachaNonce, ciphertext)
  return unpad(padded)
}

function getEventHash(event: {
  pubkey: string
  created_at: number
  kind: number
  tags: readonly (readonly string[])[]
  content: string
}): string {
  return bytesToHex(
    sha256(
      utf8Encoder.encode(
        JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
      )
    )
  )
}

function signEvent(
  event: { id: string; pubkey: string; created_at: number; kind: number; tags: readonly (readonly string[])[]; content: string },
  privateKey: Uint8Array
): string {
  return bytesToHex(schnorr.sign(event.id, privateKey))
}

function getPublicKey(privateKey: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(privateKey))
}

function generateSecretKey(): Uint8Array {
  return schnorr.utils.randomPrivateKey()
}

/**
 * Create a rumor (unsigned event with id)
 */
export function createRumor(event: Partial<UnsignedEvent>, privateKey: Uint8Array): Rumor {
  const pubkey = getPublicKey(privateKey) as PublicKey
  const created_at = (event.created_at ?? now()) as UnixTimestamp

  const rumor = {
    kind: event.kind ?? (1 as EventKind),
    content: event.content ?? "",
    tags: event.tags ?? [],
    pubkey,
    created_at,
  }

  const id = getEventHash(rumor) as EventId

  return { ...rumor, id }
}

/**
 * Create a seal (encrypted rumor)
 */
export function createSeal(rumor: Rumor, senderPrivateKey: Uint8Array, recipientPublicKey: string): SealedEvent {
  const conversationKey = getConversationKey(senderPrivateKey, recipientPublicKey)
  const encryptedContent = nip44Encrypt(JSON.stringify(rumor), conversationKey)

  const senderPubkey = getPublicKey(senderPrivateKey) as PublicKey
  const created_at = randomNow() as UnixTimestamp

  const unsigned = {
    kind: SEAL_KIND,
    pubkey: senderPubkey,
    created_at,
    tags: [] as readonly [],
    content: encryptedContent,
  }

  const id = getEventHash(unsigned) as EventId
  const sig = signEvent({ ...unsigned, id }, senderPrivateKey) as Signature

  return { ...unsigned, id, sig }
}

/**
 * Create a gift wrap (encrypted seal with random sender)
 */
export function createWrap(seal: SealedEvent, recipientPublicKey: string): GiftWrappedEvent {
  const randomKey = generateSecretKey()
  const randomPubkey = getPublicKey(randomKey) as PublicKey

  const conversationKey = getConversationKey(randomKey, recipientPublicKey)
  const encryptedContent = nip44Encrypt(JSON.stringify(seal), conversationKey)

  const created_at = randomNow() as UnixTimestamp

  const unsigned = {
    kind: GIFT_WRAP_KIND,
    pubkey: randomPubkey,
    created_at,
    tags: [["p", recipientPublicKey]] as readonly (readonly string[])[],
    content: encryptedContent,
  }

  const id = getEventHash(unsigned) as EventId
  const sig = signEvent({ ...unsigned, id }, randomKey) as Signature

  return { ...unsigned, id, sig }
}

/**
 * Wrap an event for a recipient
 */
export function wrapEvent(event: Partial<UnsignedEvent>, senderPrivateKey: Uint8Array, recipientPublicKey: string): GiftWrappedEvent {
  const rumor = createRumor(event, senderPrivateKey)
  const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey)
  return createWrap(seal, recipientPublicKey)
}

/**
 * Wrap an event for multiple recipients (including sender)
 */
export function wrapManyEvents(
  event: Partial<UnsignedEvent>,
  senderPrivateKey: Uint8Array,
  recipientsPublicKeys: readonly string[]
): readonly GiftWrappedEvent[] {
  if (!recipientsPublicKeys || recipientsPublicKeys.length === 0) {
    throw new Error("At least one recipient is required.")
  }

  const senderPublicKey = getPublicKey(senderPrivateKey)

  const wrappedForSender = wrapEvent(event, senderPrivateKey, senderPublicKey)

  const wrappedForRecipients = recipientsPublicKeys.map((recipientPublicKey) =>
    wrapEvent(event, senderPrivateKey, recipientPublicKey)
  )

  return [wrappedForSender, ...wrappedForRecipients]
}

/**
 * Unwrap a gift-wrapped event
 */
export function unwrapEvent(wrap: GiftWrappedEvent, recipientPrivateKey: Uint8Array): Rumor {
  const wrapConversationKey = getConversationKey(recipientPrivateKey, wrap.pubkey)
  const sealJson = nip44Decrypt(wrap.content, wrapConversationKey)
  const seal = JSON.parse(sealJson) as SealedEvent

  const sealConversationKey = getConversationKey(recipientPrivateKey, seal.pubkey)
  const rumorJson = nip44Decrypt(seal.content, sealConversationKey)
  const rumor = JSON.parse(rumorJson) as Rumor

  return rumor
}

/**
 * Unwrap multiple gift-wrapped events
 */
export function unwrapManyEvents(wrappedEvents: readonly GiftWrappedEvent[], recipientPrivateKey: Uint8Array): readonly Rumor[] {
  const unwrapped = wrappedEvents.map((wrap) => unwrapEvent(wrap, recipientPrivateKey))
  return [...unwrapped].sort((a, b) => a.created_at - b.created_at)
}
