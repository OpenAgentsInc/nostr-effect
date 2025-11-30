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
export { Nip09Module } from "./Nip09Module.js"
export { Nip20Module } from "./Nip20Module.js"
export { Nip45Module } from "./Nip45Module.js"
export { Nip50Module } from "./Nip50Module.js"
export { Nip62Module } from "./Nip62Module.js"
export { Nip70Module } from "./Nip70Module.js"
export { Nip15Module } from "./Nip15Module.js"
export { Nip86Module } from "./Nip86Module.js"
export { Nip77Module } from "./Nip77Module.js"
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
import { Nip28Module } from "./Nip28Module.js"
import { Nip57Module } from "./Nip57Module.js"
import { Nip09Module } from "./Nip09Module.js"
import { Nip20Module } from "./Nip20Module.js"
import { Nip45Module } from "./Nip45Module.js"
import { Nip50Module } from "./Nip50Module.js"
import { Nip62Module } from "./Nip62Module.js"
import { Nip70Module } from "./Nip70Module.js"
import { Nip15Module } from "./Nip15Module.js"
import { Nip86Module } from "./Nip86Module.js"
import { Nip77Module } from "./Nip77Module.js"
import type { NipModule } from "../NipModule.js"

/**
 * Default set of NIP modules for a basic relay
 * Includes: NIP-01 (basic), NIP-11 (info), NIP-16/33 (replaceable events)
 */
export const DefaultModules: readonly NipModule[] = [
  Nip01Module,
  Nip11Module,
  Nip16Module,
  Nip28Module,
  Nip57Module,
  Nip09Module,
  Nip20Module,
  Nip45Module,
  Nip50Module,
  Nip62Module,
  Nip70Module,
  Nip15Module,
  Nip86Module,
  Nip77Module,
]
