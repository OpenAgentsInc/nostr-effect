/**
 * NIP-29 Module
 *
 * Advertises relay-based groups support via NIP-11.
 * Moderation authorization is relay-policy specific; this module declares kinds.
 */
import { createModule, type NipModule } from "../NipModule.js"

export const Nip29Module: NipModule = createModule({
  id: "nip-29",
  nips: [29],
  description:
    "Relay-based groups: metadata 39000–39005, moderation 9000–9010, join 9021, LiveKit well-known endpoints",
  kinds: [
    9000, 9001, 9002, 9005, 9007, 9008, 9009, 9010, 9021,
    39000, 39001, 39002, 39003, 39004, 39005,
  ],
})
