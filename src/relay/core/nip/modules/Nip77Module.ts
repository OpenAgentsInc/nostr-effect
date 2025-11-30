import { createModule, type NipModule } from "../NipModule.js"

export const Nip77Module: NipModule = createModule({
  id: "nip-77",
  nips: [77],
  description: "Negentropy sync protocol (server supports NEG-OPEN/MSG/CLOSE stubs)",
  kinds: [],
})

