import { createModule, type NipModule } from "../NipModule.js"

export const Nip86Module: NipModule = createModule({
  id: "nip-86",
  nips: [86],
  description: "Relay Management API over HTTP (JSON-RPC with NIP-98 auth)",
  kinds: [],
})

