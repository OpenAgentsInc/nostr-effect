/**
 * NIP Module System
 *
 * Pluggable NIP support for the relay.
 */

// Core types and interfaces
export {
  type NipModule,
  type PreStoreHook,
  type PostStoreHook,
  type EventDeleteFilter,
  createModule,
  handlesKind,
  getAllNips,
  mergeRelayInfo,
} from "./NipModule.js"

// Registry service
export { NipRegistry, NipRegistryLive, NipRegistryEmpty } from "./NipRegistry.js"

// Built-in modules
export * from "./modules/index.js"
