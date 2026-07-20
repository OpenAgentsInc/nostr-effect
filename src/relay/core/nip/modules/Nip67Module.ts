/**
 * NIP-67 Module
 *
 * EOSE Completeness Hint — advertise support via NIP-11.
 * Hint emission is implemented in MessageHandler (finish/more on EOSE).
 */
import { createModule, type NipModule } from "../NipModule.js"

export const Nip67Module: NipModule = createModule({
  id: "nip-67",
  nips: [67],
  description:
    "EOSE completeness hints: optional third element on EOSE with finish/more (emitted by MessageHandler)",
  kinds: [],
})
