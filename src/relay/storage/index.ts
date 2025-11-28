/**
 * Storage Module
 *
 * Platform-agnostic event storage interface.
 * Use backend-specific implementations (backends/bun, backends/cloudflare, etc.)
 */
export { EventStore, type ReplaceableStoreResult } from "./EventStore.js"
