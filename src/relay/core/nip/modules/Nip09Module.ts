import { createModule, type NipModule } from "../NipModule.js"

export const Nip09Module: NipModule = createModule({
  id: "nip-09",
  nips: [9],
  description: "Event Deletion (kind 5). Deletion executed in MessageHandler prior to storage.",
  kinds: [5],
})

