import { createModule, type NipModule } from "../NipModule.js"

/**
 * NIP-B0: Web Bookmarking (kind 39701)
 * Behavior (param replaceable) is covered by NIP-16/33 in the pipeline.
 * Module advertises support.
 */
export const NipB0Module: NipModule = createModule({
  id: "nip-B0",
  nips: [],
  description: "Lettered spec B0 Web Bookmarking (kind 39701)",
  kinds: [39701],
})

