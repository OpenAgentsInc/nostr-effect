import { createModule, type NipModule } from "../NipModule.js"

export const Nip50Module: NipModule = createModule({
  id: "nip-50",
  nips: [50],
  description: "Search capability via filter.search (FilterMatcher).",
  kinds: [],
})

