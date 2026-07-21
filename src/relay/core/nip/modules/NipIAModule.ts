import { createModule, type NipModule } from "../NipModule.js"

/**
 * NIP-IA: Identity Archival
 *
 * Advertises support for archive/unarchive requests, relay-signed deltas, and
 * the replaceable archived-identities snapshot. Full request authorization and
 * state-machine processing is policy-defined and not implemented in this stub;
 * client builders/parsers live in `src/client/NipIAService.ts`.
 *
 * Kinds: 9035, 9036 (user requests), 8002, 8003 (deltas), 13535 (snapshot).
 *
 * Lettered NIP — does not appear in numeric `supported_nips`.
 */
export const NipIAModule: NipModule = createModule({
  id: "nip-IA",
  nips: [],
  description:
    "NIP-IA Identity Archival (kinds 9035/9036/8002/8003/13535; NIP-70 protected)",
  kinds: [9035, 9036, 8002, 8003, 13535],
})
