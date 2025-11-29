import { createModule, type NipModule } from "../NipModule.js"

export const Nip62Module: NipModule = createModule({
  id: "nip-62",
  nips: [62],
  description: "Request to Vanish (kind 62). Deletion of older events handled in MessageHandler.",
  kinds: [62],
})

