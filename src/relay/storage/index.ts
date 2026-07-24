/**
 * Storage Module
 *
 * Platform-agnostic event storage interface.
 * Use backend-specific implementations under backends/.
 */
export { EventStore, type ReplaceableStoreResult } from "./EventStore.js"
