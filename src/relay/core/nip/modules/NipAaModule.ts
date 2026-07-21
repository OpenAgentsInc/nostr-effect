/**
 * NIP-AA Module
 *
 * Agent Authentication — virtual membership via NIP-OA credentials on NIP-42 AUTH.
 *
 * This module is intentionally thin: the verification algorithm lives as pure
 * helpers in `src/core/NipAA.ts`. Relays that enforce NIP-43 membership can
 * call `verifyAgentAuth` from their AUTH handler and grant virtual membership
 * on success. AUTH events (kind 22242) remain excluded from storage by NIP-42.
 *
 * Custom lettered NIPs advertise via NIP-11 `supported_extensions`, never
 * `supported_nips`. Wire that into your relay info document when enabling AA.
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-AA.md
 */
import { createModule, type NipModule } from "../NipModule.js"
import { AUTH_EVENT_KIND } from "../../../../core/Schema.js"

export {
  verifyAgentAuth,
  verifyAgentAuthSync,
  DEFAULT_MAX_AUTH_AGE_SECONDS,
  type AgentAuthResult,
  type AgentAuthMemberGrant,
  type AgentAuthVirtualGrant,
  type AgentAuthReject,
  type VerifyAgentAuthParams,
} from "../../../../core/NipAA.js"

/**
 * Extension identifier for NIP-11 `supported_extensions`.
 * Custom (non-numeric) NIPs MUST NOT appear in `supported_nips`.
 */
export const NIP_AA_EXTENSION = "nip-aa"

/**
 * Create a NIP-AA module stub.
 *
 * Does not add policies (admission is handled in the AUTH path, not EVENT
 * storage). Registers kind 22242 for discoverability alongside NIP-42.
 */
export const createNipAaModule = (): NipModule =>
  createModule({
    id: "nip-aa",
    // Lettered NIP — no numeric entry in supported_nips
    nips: [],
    description:
      "Agent Authentication: virtual membership via NIP-OA auth tag on NIP-42 AUTH",
    kinds: [AUTH_EVENT_KIND],
    policies: [],
  })

/** Default NIP-AA module instance (opt-in; not in DefaultModules). */
export const NipAaModule = createNipAaModule()
