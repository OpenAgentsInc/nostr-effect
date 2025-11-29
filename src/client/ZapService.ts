/**
 * ZapService
 *
 * NIP-57 Lightning Zaps service.
 * Handles zap requests, receipts, and LNURL integration.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/57.md
 */
import { Context, Effect, Layer } from "effect"
import { Schema } from "@effect/schema"
import { bech32 } from "@scure/base"
import { EventService } from "../services/EventService.js"
import { CryptoError, InvalidPrivateKey, InvalidPublicKey } from "../core/Errors.js"
import {
  type NostrEvent,
  type PrivateKey,
  Tag,
  ZAP_REQUEST_KIND,
  ZAP_RECEIPT_KIND,
  isReplaceableKind,
  isParameterizedReplaceableKind,
  getDTagValue,
} from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

const decodeTag = Schema.decodeSync(Tag)

/** LNURL pay endpoint response */
export interface LnurlPayResponse {
  /** Whether this endpoint allows Nostr zaps */
  readonly allowsNostr?: boolean
  /** The nostr pubkey of the LNURL server (for signing zap receipts) */
  readonly nostrPubkey?: string
  /** The callback URL to fetch invoices from */
  readonly callback: string
  /** Minimum sendable amount in millisats */
  readonly minSendable: number
  /** Maximum sendable amount in millisats */
  readonly maxSendable: number
}

/** Parameters for creating a zap request to a profile */
export interface ProfileZapParams {
  /** The pubkey of the recipient */
  readonly pubkey: string
  /** Amount in millisats */
  readonly amount: number
  /** Optional comment to include */
  readonly comment?: string
  /** Relays for the zap receipt */
  readonly relays: readonly string[]
  /** Optional lnurl (bech32 encoded) */
  readonly lnurl?: string
}

/** Parameters for creating a zap request to an event */
export interface EventZapParams {
  /** The event to zap */
  readonly event: NostrEvent
  /** Amount in millisats */
  readonly amount: number
  /** Optional comment to include */
  readonly comment?: string
  /** Relays for the zap receipt */
  readonly relays: readonly string[]
  /** Optional lnurl (bech32 encoded) */
  readonly lnurl?: string
}

/** Parameters for creating a zap receipt */
export interface ZapReceiptParams {
  /** The JSON-encoded zap request */
  readonly zapRequest: string
  /** The bolt11 invoice */
  readonly bolt11: string
  /** When the invoice was paid */
  readonly paidAt: Date
  /** Optional preimage */
  readonly preimage?: string
}

/** Validation error for zap requests */
export type ZapValidationError =
  | "Invalid zap request JSON."
  | "Zap request is not a valid Nostr event."
  | "Invalid signature on zap request."
  | "Zap request doesn't have a 'p' tag."
  | "Zap request 'p' tag is not valid hex."
  | "Zap request 'e' tag is not valid hex."
  | "Zap request doesn't have a 'relays' tag."

// =============================================================================
// Service Interface
// =============================================================================

export interface ZapService {
  readonly _tag: "ZapService"

  /**
   * Get the LNURL pay endpoint from profile metadata
   * Parses lud16 (lightning address) or lud06 (lnurl)
   */
  getZapEndpoint(
    metadata: NostrEvent
  ): Effect.Effect<string | null>

  /**
   * Create a zap request event (kind 9734)
   * This event is NOT published, but sent to the LNURL callback
   */
  makeZapRequest(
    params: ProfileZapParams | EventZapParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, CryptoError | InvalidPrivateKey>

  /**
   * Validate a zap request JSON string
   * Returns null if valid, error message if invalid
   */
  validateZapRequest(zapRequestString: string): Effect.Effect<ZapValidationError | null, CryptoError | InvalidPublicKey>

  /**
   * Create a zap receipt event (kind 9735)
   * This is created by the LNURL server after payment
   */
  makeZapReceipt(
    params: ZapReceiptParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, CryptoError | InvalidPrivateKey>

  /**
   * Parse the satoshi amount from a bolt11 invoice
   */
  getSatoshisAmountFromBolt11(bolt11: string): number
}

// =============================================================================
// Service Tag
// =============================================================================

export const ZapService = Context.GenericTag<ZapService>("ZapService")

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Decode LNURL (bech32-encoded URL)
 */
const decodeLnurl = (lnurl: string): string => {
  const { words } = bech32.decode(lnurl as `${string}1${string}`, 1000)
  const data = bech32.fromWords(words)
  return new TextDecoder().decode(new Uint8Array(data))
}

/**
 * Parse satoshi amount from bolt11 invoice
 * Based on nostr-tools implementation
 */
const parseBolt11Amount = (bolt11: string): number => {
  if (bolt11.length < 50) {
    return 0
  }
  bolt11 = bolt11.substring(0, 50)
  const idx = bolt11.lastIndexOf("1")
  if (idx === -1) {
    return 0
  }
  const hrp = bolt11.substring(0, idx)
  if (!hrp.startsWith("lnbc")) {
    return 0
  }
  const amount = hrp.substring(4)

  if (amount.length < 1) {
    return 0
  }

  const char = amount[amount.length - 1]!
  const digit = char.charCodeAt(0) - "0".charCodeAt(0)
  const isDigit = digit >= 0 && digit <= 9

  let cutPoint = amount.length - 1
  if (isDigit) {
    cutPoint++
  }

  if (cutPoint < 1) {
    return 0
  }

  const num = parseInt(amount.substring(0, cutPoint))

  switch (char) {
    case "m":
      return num * 100000
    case "u":
      return num * 100
    case "n":
      return num / 10
    case "p":
      return num / 10000
    default:
      return num * 100000000
  }
}

/**
 * Check if a string is valid 64-character hex
 */
const isValidHex64 = (s: string): boolean => /^[a-f0-9]{64}$/.test(s)

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const eventService = yield* EventService

  const getZapEndpoint: ZapService["getZapEndpoint"] = (metadata) =>
    Effect.sync(() => {
      try {
        const { lud06, lud16 } = JSON.parse(metadata.content)

        let lnurl: string = ""
        if (lud16) {
          const [name, domain] = lud16.split("@")
          if (name && domain) {
            lnurl = new URL(`/.well-known/lnurlp/${name}`, `https://${domain}`).toString()
          }
        } else if (lud06) {
          lnurl = decodeLnurl(lud06)
        }

        if (!lnurl) {
          return null
        }

        // Note: The actual HTTP fetch would be done by the caller
        // This just returns the LNURL endpoint URL
        return lnurl
      } catch {
        return null
      }
    })

  const makeZapRequest: ZapService["makeZapRequest"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: typeof Tag.Type[] = []

      // p tag - recipient pubkey
      const recipientPubkey = "pubkey" in params ? params.pubkey : params.event.pubkey
      tags.push(decodeTag(["p", recipientPubkey]))

      // amount tag
      tags.push(decodeTag(["amount", params.amount.toString()]))

      // relays tag
      tags.push(decodeTag(["relays", ...params.relays]))

      // lnurl tag (optional)
      if (params.lnurl) {
        tags.push(decodeTag(["lnurl", params.lnurl]))
      }

      // If zapping an event, add e tag and possibly a tag
      if ("event" in params) {
        tags.push(decodeTag(["e", params.event.id]))

        // Add 'a' tag for replaceable/addressable events
        if (isReplaceableKind(params.event.kind)) {
          const a = `${params.event.kind}:${params.event.pubkey}:`
          tags.push(decodeTag(["a", a]))
        } else if (isParameterizedReplaceableKind(params.event.kind)) {
          const d = getDTagValue(params.event) ?? ""
          const a = `${params.event.kind}:${params.event.pubkey}:${d}`
          tags.push(decodeTag(["a", a]))
        }

        // Add k tag for event kind
        tags.push(decodeTag(["k", params.event.kind.toString()]))
      }

      const event = yield* eventService.createEvent(
        {
          kind: ZAP_REQUEST_KIND,
          content: params.comment ?? "",
          tags,
        },
        privateKey
      )

      return event
    })

  const validateZapRequest: ZapService["validateZapRequest"] = (zapRequestString) =>
    Effect.gen(function* () {
      let zapRequest: NostrEvent

      try {
        zapRequest = JSON.parse(zapRequestString)
      } catch {
        return "Invalid zap request JSON." as ZapValidationError
      }

      // Check basic event structure
      if (!zapRequest.id || !zapRequest.pubkey || !zapRequest.sig || !zapRequest.kind || !zapRequest.tags) {
        return "Zap request is not a valid Nostr event." as ZapValidationError
      }

      // Verify signature
      const isValid = yield* eventService.verifyEvent(zapRequest)
      if (!isValid) {
        return "Invalid signature on zap request." as ZapValidationError
      }

      // Check for p tag
      const pTag = zapRequest.tags.find((t) => t[0] === "p" && t[1])
      if (!pTag) {
        return "Zap request doesn't have a 'p' tag." as ZapValidationError
      }
      if (!isValidHex64(pTag[1]!)) {
        return "Zap request 'p' tag is not valid hex." as ZapValidationError
      }

      // Check for e tag (if present)
      const eTag = zapRequest.tags.find((t) => t[0] === "e" && t[1])
      if (eTag && !isValidHex64(eTag[1]!)) {
        return "Zap request 'e' tag is not valid hex." as ZapValidationError
      }

      // Check for relays tag
      const relaysTag = zapRequest.tags.find((t) => t[0] === "relays" && t[1])
      if (!relaysTag) {
        return "Zap request doesn't have a 'relays' tag." as ZapValidationError
      }

      return null
    })

  const makeZapReceipt: ZapService["makeZapReceipt"] = (params, privateKey) =>
    Effect.gen(function* () {
      const zapRequest: NostrEvent = JSON.parse(params.zapRequest)

      // Extract tags from zap request (e, p, a)
      const tagsFromZapRequest = zapRequest.tags.filter(
        (t) => t[0] === "e" || t[0] === "p" || t[0] === "a"
      )

      const tags: typeof Tag.Type[] = tagsFromZapRequest.map((t) => decodeTag([...t]))

      // Add P tag (sender's pubkey from zap request)
      tags.push(decodeTag(["P", zapRequest.pubkey]))

      // Add bolt11 tag
      tags.push(decodeTag(["bolt11", params.bolt11]))

      // Add description tag (the zap request JSON)
      tags.push(decodeTag(["description", params.zapRequest]))

      // Add preimage tag if provided
      if (params.preimage) {
        tags.push(decodeTag(["preimage", params.preimage]))
      }

      // Use paidAt timestamp for idempotency (same payment always produces same event)
      const timestamp = Math.round(params.paidAt.getTime() / 1000)
      const event = yield* eventService.createEvent(
        {
          kind: ZAP_RECEIPT_KIND,
          content: "",
          tags,
          created_at: timestamp as typeof import("../core/Schema.js").UnixTimestamp.Type,
        },
        privateKey
      )

      return event
    })

  const getSatoshisAmountFromBolt11: ZapService["getSatoshisAmountFromBolt11"] = (bolt11) =>
    parseBolt11Amount(bolt11)

  return {
    _tag: "ZapService" as const,
    getZapEndpoint,
    makeZapRequest,
    validateZapRequest,
    makeZapReceipt,
    getSatoshisAmountFromBolt11,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for ZapService
 * Requires EventService
 */
export const ZapServiceLive = Layer.effect(ZapService, make)
