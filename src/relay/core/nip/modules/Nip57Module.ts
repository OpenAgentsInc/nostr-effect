/**
 * NIP-57 Module
 *
 * Lightning Zaps - zap requests and receipts.
 * This module primarily advertises NIP-57 support in relay info.
 * The actual zap flow involves LNURL servers.
 *
 * Event kinds:
 * - 9734: Zap request (typically not published to relays, sent to LNURL callback)
 * - 9735: Zap receipt (published by LNURL server after payment)
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/57.md
 */
import { type NipModule, createModule } from "../NipModule.js"
import {
  ZAP_REQUEST_KIND,
  ZAP_RECEIPT_KIND,
} from "../../../../core/Schema.js"

// =============================================================================
// Module
// =============================================================================

/**
 * NIP-57 Module for Lightning Zaps support
 *
 * This module:
 * - Advertises NIP-57 support in relay info
 * - Handles kinds 9734 and 9735
 *
 * Note: Zap requests (9734) are typically NOT published to relays.
 * They are sent directly to the LNURL callback. However, relays
 * may receive them for validation purposes.
 *
 * Zap receipts (9735) ARE published to relays by the LNURL server
 * after payment, so clients can query for them.
 */
export const Nip57Module: NipModule = createModule({
  id: "nip-57",
  nips: [57],
  description: "Lightning Zaps: zap requests and receipts",
  kinds: [
    ZAP_REQUEST_KIND as number,
    ZAP_RECEIPT_KIND as number,
  ],
  // No special policies needed - standard event validation applies
  policies: [],
  // No special hooks needed - events are stored normally
})
