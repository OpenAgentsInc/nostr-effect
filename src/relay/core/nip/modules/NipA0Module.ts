import { createModule, type NipModule } from "../NipModule.js"

/**
 * NIP-A0 (Lettered)
 *
 * Placeholder module to advertise support for lettered spec A0.
 * No numeric NIP is associated; this does not affect NIP-11 supported_nips.
 */
export const NipA0Module: NipModule = createModule({
  id: "nip-A0",
  nips: [],
  description: "Lettered spec A0 (placeholder module)",
  kinds: [],
})

