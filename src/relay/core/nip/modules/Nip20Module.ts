import { createModule, type NipModule } from "../NipModule.js"

export const Nip20Module: NipModule = createModule({
  id: "nip-20",
  nips: [20],
  description: "OK command results (handled at MessageHandler layer).",
  kinds: [],
})

