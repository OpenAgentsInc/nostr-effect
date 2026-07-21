/**
 * NIP-AB: Device Pairing
 *
 * Pure protocol layer for QR-initiated, end-to-end encrypted secret transfer
 * between two devices over standard Nostr relays.
 *
 * Crypto: secp256k1 ECDH (unhashed x-coordinate), HKDF-SHA256 for session_id /
 * SAS / transcript, NIP-44 v2 for message encryption. Kind 24134 ephemeral
 * events carry all pairing messages.
 *
 * This module is I/O-free: callers publish/subscribe pairing events and drive
 * user confirmation; {@link PairingSession} is the state machine.
 *
 * @see ~/work/projects/repos/buzz/crates/buzz-core/src/pairing/NIP-AB.md
 */
import { schnorr, secp256k1 } from "@noble/curves/secp256k1"
import { chacha20 } from "@noble/ciphers/chacha"
import { equalBytes } from "@noble/ciphers/utils"
import { extract, expand } from "@noble/hashes/hkdf"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils"
import type {
  EventId,
  EventKind,
  NostrEvent,
  PrivateKey,
  PublicKey,
  Signature,
  UnixTimestamp,
} from "./Schema.js"

// =============================================================================
// Constants
// =============================================================================

/** Kind 24134: Device Pairing message (ephemeral range) */
export const PAIRING_KIND = 24134 as EventKind

/** Protocol version currently implemented */
export const PROTOCOL_VERSION = 1

/** Maximum session lifetime from creation (seconds) */
export const SESSION_TIMEOUT_SECS = 120

/** Maximum wait per protocol step (seconds) */
export const STEP_TIMEOUT_SECS = 30

/** Maximum total length of a `nostrpair://` URI */
export const MAX_URI_LEN = 2048

/** Safe practical max for the `payload` field (NIP-44 limit minus JSON envelope) */
export const MAX_PAYLOAD_LEN = 65_400

/** NIP-44 v2 plaintext limit */
export const MAX_PLAINTEXT_LEN = 65_535

/** NIP-44 v2 content length bounds (base64 characters) */
export const NIP44_CONTENT_MIN = 132
export const NIP44_CONTENT_MAX = 87_472

const INFO_SESSION_ID = new TextEncoder().encode("nostr-pair-session-id")
const INFO_SAS = new TextEncoder().encode("nostr-pair-sas-v1")
const INFO_TRANSCRIPT = new TextEncoder().encode("nostr-pair-transcript-v1")
const NIP44_SALT = new TextEncoder().encode("nip44-v2")
const SAS_MODULUS = 1_000_000
const HEX64 = /^[0-9a-f]{64}$/
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

// =============================================================================
// Errors
// =============================================================================

export type PairingErrorReason =
  | "invalid_qr"
  | "invalid_session_id"
  | "sas_mismatch"
  | "transcript_mismatch"
  | "unexpected_message"
  | "session_expired"
  | "nip44"
  | "json"
  | "invalid_pubkey"
  | "signing_error"
  | "protocol_error"

export class PairingError extends Error {
  readonly reason: PairingErrorReason
  readonly expected: string | undefined
  readonly got: string | undefined

  constructor(
    reason: PairingErrorReason,
    message: string,
    extra?: { expected?: string; got?: string }
  ) {
    super(message)
    this.name = "PairingError"
    this.reason = reason
    this.expected = extra?.expected
    this.got = extra?.got
  }
}

// =============================================================================
// Message types
// =============================================================================

export type PayloadType = "nsec" | "bunker" | "connect" | "custom"

export type AbortReason =
  | "sas_mismatch"
  | "user_denied"
  | "timeout"
  | "protocol_error"
  | "unknown"

export type PairingMessage =
  | { readonly type: "offer"; readonly version: number; readonly session_id: string }
  | { readonly type: "sas-confirm"; readonly transcript_hash: string }
  | {
      readonly type: "payload"
      readonly payload_type: PayloadType
      readonly payload: string
    }
  | { readonly type: "complete"; readonly success: boolean }
  | { readonly type: "abort"; readonly reason: AbortReason }

export type Role = "source" | "target"

export type SessionState =
  | "Waiting"
  | "Confirming"
  | "AwaitingConfirmation"
  | "Transferring"
  | "PayloadExchanged"
  | "Completed"
  | "Aborted"

/** QR payload carried by `nostrpair://` URIs */
export interface QrPayload {
  readonly sourcePubkey: PublicKey
  readonly sessionSecret: Uint8Array
  readonly relays: readonly string[]
  readonly version: number
}

// =============================================================================
// Crypto helpers (normative)
// =============================================================================

/** HKDF-SHA256 → 32 bytes. Empty salt is a zero-length byte array. */
export const hkdf32 = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Uint8Array => {
  const prk = extract(sha256, ikm, salt)
  return expand(sha256, prk, info, 32)
}

/**
 * session_id = HKDF-SHA256(IKM=session_secret, salt=[], info="nostr-pair-session-id", L=32)
 */
export const deriveSessionId = (sessionSecret: Uint8Array): Uint8Array => {
  if (sessionSecret.length !== 32) {
    throw new PairingError("invalid_session_id", "session_secret must be 32 bytes")
  }
  return hkdf32(sessionSecret, new Uint8Array(0), INFO_SESSION_ID)
}

/**
 * sas_input = HKDF-SHA256(IKM=ecdh_shared, salt=session_secret, info="nostr-pair-sas-v1", L=32)
 * sas_code  = be_u32(sas_input[0..4]) mod 1_000_000
 */
export const deriveSas = (
  ecdhShared: Uint8Array,
  sessionSecret: Uint8Array
): { sasCode: number; sasInput: Uint8Array } => {
  if (ecdhShared.length !== 32 || sessionSecret.length !== 32) {
    throw new PairingError("protocol_error", "ecdh_shared and session_secret must be 32 bytes")
  }
  const sasInput = hkdf32(ecdhShared, sessionSecret, INFO_SAS)
  const n =
    (((sasInput[0]! << 24) | (sasInput[1]! << 16) | (sasInput[2]! << 8) | sasInput[3]!) >>> 0) %
    SAS_MODULUS
  return { sasCode: n, sasInput }
}

/**
 * transcript = session_id || source_pubkey || target_pubkey || sas_input  (128 bytes)
 * transcript_hash = HKDF-SHA256(IKM=transcript, salt=session_secret, info="nostr-pair-transcript-v1", L=32)
 */
export const deriveTranscriptHash = (
  sessionId: Uint8Array,
  sourcePubkey: Uint8Array,
  targetPubkey: Uint8Array,
  sasInput: Uint8Array,
  sessionSecret: Uint8Array
): Uint8Array => {
  if (
    sessionId.length !== 32 ||
    sourcePubkey.length !== 32 ||
    targetPubkey.length !== 32 ||
    sasInput.length !== 32 ||
    sessionSecret.length !== 32
  ) {
    throw new PairingError("protocol_error", "transcript inputs must all be 32 bytes")
  }
  const transcript = new Uint8Array(128)
  transcript.set(sessionId, 0)
  transcript.set(sourcePubkey, 32)
  transcript.set(targetPubkey, 64)
  transcript.set(sasInput, 96)
  return hkdf32(transcript, sessionSecret, INFO_TRANSCRIPT)
}

/** Zero-padded 6-digit SAS string */
export const formatSas = (code: number): string =>
  String(code % SAS_MODULUS).padStart(6, "0")

/**
 * Constant-time equality for equal-length byte arrays.
 * Returns false if lengths differ.
 */
export const ctEq = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!
  }
  return result === 0
}

/**
 * Unhashed ECDH shared x-coordinate (BIP-340 bytes(P)).
 * ⚠️ Many libraries hash ECDH by default — this MUST NOT.
 */
export const ecdhSharedX = (privateKeyHex: string, publicKeyHex: string): Uint8Array => {
  const priv = hexToBytes(privateKeyHex)
  const pub = hexToBytes(publicKeyHex)
  if (priv.length !== 32 || pub.length !== 32) {
    throw new PairingError("invalid_pubkey", "ECDH keys must be 32-byte hex")
  }
  // Compressed even-y form for x-only schnorr pubkeys (same convention as NIP-44)
  const fullPub = new Uint8Array(33)
  fullPub[0] = 0x02
  fullPub.set(pub, 1)
  const sharedPoint = secp256k1.getSharedSecret(priv, fullPub)
  // getSharedSecret returns 33-byte compressed or 65-byte uncompressed; x is [1..33)
  return sharedPoint.slice(1, 33)
}

// =============================================================================
// NIP-44 v2 helpers (conversation key + encrypt/decrypt)
// =============================================================================

const getConversationKey = (privateKeyHex: string, publicKeyHex: string): Uint8Array => {
  const sharedX = ecdhSharedX(privateKeyHex, publicKeyHex)
  return extract(sha256, sharedX, NIP44_SALT)
}

const calcPaddedLen = (unpaddedLen: number): number => {
  if (unpaddedLen <= 32) return 32
  const nextPower = 1 << (Math.floor(Math.log2(unpaddedLen - 1)) + 1)
  const chunk = nextPower <= 256 ? 32 : nextPower / 8
  return chunk * (Math.floor((unpaddedLen - 1) / chunk) + 1)
}

const pad = (plaintext: string): Uint8Array => {
  const unpadded = utf8Encoder.encode(plaintext)
  if (unpadded.length < 1 || unpadded.length > MAX_PLAINTEXT_LEN) {
    throw new PairingError("nip44", `Invalid plaintext length: ${unpadded.length}`)
  }
  const paddedLen = calcPaddedLen(unpadded.length)
  const padded = new Uint8Array(2 + paddedLen)
  padded[0] = (unpadded.length >> 8) & 0xff
  padded[1] = unpadded.length & 0xff
  padded.set(unpadded, 2)
  return padded
}

const unpad = (padded: Uint8Array): string => {
  if (padded.length < 2) throw new PairingError("nip44", "Invalid padded data")
  const unpaddedLen = (padded[0]! << 8) | padded[1]!
  if (unpaddedLen === 0 || padded.length < 2 + unpaddedLen) {
    throw new PairingError("nip44", "Invalid padding")
  }
  const expected = 2 + calcPaddedLen(unpaddedLen)
  if (padded.length !== expected) {
    throw new PairingError("nip44", "Invalid padding length")
  }
  return utf8Decoder.decode(padded.subarray(2, 2 + unpaddedLen))
}

const getMessageKeys = (conversationKey: Uint8Array, nonce: Uint8Array) => {
  const keys = expand(sha256, conversationKey, nonce, 76)
  return {
    chachaKey: keys.subarray(0, 32),
    chachaNonce: keys.subarray(32, 44),
    hmacKey: keys.subarray(44, 76),
  }
}

const hmacAad = (key: Uint8Array, message: Uint8Array, aad: Uint8Array): Uint8Array => {
  const combined = new Uint8Array(aad.length + message.length)
  combined.set(aad)
  combined.set(message, aad.length)
  return hmac(sha256, key, combined)
}

/** Encrypt a pairing message JSON via NIP-44 v2. */
export const encryptMessage = (
  message: PairingMessage,
  senderPrivkey: string,
  recipientPubkey: string
): string => {
  const plaintext = JSON.stringify(message)
  if (utf8Encoder.encode(plaintext).length > MAX_PLAINTEXT_LEN) {
    throw new PairingError("nip44", "Plaintext exceeds NIP-44 limit")
  }
  const conversationKey = getConversationKey(senderPrivkey, recipientPubkey)
  const nonce = randomBytes(32)
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(conversationKey, nonce)
  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext))
  const mac = hmacAad(hmacKey, ciphertext, nonce)
  const result = new Uint8Array(1 + 32 + ciphertext.length + 32)
  result[0] = 2
  result.set(nonce, 1)
  result.set(ciphertext, 33)
  result.set(mac, 33 + ciphertext.length)
  return btoa(String.fromCharCode(...result))
}

/** Decrypt NIP-44 v2 content to a pairing message. */
export const decryptMessage = (
  content: string,
  recipientPrivkey: string,
  senderPubkey: string
): PairingMessage => {
  if (content.length < NIP44_CONTENT_MIN || content.length > NIP44_CONTENT_MAX) {
    throw new PairingError("nip44", `content length out of range: ${content.length}`)
  }
  let data: Uint8Array
  try {
    data = Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
  } catch {
    throw new PairingError("nip44", "Invalid base64 content")
  }
  if (data[0] !== 2) {
    throw new PairingError("nip44", `Unsupported NIP-44 version: ${data[0]}`)
  }
  const nonce = data.subarray(1, 33)
  const ciphertext = data.subarray(33, data.length - 32)
  const mac = data.subarray(data.length - 32)
  const conversationKey = getConversationKey(recipientPrivkey, senderPubkey)
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(conversationKey, nonce)
  const calculated = hmacAad(hmacKey, ciphertext, nonce)
  if (!equalBytes(calculated, mac)) {
    throw new PairingError("nip44", "Invalid MAC")
  }
  const plaintext = unpad(chacha20(chachaKey, chachaNonce, ciphertext))
  if (utf8Encoder.encode(plaintext).length > MAX_PLAINTEXT_LEN) {
    throw new PairingError("nip44", "Decrypted plaintext exceeds limit")
  }
  return parsePairingMessage(plaintext)
}

// =============================================================================
// Message parse / serialize
// =============================================================================

const VALID_PAYLOAD_TYPES = new Set<PayloadType>(["nsec", "bunker", "connect", "custom"])
const VALID_ABORT_REASONS = new Set<string>([
  "sas_mismatch",
  "user_denied",
  "timeout",
  "protocol_error",
])

export const parsePairingMessage = (json: string): PairingMessage => {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new PairingError("json", "Invalid JSON pairing message")
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PairingError("json", "Pairing message must be a JSON object")
  }
  const obj = raw as Record<string, unknown>
  const type = obj.type
  if (typeof type !== "string") {
    throw new PairingError("json", "Missing message type")
  }

  switch (type) {
    case "offer": {
      if (typeof obj.session_id !== "string" || !HEX64.test(obj.session_id)) {
        throw new PairingError("json", "offer.session_id must be 64 lowercase hex")
      }
      const version =
        obj.version === undefined ? PROTOCOL_VERSION : Number(obj.version)
      if (!Number.isInteger(version) || version < 1) {
        throw new PairingError("json", "offer.version must be a positive integer")
      }
      return { type: "offer", version, session_id: obj.session_id }
    }
    case "sas-confirm": {
      if (typeof obj.transcript_hash !== "string" || !HEX64.test(obj.transcript_hash)) {
        throw new PairingError("json", "sas-confirm.transcript_hash must be 64 lowercase hex")
      }
      return { type: "sas-confirm", transcript_hash: obj.transcript_hash }
    }
    case "payload": {
      if (typeof obj.payload_type !== "string" || !VALID_PAYLOAD_TYPES.has(obj.payload_type as PayloadType)) {
        throw new PairingError("json", "payload.payload_type invalid")
      }
      if (typeof obj.payload !== "string") {
        throw new PairingError("json", "payload.payload must be a string")
      }
      return {
        type: "payload",
        payload_type: obj.payload_type as PayloadType,
        payload: obj.payload,
      }
    }
    case "complete": {
      if (typeof obj.success !== "boolean") {
        throw new PairingError("json", "complete.success must be boolean")
      }
      return { type: "complete", success: obj.success }
    }
    case "abort": {
      if (typeof obj.reason !== "string") {
        throw new PairingError("json", "abort.reason must be a string")
      }
      const reason: AbortReason = VALID_ABORT_REASONS.has(obj.reason)
        ? (obj.reason as AbortReason)
        : "unknown"
      return { type: "abort", reason }
    }
    default:
      throw new PairingError("json", `Unknown message type: ${type}`)
  }
}

export const messageTypeName = (msg: PairingMessage): string => msg.type

// =============================================================================
// QR encode / decode
// =============================================================================

const isLowerHex = (s: string): boolean => HEX64.test(s)

const percentEncode = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )

const percentDecode = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    // Fallback for malformed sequences
    return s.replace(/%([0-9A-Fa-f]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
  }
}

const isWsUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    return (u.protocol === "wss:" || u.protocol === "ws:") && u.hostname.length > 0
  } catch {
    return false
  }
}

/** Encode a QR payload as `nostrpair://…` */
export const encodeQr = (payload: QrPayload): string => {
  if (payload.sessionSecret.length !== 32) {
    throw new PairingError("invalid_qr", "session_secret must be 32 bytes")
  }
  if (payload.relays.length === 0) {
    throw new PairingError("invalid_qr", "at least one relay is required")
  }
  let uri = `nostrpair://${payload.sourcePubkey}?secret=${bytesToHex(payload.sessionSecret)}`
  for (const relay of payload.relays) {
    uri += `&relay=${percentEncode(relay)}`
  }
  uri += `&v=${payload.version}`
  if (uri.length > MAX_URI_LEN) {
    throw new PairingError("invalid_qr", `URI exceeds ${MAX_URI_LEN} characters`)
  }
  return uri
}

/** Decode and validate a `nostrpair://` URI */
export const decodeQr = (uri: string): QrPayload => {
  if (uri.length > MAX_URI_LEN) {
    throw new PairingError(
      "invalid_qr",
      `URI exceeds ${MAX_URI_LEN}-character limit (${uri.length} chars)`
    )
  }
  if (!uri.startsWith("nostrpair://")) {
    throw new PairingError("invalid_qr", "URI must start with nostrpair://")
  }
  const rest = uri.slice("nostrpair://".length)
  const qIdx = rest.indexOf("?")
  if (qIdx < 0) {
    throw new PairingError("invalid_qr", "missing query string")
  }
  const pubkeyHex = rest.slice(0, qIdx)
  const query = rest.slice(qIdx + 1)

  if (!isLowerHex(pubkeyHex)) {
    throw new PairingError(
      "invalid_qr",
      "pubkey must be 64 lowercase hex chars"
    )
  }

  let secretHex: string | undefined
  const relays: string[] = []
  let version: number | undefined

  for (const pair of query.split("&")) {
    if (!pair) continue
    const eq = pair.indexOf("=")
    if (eq < 0) continue
    const key = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (key === "secret") secretHex = value
    else if (key === "relay") relays.push(percentDecode(value))
    else if (key === "v") {
      const n = Number(value)
      if (Number.isInteger(n)) version = n
    }
    // unknown params ignored
  }

  const resolvedVersion = version ?? PROTOCOL_VERSION
  if (resolvedVersion !== PROTOCOL_VERSION) {
    throw new PairingError(
      "invalid_qr",
      `unsupported protocol version ${resolvedVersion}, expected ${PROTOCOL_VERSION}`
    )
  }

  if (secretHex === undefined) {
    throw new PairingError("invalid_qr", "missing 'secret' query parameter")
  }
  if (!isLowerHex(secretHex)) {
    throw new PairingError("invalid_qr", "secret must be 64 lowercase hex chars")
  }
  const sessionSecret = hexToBytes(secretHex)
  if (sessionSecret.every((b) => b === 0)) {
    throw new PairingError("invalid_qr", "session_secret must not be all zeros")
  }

  if (relays.length === 0) {
    throw new PairingError("invalid_qr", "at least one 'relay' query parameter is required")
  }
  for (const relay of relays) {
    if (!isWsUrl(relay)) {
      throw new PairingError(
        "invalid_qr",
        `relay URL must use wss:// or ws:// scheme: ${relay}`
      )
    }
  }

  return {
    sourcePubkey: pubkeyHex as PublicKey,
    sessionSecret,
    relays,
    version: resolvedVersion,
  }
}

// =============================================================================
// Event helpers
// =============================================================================

const getEventHash = (event: {
  pubkey: string
  created_at: number
  kind: number
  tags: readonly (readonly string[])[]
  content: string
}): string =>
  bytesToHex(
    sha256(
      utf8Encoder.encode(
        JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
      )
    )
  )

const signEventId = (id: string, privateKeyHex: string): string =>
  bytesToHex(schnorr.sign(id, hexToBytes(privateKeyHex)))

const verifyEvent = (event: NostrEvent): boolean => {
  try {
    const expectedId = getEventHash(event)
    if (expectedId !== event.id) return false
    return schnorr.verify(event.sig, event.id, event.pubkey)
  } catch {
    return false
  }
}

const pubkeyFromPriv = (privateKeyHex: string): PublicKey =>
  bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex))) as PublicKey

const generatePrivateKey = (): PrivateKey =>
  bytesToHex(schnorr.utils.randomPrivateKey()) as PrivateKey

const randomCreatedAt = (): UnixTimestamp => {
  // NIP-AB §Metadata Privacy: current time minus 0–30s jitter; never future.
  const now = Math.floor(Date.now() / 1000)
  const jitter = Math.floor(Math.random() * 31)
  return (now - jitter) as UnixTimestamp
}

// =============================================================================
// PairingSession state machine
// =============================================================================

/**
 * Pure NIP-AB pairing session.
 *
 * No I/O: callers publish returned events and feed inbound events into handlers.
 */
export class PairingSession {
  readonly role: Role
  private _state: SessionState
  private readonly privateKey: PrivateKey
  private readonly publicKey: PublicKey
  private sessionSecret: Uint8Array
  private readonly relayUrls: string[]
  private peerPubkey: PublicKey | undefined
  private sessionId: Uint8Array
  private sasCode: number | undefined
  private sasInput: Uint8Array | undefined
  private readonly processedIds = new Set<string>()
  private readonly createdAtMs: number
  private timeoutMs: number
  /** Target may buffer an early payload ciphertext until dual consent. */
  private bufferedPayloadContent: string | undefined
  private bufferedPayloadPubkey: PublicKey | undefined

  private constructor(init: {
    role: Role
    state: SessionState
    privateKey: PrivateKey
    sessionSecret: Uint8Array
    relayUrls: string[]
    peerPubkey?: PublicKey
    sessionId: Uint8Array
    sasCode?: number
    sasInput?: Uint8Array
  }) {
    this.role = init.role
    this._state = init.state
    this.privateKey = init.privateKey
    this.publicKey = pubkeyFromPriv(init.privateKey)
    this.sessionSecret = new Uint8Array(init.sessionSecret)
    this.relayUrls = [...init.relayUrls]
    this.peerPubkey = init.peerPubkey
    this.sessionId = new Uint8Array(init.sessionId)
    this.sasCode = init.sasCode
    this.sasInput = init.sasInput ? new Uint8Array(init.sasInput) : undefined
    this.createdAtMs = Date.now()
    this.timeoutMs = SESSION_TIMEOUT_SECS * 1000
  }

  // ---------- accessors ----------

  get state(): SessionState {
    return this._state
  }

  get pubkey(): PublicKey {
    return this.publicKey
  }

  get relays(): readonly string[] {
    return this.relayUrls
  }

  get peer(): PublicKey | undefined {
    return this.peerPubkey
  }

  /** Zero-padded SAS string, if derived */
  getSasCode(): string | undefined {
    return this.sasCode === undefined ? undefined : formatSas(this.sasCode)
  }

  isExpired(): boolean {
    return Date.now() - this.createdAtMs >= this.timeoutMs
  }

  /** Source-only: QR URI for display */
  qrUri(): string | undefined {
    if (this.role !== "source") return undefined
    return encodeQr({
      sourcePubkey: this.publicKey,
      sessionSecret: this.sessionSecret,
      relays: this.relayUrls,
      version: PROTOCOL_VERSION,
    })
  }

  /** NIP-01 filter for events addressed to this session's ephemeral pubkey */
  subscriptionFilter(): { kinds: number[]; "#p": string[] } {
    return { kinds: [PAIRING_KIND], "#p": [this.publicKey] }
  }

  // ---------- constructors ----------

  /**
   * Create a source session. Returns the session and QR payload to display.
   */
  static newSource(relayUrl: string, extraRelays: readonly string[] = []): {
    session: PairingSession
    qr: QrPayload
  } {
    const privateKey = generatePrivateKey()
    const sessionSecret = randomBytes(32)
    // Reject all-zero by regenerating (vanishingly rare)
    if (sessionSecret.every((b) => b === 0)) {
      sessionSecret[0] = 1
    }
    const sessionId = deriveSessionId(sessionSecret)
    const relays = [relayUrl, ...extraRelays]
    const publicKey = pubkeyFromPriv(privateKey)
    const qr: QrPayload = {
      sourcePubkey: publicKey,
      sessionSecret: new Uint8Array(sessionSecret),
      relays,
      version: PROTOCOL_VERSION,
    }
    const session = new PairingSession({
      role: "source",
      state: "Waiting",
      privateKey,
      sessionSecret,
      relayUrls: relays,
      sessionId,
    })
    return { session, qr }
  }

  /**
   * Create a target session from a scanned QR payload.
   * Returns the session and the signed `offer` event to publish.
   */
  static newTarget(qr: QrPayload): { session: PairingSession; offerEvent: NostrEvent } {
    if (qr.version !== PROTOCOL_VERSION) {
      throw new PairingError(
        "invalid_qr",
        `unsupported protocol version ${qr.version}`
      )
    }
    if (qr.sessionSecret.length !== 32 || qr.sessionSecret.every((b) => b === 0)) {
      throw new PairingError("invalid_qr", "invalid session_secret")
    }
    const privateKey = generatePrivateKey()
    const sessionId = deriveSessionId(qr.sessionSecret)
    const ecdh = ecdhSharedX(privateKey, qr.sourcePubkey)
    const { sasCode, sasInput } = deriveSas(ecdh, qr.sessionSecret)

    const session = new PairingSession({
      role: "target",
      state: "Waiting",
      privateKey,
      sessionSecret: qr.sessionSecret,
      relayUrls: [...qr.relays],
      peerPubkey: qr.sourcePubkey,
      sessionId,
      sasCode,
      sasInput,
    })

    const offerEvent = session.buildEvent({
      type: "offer",
      version: PROTOCOL_VERSION,
      session_id: bytesToHex(sessionId),
    })
    session._state = "Confirming"
    return { session, offerEvent }
  }

  // ---------- Source handlers ----------

  /**
   * (Source) Process an inbound offer event. Returns SAS code to display.
   */
  handleOffer(event: NostrEvent): string {
    this.checkExpired()
    this.expectRole("source")
    this.expectState("Waiting")
    this.validateEventBasics(event)

    const msg = this.decryptInbound(event)
    if (msg.type !== "offer") {
      throw unexpected("offer", msg)
    }
    if (msg.version !== PROTOCOL_VERSION) {
      throw new PairingError("unexpected_message", `unsupported offer version ${msg.version}`, {
        expected: "version 1",
        got: `version ${msg.version}`,
      })
    }

    let receivedId: Uint8Array
    try {
      receivedId = hexToBytes(msg.session_id)
    } catch {
      throw new PairingError("invalid_session_id", "invalid session_id hex")
    }
    if (!ctEq(receivedId, this.sessionId)) {
      throw new PairingError("invalid_session_id", "session_id mismatch")
    }

    this.peerPubkey = event.pubkey
    const ecdh = ecdhSharedX(this.privateKey, event.pubkey)
    const { sasCode, sasInput } = deriveSas(ecdh, this.sessionSecret)
    this.sasCode = sasCode
    this.sasInput = sasInput
    this._state = "Confirming"
    this.recordEvent(event)
    return formatSas(sasCode)
  }

  /**
   * (Source) User confirmed SAS. Returns `sas-confirm` event to publish.
   * Advances to Transferring (payload may be sent immediately after).
   */
  confirmSas(): NostrEvent {
    this.checkExpired()
    this.expectRole("source")
    this.expectState("Confirming")
    if (!this.sasInput || !this.peerPubkey) {
      throw new PairingError("sas_mismatch", "SAS not derived yet")
    }

    const transcriptHash = deriveTranscriptHash(
      this.sessionId,
      hexToBytes(this.publicKey),
      hexToBytes(this.peerPubkey),
      this.sasInput,
      this.sessionSecret
    )

    const event = this.buildEvent({
      type: "sas-confirm",
      transcript_hash: bytesToHex(transcriptHash),
    })
    this._state = "Transferring"
    return event
  }

  /**
   * (Source) Build the payload event carrying the secret.
   */
  sendPayload(payloadType: PayloadType, payload: string): NostrEvent {
    this.checkExpired()
    this.expectRole("source")
    this.expectState("Transferring")
    if (utf8Encoder.encode(payload).length > MAX_PAYLOAD_LEN) {
      throw new PairingError("nip44", "payload exceeds MAX_PAYLOAD_LEN")
    }
    const event = this.buildEvent({
      type: "payload",
      payload_type: payloadType,
      payload,
    })
    this._state = "PayloadExchanged"
    return event
  }

  /**
   * (Source) Process the advisory `complete` event from the target.
   */
  handleComplete(event: NostrEvent): void {
    this.checkExpired()
    this.expectRole("source")
    this.expectState("PayloadExchanged")
    this.validateEventFromPeer(event)

    const msg = this.decryptInbound(event)
    if (msg.type !== "complete") {
      throw unexpected("complete", msg)
    }
    if (msg.success) {
      this._state = "Completed"
      this.recordEvent(event)
      return
    }
    this._state = "Aborted"
    throw new PairingError("unexpected_message", "complete(success=false)", {
      expected: "complete(success=true)",
      got: "complete(success=false)",
    })
  }

  // ---------- Target handlers ----------

  /**
   * (Target) Process `sas-confirm`. Verifies transcript hash and returns SAS
   * for display. Moves to AwaitingConfirmation — caller must call
   * {@link confirmTargetSas} after user approval.
   */
  handleSasConfirm(event: NostrEvent): string {
    this.checkExpired()
    this.expectRole("target")
    this.expectState("Confirming")
    this.validateEventFromPeer(event)

    const msg = this.decryptInbound(event)
    if (msg.type !== "sas-confirm") {
      throw unexpected("sas-confirm", msg)
    }
    if (!this.sasInput || !this.peerPubkey) {
      throw new PairingError("sas_mismatch", "SAS not derived")
    }

    const expected = deriveTranscriptHash(
      this.sessionId,
      hexToBytes(this.peerPubkey),
      hexToBytes(this.publicKey),
      this.sasInput,
      this.sessionSecret
    )

    let received: Uint8Array
    try {
      received = hexToBytes(msg.transcript_hash)
    } catch {
      this._state = "Aborted"
      throw new PairingError("transcript_mismatch", "invalid transcript_hash hex")
    }
    if (!ctEq(received, expected)) {
      this._state = "Aborted"
      throw new PairingError("transcript_mismatch", "transcript_hash mismatch")
    }

    this._state = "AwaitingConfirmation"
    this.recordEvent(event)
    return formatSas(this.sasCode!)
  }

  /**
   * (Target) User confirmed SAS. Transitions to Transferring so payloads
   * can be processed.
   */
  confirmTargetSas(): void {
    this.checkExpired()
    this.expectRole("target")
    this.expectState("AwaitingConfirmation")
    this._state = "Transferring"
  }

  /**
   * (Target) Process the payload event. Only valid in Transferring.
   *
   * Spec dual-consent: do not call until after {@link confirmTargetSas}.
   * Events that arrive early in AwaitingConfirmation may be buffered via
   * {@link bufferPayload} and then drained with {@link takeBufferedPayload}.
   */
  handlePayload(event: NostrEvent): { payloadType: PayloadType; payload: string } {
    this.checkExpired()
    this.expectRole("target")
    this.expectState("Transferring")
    this.validateEventFromPeer(event)

    const msg = this.decryptInbound(event)
    if (msg.type !== "payload") {
      throw unexpected("payload", msg)
    }
    this._state = "PayloadExchanged"
    this.recordEvent(event)
    return { payloadType: msg.payload_type, payload: msg.payload }
  }

  /**
   * (Target) Buffer an early payload ciphertext while waiting for user SAS
   * confirmation. Does not decrypt the payload field — stores raw content.
   */
  bufferPayload(event: NostrEvent): void {
    this.checkExpired()
    this.expectRole("target")
    if (this._state !== "AwaitingConfirmation" && this._state !== "Confirming") {
      throw new PairingError("unexpected_message", "cannot buffer payload in current state", {
        expected: "AwaitingConfirmation",
        got: this._state,
      })
    }
    // Only basic validation + peer + type classification
    this.validateEventFromPeer(event)
    // Decrypt only enough to classify type (spec allows this for routing)
    const msg = this.decryptInbound(event)
    if (msg.type !== "payload") {
      throw unexpected("payload", msg)
    }
    // Re-store raw ciphertext; discard decrypted payload material
    this.bufferedPayloadContent = event.content
    this.bufferedPayloadPubkey = event.pubkey
    this.recordEvent(event)
  }

  /**
   * (Target) After dual consent, decrypt a previously buffered payload.
   */
  takeBufferedPayload(): { payloadType: PayloadType; payload: string } | undefined {
    this.expectRole("target")
    this.expectState("Transferring")
    if (
      this.bufferedPayloadContent === undefined ||
      this.bufferedPayloadPubkey === undefined
    ) {
      return undefined
    }
    const msg = decryptMessage(
      this.bufferedPayloadContent,
      this.privateKey,
      this.bufferedPayloadPubkey
    )
    this.bufferedPayloadContent = undefined
    this.bufferedPayloadPubkey = undefined
    if (msg.type !== "payload") {
      throw unexpected("payload", msg)
    }
    this._state = "PayloadExchanged"
    return { payloadType: msg.payload_type, payload: msg.payload }
  }

  /**
   * (Target) Build `complete` event after successful import.
   */
  sendComplete(success = true): NostrEvent {
    this.checkExpired()
    this.expectRole("target")
    this.expectState("PayloadExchanged")
    const event = this.buildEvent({ type: "complete", success })
    this._state = success ? "Completed" : "Aborted"
    return event
  }

  // ---------- Abort (both roles) ----------

  /**
   * Build an abort event (or null if no peer is known yet). Always transitions
   * to Aborted.
   */
  abort(reason: AbortReason): NostrEvent | undefined {
    if (this._state === "Completed" || this._state === "Aborted") {
      throw new PairingError("unexpected_message", "session already terminal", {
        expected: "non-terminal state",
        got: this._state,
      })
    }
    if (!this.peerPubkey) {
      this._state = "Aborted"
      return undefined
    }
    // Spec: unknown reasons should not be sent outbound
    const outbound: AbortReason =
      reason === "unknown" ? "protocol_error" : reason
    const event = this.buildEvent({ type: "abort", reason: outbound })
    this._state = "Aborted"
    return event
  }

  /**
   * Process an abort from a known peer.
   */
  handleAbort(event: NostrEvent): AbortReason {
    if (this._state === "Completed" || this._state === "Aborted") {
      throw new PairingError("unexpected_message", "session already terminal", {
        expected: "non-terminal state",
        got: this._state,
      })
    }
    if (!this.peerPubkey) {
      throw new PairingError(
        "invalid_pubkey",
        "cannot accept abort before peer is known"
      )
    }
    this.validateEventFromPeer(event)
    const msg = this.decryptInbound(event)
    if (msg.type !== "abort") {
      throw unexpected("abort", msg)
    }
    this._state = "Aborted"
    this.recordEvent(event)
    return msg.reason === "unknown" ? "protocol_error" : msg.reason
  }

  /** Zero session secrets from memory (best-effort in JS). */
  destroy(): void {
    this.sessionSecret.fill(0)
    this.sessionId.fill(0)
    if (this.sasInput) this.sasInput.fill(0)
    this.bufferedPayloadContent = undefined
    this._state = "Aborted"
  }

  // ---------- internals ----------

  /** @internal test-only timeout override */
  setTimeoutMs(ms: number): void {
    this.timeoutMs = ms
  }

  /** @internal test-only processed-id check */
  hasProcessed(eventId: string): boolean {
    return this.processedIds.has(eventId)
  }

  private buildEvent(message: PairingMessage): NostrEvent {
    if (!this.peerPubkey) {
      throw new PairingError("invalid_pubkey", "no peer pubkey set")
    }
    const content = encryptMessage(message, this.privateKey, this.peerPubkey)
    const tags = [["p", this.peerPubkey]] as const
    const created_at = randomCreatedAt()
    const unsigned = {
      pubkey: this.publicKey,
      created_at,
      kind: PAIRING_KIND,
      tags: tags as unknown as NostrEvent["tags"],
      content,
    }
    const id = getEventHash(unsigned) as EventId
    const sig = signEventId(id, this.privateKey) as Signature
    return {
      id,
      pubkey: this.publicKey,
      created_at,
      kind: PAIRING_KIND,
      tags: tags as unknown as NostrEvent["tags"],
      content,
      sig,
    }
  }

  private decryptInbound(event: NostrEvent): PairingMessage {
    return decryptMessage(event.content, this.privateKey, event.pubkey)
  }

  private validateEventBasics(event: NostrEvent): void {
    if (!verifyEvent(event)) {
      throw new PairingError("invalid_pubkey", "event verification failed")
    }
    if (this.processedIds.has(event.id)) {
      throw new PairingError("unexpected_message", "duplicate event id", {
        expected: "new event",
        got: "duplicate event id",
      })
    }
    if (event.kind !== PAIRING_KIND) {
      throw new PairingError("unexpected_message", `unexpected kind ${event.kind}`, {
        expected: `kind ${PAIRING_KIND}`,
        got: `kind ${event.kind}`,
      })
    }
    const hasP = event.tags.some(
      (t) => t[0] === "p" && t[1] === this.publicKey
    )
    if (!hasP) {
      throw new PairingError(
        "invalid_pubkey",
        "event p-tag does not match our ephemeral pubkey"
      )
    }
  }

  private validateEventFromPeer(event: NostrEvent): void {
    this.validateEventBasics(event)
    if (this.peerPubkey && event.pubkey !== this.peerPubkey) {
      throw new PairingError(
        "invalid_pubkey",
        `event from ${event.pubkey} but expected ${this.peerPubkey}`
      )
    }
  }

  private recordEvent(event: NostrEvent): void {
    this.processedIds.add(event.id)
  }

  private checkExpired(): void {
    if (this.isExpired()) {
      throw new PairingError("session_expired", "session expired")
    }
  }

  private expectState(expected: SessionState): void {
    if (this._state !== expected) {
      throw new PairingError("unexpected_message", `expected state ${expected}`, {
        expected: `state ${expected}`,
        got: `state ${this._state}`,
      })
    }
  }

  private expectRole(expected: Role): void {
    if (this.role !== expected) {
      throw new PairingError("unexpected_message", `expected role ${expected}`, {
        expected: `role ${expected}`,
        got: `role ${this.role}`,
      })
    }
  }
}

const unexpected = (expected: string, got: PairingMessage): PairingError =>
  new PairingError("unexpected_message", `expected ${expected}, got ${got.type}`, {
    expected,
    got: got.type,
  })
