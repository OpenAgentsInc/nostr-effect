/**
 * Identity façade for OpenAgents #9092 (and any local NIP-06 identity).
 *
 * @example
 * ```typescript
 * import { IdentityKeys, LocalKeySigner } from "nostr-effect/identity"
 *
 * const id = IdentityKeys.fromOpenAgentsLegacyMnemonic(fixtureMnemonic)
 * const signer = id.asSigner()
 * await signer.signEvent({ kind: 1, content: "hi", tags: [] })
 * // Public only:
 * console.log(id.toPublicManifest())
 * ```
 */

export {
  LocalKeySigner,
  type LocalSignerPort,
  type PublicIdentityManifest,
  type SignEventTemplate,
} from "../core/LocalSigner.js"

export {
  IdentityKeys,
  type IdentityKeysOptions,
  type GenerateIdentityOptions,
  type GeneratedIdentity,
} from "../core/IdentityKeys.js"

// Re-export path/profile constants used by identity manifests
export {
  NIP06_ACCOUNT_PATH,
  OPENAGENTS_LEGACY_IDENTITY_PROFILE,
  DERIVATION_PATH,
} from "../core/Nip06.js"
