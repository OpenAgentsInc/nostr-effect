/**
 * NIP Modules Index
 *
 * Re-exports all NIP modules and provides default module set.
 */

// Module exports
export { Nip01Module, createNip01Module, type Nip01Config } from "./Nip01Module.js"
export { Nip11Module, createNip11Module, type Nip11Config } from "./Nip11Module.js"
export { Nip16Module } from "./Nip16Module.js"
export { Nip28Module } from "./Nip28Module.js"
export { Nip57Module } from "./Nip57Module.js"
export {
  createNip42Module,
  verifyAuthEvent,
  generateChallenge,
  type Nip42Config,
  type AuthVerificationResult,
} from "./Nip42Module.js"

// =============================================================================
// Default Module Set
// =============================================================================

import { Nip01Module } from "./Nip01Module.js"
import { Nip11Module } from "./Nip11Module.js"
import { Nip16Module } from "./Nip16Module.js"
import type { NipModule } from "../NipModule.js"

/**
 * Default set of NIP modules for a basic relay
 * Includes: NIP-01 (basic), NIP-11 (info), NIP-16/33 (replaceable events)
 */
export const DefaultModules: readonly NipModule[] = [
  Nip01Module,
  Nip11Module,
  Nip16Module,
]
