import { createModule, type NipModule } from "../NipModule.js"

export const Nip45Module: NipModule = createModule({
  id: "nip-45",
  nips: [45],
  description: "COUNT messages supported (MessageHandler handleCount).",
  kinds: [],
})

