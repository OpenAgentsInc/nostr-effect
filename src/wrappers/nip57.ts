/**
 * NIP-57: Lightning Zaps
 *
 * Create zap requests, receipts, and fetch zap endpoints.
 *
 * @example
 * ```typescript
 * import { getZapEndpoint, makeZapRequest, validateZapRequest } from 'nostr-effect/nip57'
 *
 * // Get zap endpoint from profile
 * const endpoint = await getZapEndpoint(profileEvent)
 *
 * // Create a zap request
 * const zapRequest = makeZapRequest({
 *   pubkey: recipientPubkey,
 *   amount: 1000000, // millisats
 *   relays: ['wss://relay.example.com']
 * })
 * ```
 */

import { validateEvent, verifyEvent } from "./pure.js"
import { isReplaceable, isParameterizedReplaceable } from "./kinds.js"

// Re-export pure functions from service
export { getSatoshisAmountFromBolt11, decodeLnurl } from "../client/ZapService.js"

let _fetch: typeof fetch = globalThis.fetch

/**
 * Set a custom fetch implementation
 */
export function useFetchImplementation(fetchImplementation: typeof fetch): void {
  _fetch = fetchImplementation
}

/** Event type */
export interface Event {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Event template (unsigned) */
export interface EventTemplate {
  kind: number
  created_at: number
  content: string
  tags: string[][]
}

/** Parameters for zapping a profile */
export interface ProfileZapParams {
  pubkey: string
  amount: number
  comment?: string
  relays: string[]
}

/** Parameters for zapping an event */
export interface EventZapParams {
  event: Event
  amount: number
  comment?: string
  relays: string[]
}

/** Parameters for creating a zap receipt */
export interface ZapReceiptParams {
  zapRequest: string
  preimage?: string
  bolt11: string
  paidAt: Date
}

// Import decodeLnurl for internal use
import { decodeLnurl } from "../client/ZapService.js"

/**
 * Get the zap endpoint from profile metadata
 */
export async function getZapEndpoint(metadata: Event): Promise<string | null> {
  try {
    let lnurl: string = ""
    const { lud06, lud16 } = JSON.parse(metadata.content)
    if (lud16) {
      const [name, domain] = lud16.split("@")
      lnurl = new URL(`/.well-known/lnurlp/${name}`, `https://${domain}`).toString()
    } else if (lud06) {
      lnurl = decodeLnurl(lud06)
    } else {
      return null
    }

    const res = await _fetch(lnurl)
    const body = (await res.json()) as { allowsNostr?: boolean; nostrPubkey?: string; callback?: string }

    if (body.allowsNostr && body.nostrPubkey) {
      return body.callback ?? null
    }
  } catch (_err) {
    // Ignore errors
  }

  return null
}

/**
 * Create a zap request event template
 */
export function makeZapRequest(params: ProfileZapParams | EventZapParams): EventTemplate {
  const zr: EventTemplate = {
    kind: 9734,
    created_at: Math.round(Date.now() / 1000),
    content: params.comment || "",
    tags: [
      ["p", "pubkey" in params ? params.pubkey : params.event.pubkey],
      ["amount", params.amount.toString()],
      ["relays", ...params.relays],
    ],
  }

  if ("event" in params) {
    zr.tags.push(["e", params.event.id])
    if (isReplaceable(params.event.kind)) {
      const a = ["a", `${params.event.kind}:${params.event.pubkey}:`]
      zr.tags.push(a)
    } else if (isParameterizedReplaceable(params.event.kind)) {
      const d = params.event.tags.find(([t, v]) => t === "d" && v)
      if (!d) throw new Error("d tag not found or is empty")
      const a = ["a", `${params.event.kind}:${params.event.pubkey}:${d[1]}`]
      zr.tags.push(a)
    }
    zr.tags.push(["k", params.event.kind.toString()])
  }

  return zr
}

/**
 * Validate a zap request JSON string
 * @returns null if valid, error message if invalid
 */
export function validateZapRequest(zapRequestString: string): string | null {
  let zapRequest: Event

  try {
    zapRequest = JSON.parse(zapRequestString)
  } catch (_err) {
    return "Invalid zap request JSON."
  }

  if (!validateEvent(zapRequest as Parameters<typeof validateEvent>[0])) {
    return "Zap request is not a valid Nostr event."
  }

  if (!verifyEvent(zapRequest as Parameters<typeof verifyEvent>[0])) {
    return "Invalid signature on zap request."
  }

  const p = zapRequest.tags.find(([t, v]) => t === "p" && v)
  if (!p) return "Zap request doesn't have a 'p' tag."
  if (!p[1]!.match(/^[a-f0-9]{64}$/)) return "Zap request 'p' tag is not valid hex."

  const e = zapRequest.tags.find(([t, v]) => t === "e" && v)
  if (e && !e[1]!.match(/^[a-f0-9]{64}$/)) return "Zap request 'e' tag is not valid hex."

  const relays = zapRequest.tags.find(([t, v]) => t === "relays" && v)
  if (!relays) return "Zap request doesn't have a 'relays' tag."

  return null
}

/**
 * Create a zap receipt event template
 */
export function makeZapReceipt(params: ZapReceiptParams): EventTemplate {
  const zr: Event = JSON.parse(params.zapRequest)
  const tagsFromZapRequest = zr.tags.filter(([t]) => t === "e" || t === "p" || t === "a")

  const zap: EventTemplate = {
    kind: 9735,
    created_at: Math.round(params.paidAt.getTime() / 1000),
    content: "",
    tags: [
      ...tagsFromZapRequest,
      ["P", zr.pubkey],
      ["bolt11", params.bolt11],
      ["description", params.zapRequest],
    ],
  }

  if (params.preimage) {
    zap.tags.push(["preimage", params.preimage])
  }

  return zap
}
