import { createModule, type NipModule } from "../NipModule.js"

export const Nip70Module: NipModule = createModule({
  id: "nip-70",
  nips: [70],
  description: "Protected events (tag '-') require NIP-42 auth for the same pubkey (enforced by MessageHandler).",
  kinds: [],
})

