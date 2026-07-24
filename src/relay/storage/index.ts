/**
 * Storage Module
 *
 * Platform-agnostic event storage interface and in-memory store.
 * Host-specific durable stores live under backends/.
 */
export { EventStore, type ReplaceableStoreResult } from "./EventStore.js"
export { MemoryEventStoreLive } from "./MemoryEventStore.js"
