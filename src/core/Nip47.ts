/**
 * NIP-47: Nostr Wallet Connect (NWC)
 * https://github.com/nostr-protocol/nips/blob/master/47.md
 *
 * Protocol for clients to access a remote lightning wallet.
 */
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { schnorr } from "@noble/curves/secp256k1"
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from "./Nip04.js"
import {
  encrypt as nip44Encrypt,
  decrypt as nip44Decrypt,
  getConversationKey,
} from "../wrappers/nip44.js"
import type { EventKind, UnixTimestamp, EventId, Signature, PublicKey } from "./Schema.js"

/** Encryption schemes supported by NIP-47 */
export type NwcEncryption = "nip44_v2" | "nip04"

/** Default encryption for new requests (current NIP-47) */
export const NWC_DEFAULT_ENCRYPTION: NwcEncryption = "nip44_v2"

const utf8Encoder = new TextEncoder()

/** NIP-47 Info Event Kind (13194) */
export const NWC_INFO_KIND = 13194 as EventKind

/** NIP-47 Request Kind (23194) */
export const NWC_REQUEST_KIND = 23194 as EventKind

/** NIP-47 Response Kind (23195) */
export const NWC_RESPONSE_KIND = 23195 as EventKind

/** NIP-47 Notification Event Kind - NIP-44 (23197) */
export const NWC_NOTIFICATION_KIND = 23197 as EventKind

/** NIP-47 Notification Event Kind - NIP-04 Legacy (23196) */
export const NWC_NOTIFICATION_LEGACY_KIND = 23196 as EventKind

/**
 * Parsed NWC connection details
 */
export interface NWCConnection {
  /** Public key of the wallet service */
  pubkey: string
  /** Relay URL where the wallet service is listening */
  relay: string
  /** Secret key for the client to use for encryption */
  secret: string
  /** Optional lightning address for user profile setup */
  lud16?: string
}

/**
 * NWC Request content structure
 */
export interface NWCRequest {
  method: string
  params: Record<string, unknown>
}

/**
 * NWC Response content structure
 */
export interface NWCResponse {
  result_type: string
  error?: {
    code: string
    message: string
  } | null
  result?: Record<string, unknown> | null
}

/**
 * NWC Notification content structure
 */
export interface NWCNotification {
  notification_type: string
  notification: Record<string, unknown>
}

/**
 * Error codes defined by NIP-47
 */
export const NWC_ERROR_CODES = {
  RATE_LIMITED: "RATE_LIMITED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  RESTRICTED: "RESTRICTED",
  UNAUTHORIZED: "UNAUTHORIZED",
  INTERNAL: "INTERNAL",
  UNSUPPORTED_ENCRYPTION: "UNSUPPORTED_ENCRYPTION",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  NOT_FOUND: "NOT_FOUND",
  OTHER: "OTHER",
} as const

/** Event template for signing */
interface EventTemplate {
  kind: EventKind
  tags: string[][]
  created_at: UnixTimestamp
  content: string
}

/** Finalized (signed) event */
interface FinalizedEvent {
  id: EventId
  pubkey: PublicKey
  created_at: UnixTimestamp
  kind: EventKind
  tags: string[][]
  content: string
  sig: Signature
}

/**
 * Parse a NWC connection string into its components
 *
 * Connection string format:
 * nostr+walletconnect://<pubkey>?relay=<relay>&secret=<secret>&lud16=<lud16>
 *
 * @param connectionString - The NWC connection URI
 * @returns Parsed connection details
 * @throws Error if required parameters are missing
 */
export function parseConnectionString(connectionString: string): NWCConnection {
  const url = new URL(connectionString)
  // Handle both nostr+walletconnect:// and nostr+walletconnect: formats
  const pubkey = url.pathname.replace(/^\/\//, "") || url.host
  const relay = url.searchParams.get("relay")
  const secret = url.searchParams.get("secret")
  const lud16 = url.searchParams.get("lud16")

  if (!pubkey) {
    throw new Error("invalid connection string: missing pubkey")
  }
  if (!relay) {
    throw new Error("invalid connection string: missing relay")
  }
  if (!secret) {
    throw new Error("invalid connection string: missing secret")
  }

  const connection: NWCConnection = { pubkey, relay, secret }
  if (lud16) {
    connection.lud16 = lud16
  }

  return connection
}

/**
 * Encrypt NWC payload with NIP-44 v2 or legacy NIP-04.
 */
export function encryptNwcPayload(
  secretKey: Uint8Array,
  walletPubkey: string,
  plaintext: string,
  encryption: NwcEncryption = NWC_DEFAULT_ENCRYPTION
): string {
  if (encryption === "nip04") {
    return nip04Encrypt(secretKey, walletPubkey, plaintext)
  }
  const conversationKey = getConversationKey(secretKey, walletPubkey)
  return nip44Encrypt(plaintext, conversationKey)
}

/**
 * Decrypt NWC payload. Uses encryption tag when present; otherwise legacy NIP-04.
 */
export function decryptNwcPayload(
  secretKey: Uint8Array,
  walletPubkey: string,
  ciphertext: string,
  encryption?: NwcEncryption
): string {
  const mode = encryption ?? (ciphertext.includes("?iv=") ? "nip04" : "nip44_v2")
  if (mode === "nip04") {
    return nip04Decrypt(secretKey, walletPubkey, ciphertext)
  }
  const conversationKey = getConversationKey(secretKey, walletPubkey)
  return nip44Decrypt(ciphertext, conversationKey)
}

/**
 * Resolve encryption from event tags (NIP-47 encryption tag).
 * Absent tag → nip04 for backwards compatibility.
 */
export function getNwcEncryptionFromTags(tags: readonly string[][]): NwcEncryption {
  const tag = tags.find((t) => t[0] === "encryption" && t[1])
  if (!tag?.[1]) return "nip04"
  // Space-separated list; prefer nip44_v2 when listed
  const modes = tag[1].split(/\s+/)
  if (modes.includes("nip44_v2")) return "nip44_v2"
  if (modes.includes("nip04")) return "nip04"
  return "nip04"
}

export interface MakeNwcRequestOptions {
  /** Encryption scheme (default: nip44_v2) */
  readonly encryption?: NwcEncryption
}

/**
 * Create an NWC request event for paying an invoice
 *
 * @param pubkey - Public key of the wallet service
 * @param secretKey - Secret key from the connection string (as Uint8Array)
 * @param invoice - BOLT11 invoice to pay
 * @param options - Encryption options
 * @returns Finalized and signed event
 */
export function makeNwcRequestEvent(
  pubkey: string,
  secretKey: Uint8Array,
  invoice: string,
  options: MakeNwcRequestOptions = {}
): FinalizedEvent {
  return makeNwcRequest(pubkey, secretKey, NWC_METHODS.PAY_INVOICE, { invoice }, options)
}

/**
 * Create a generic NWC request event
 *
 * @param pubkey - Public key of the wallet service
 * @param secretKey - Secret key from the connection string (as Uint8Array)
 * @param method - NWC method name
 * @param params - Method parameters
 * @param options - Encryption options (default NIP-44 v2)
 * @returns Finalized and signed event
 */
export function makeNwcRequest(
  pubkey: string,
  secretKey: Uint8Array,
  method: string,
  params: Record<string, unknown> = {},
  options: MakeNwcRequestOptions = {}
): FinalizedEvent {
  const encryption = options.encryption ?? NWC_DEFAULT_ENCRYPTION
  const content: NWCRequest = { method, params }
  const encryptedContent = encryptNwcPayload(
    secretKey,
    pubkey,
    JSON.stringify(content),
    encryption
  )

  const tags: string[][] = [["p", pubkey]]
  if (encryption === "nip44_v2") {
    tags.push(["encryption", "nip44_v2"])
  }
  // Legacy NIP-04 omits encryption tag for interop with old wallet services

  const eventTemplate: EventTemplate = {
    kind: NWC_REQUEST_KIND,
    created_at: Math.round(Date.now() / 1000) as UnixTimestamp,
    content: encryptedContent,
    tags,
  }

  return finalizeEvent(eventTemplate, secretKey)
}

/**
 * Decrypt and parse an NWC response or notification event content.
 */
export function parseNwcEncryptedContent<T = NWCResponse>(
  event: { content: string; tags: readonly string[][]; pubkey: string },
  clientSecretKey: Uint8Array | string
): T {
  const secret =
    typeof clientSecretKey === "string" ? hexToBytes(clientSecretKey) : clientSecretKey
  const encryption = getNwcEncryptionFromTags(event.tags)
  const plaintext = decryptNwcPayload(secret, event.pubkey, event.content, encryption)
  return JSON.parse(plaintext) as T
}

/** Hold invoice: create */
export function makeHoldInvoiceRequest(
  pubkey: string,
  secretKey: Uint8Array,
  params: {
    readonly amount: number
    readonly description?: string
    readonly description_hash?: string
    readonly expiry?: number
    readonly payment_hash: string
  },
  options: MakeNwcRequestOptions = {}
): FinalizedEvent {
  return makeNwcRequest(pubkey, secretKey, NWC_METHODS.MAKE_HOLD_INVOICE, { ...params }, options)
}

/** Hold invoice: cancel by payment hash */
export function makeCancelHoldInvoiceRequest(
  pubkey: string,
  secretKey: Uint8Array,
  paymentHash: string,
  options: MakeNwcRequestOptions = {}
): FinalizedEvent {
  return makeNwcRequest(
    pubkey,
    secretKey,
    NWC_METHODS.CANCEL_HOLD_INVOICE,
    { payment_hash: paymentHash },
    options
  )
}

/** Hold invoice: settle with preimage */
export function makeSettleHoldInvoiceRequest(
  pubkey: string,
  secretKey: Uint8Array,
  preimage: string,
  options: MakeNwcRequestOptions = {}
): FinalizedEvent {
  return makeNwcRequest(
    pubkey,
    secretKey,
    NWC_METHODS.SETTLE_HOLD_INVOICE,
    { preimage },
    options
  )
}

/**
 * Finalize an event by adding id, pubkey, and signature
 */
function finalizeEvent(event: EventTemplate, secretKey: Uint8Array): FinalizedEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(secretKey)) as PublicKey

  const eventForHash = {
    pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
  }

  const serialized = JSON.stringify([
    0,
    eventForHash.pubkey,
    eventForHash.created_at,
    eventForHash.kind,
    eventForHash.tags,
    eventForHash.content,
  ])

  const id = bytesToHex(sha256(utf8Encoder.encode(serialized))) as EventId
  const sig = bytesToHex(schnorr.sign(id, secretKey)) as Signature

  return {
    id,
    pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig,
  }
}

/**
 * NWC method names
 */
export const NWC_METHODS = {
  PAY_INVOICE: "pay_invoice",
  MULTI_PAY_INVOICE: "multi_pay_invoice",
  PAY_KEYSEND: "pay_keysend",
  MULTI_PAY_KEYSEND: "multi_pay_keysend",
  MAKE_INVOICE: "make_invoice",
  LOOKUP_INVOICE: "lookup_invoice",
  LIST_TRANSACTIONS: "list_transactions",
  GET_BALANCE: "get_balance",
  GET_INFO: "get_info",
  MAKE_HOLD_INVOICE: "make_hold_invoice",
  CANCEL_HOLD_INVOICE: "cancel_hold_invoice",
  SETTLE_HOLD_INVOICE: "settle_hold_invoice",
} as const

/**
 * NWC notification types
 */
export const NWC_NOTIFICATIONS = {
  PAYMENT_RECEIVED: "payment_received",
  PAYMENT_SENT: "payment_sent",
  HOLD_INVOICE_ACCEPTED: "hold_invoice_accepted",
} as const
