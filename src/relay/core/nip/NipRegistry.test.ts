/**
 * NIP Module System Tests
 */
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import {
  type NipModule,
  createModule,
  handlesKind,
  getAllNips,
  mergeRelayInfo,
} from "./NipModule.js"
import { NipRegistry, NipRegistryLive } from "./NipRegistry.js"
import { Nip01Module, createNip01Module } from "./modules/Nip01Module.js"
import { Nip11Module, createNip11Module } from "./modules/Nip11Module.js"
import { Nip16Module } from "./modules/Nip16Module.js"
import { DefaultModules } from "./modules/index.js"
import type { NostrEvent } from "../../../core/Schema.js"

// =============================================================================
// Test Fixtures
// =============================================================================

const createTestEvent = (overrides: Partial<{
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}> = {}): NostrEvent =>
  ({
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "test content",
    sig: "test-sig",
    ...overrides,
  }) as unknown as NostrEvent

// =============================================================================
// NipModule Tests
// =============================================================================

describe("NipModule", () => {
  describe("createModule", () => {
    it("should create a module with defaults", () => {
      const module = createModule({
        id: "test",
        nips: [99],
        description: "Test module",
        kinds: [1, 2],
      })

      expect(module.id).toBe("test")
      expect(module.nips).toEqual([99])
      expect(module.description).toBe("Test module")
      expect(module.kinds).toEqual([1, 2])
      expect(module.policies).toEqual([])
    })
  })

  describe("handlesKind", () => {
    it("should return true if kinds is empty (handles all)", () => {
      const module = createModule({
        id: "test",
        nips: [1],
        description: "Test",
        kinds: [],
      })

      expect(handlesKind(module, 1)).toBe(true)
      expect(handlesKind(module, 9999)).toBe(true)
    })

    it("should return true only for specified kinds", () => {
      const module = createModule({
        id: "test",
        nips: [1],
        description: "Test",
        kinds: [1, 3, 10002],
      })

      expect(handlesKind(module, 1)).toBe(true)
      expect(handlesKind(module, 3)).toBe(true)
      expect(handlesKind(module, 10002)).toBe(true)
      expect(handlesKind(module, 2)).toBe(false)
      expect(handlesKind(module, 9999)).toBe(false)
    })
  })

  describe("getAllNips", () => {
    it("should collect all unique NIPs from modules", () => {
      const modules: NipModule[] = [
        createModule({ id: "a", nips: [1, 11], description: "", kinds: [] }),
        createModule({ id: "b", nips: [11, 16], description: "", kinds: [] }),
        createModule({ id: "c", nips: [33], description: "", kinds: [] }),
      ]

      const nips = getAllNips(modules)
      expect(nips).toEqual([1, 11, 16, 33])
    })

    it("should return empty array for no modules", () => {
      expect(getAllNips([])).toEqual([])
    })
  })

  describe("mergeRelayInfo", () => {
    it("should merge relay info from multiple modules", () => {
      const modules: NipModule[] = [
        createModule({
          id: "a",
          nips: [1],
          description: "",
          kinds: [],
          relayInfo: { name: "Test Relay" },
        }),
        createModule({
          id: "b",
          nips: [11],
          description: "",
          kinds: [],
          relayInfo: { description: "A test relay" },
        }),
      ]

      const info = mergeRelayInfo(modules)
      expect(info.name).toBe("Test Relay")
      expect(info.description).toBe("A test relay")
      expect(info.supported_nips).toEqual([1, 11])
    })

    it("should merge limitations from modules", () => {
      const modules: NipModule[] = [
        createModule({
          id: "a",
          nips: [1],
          description: "",
          kinds: [],
          limitations: { max_content_length: 64000 },
        }),
        createModule({
          id: "b",
          nips: [11],
          description: "",
          kinds: [],
          limitations: { max_event_tags: 2000 },
        }),
      ]

      const info = mergeRelayInfo(modules)
      expect(info.limitation?.max_content_length).toBe(64000)
      expect(info.limitation?.max_event_tags).toBe(2000)
    })

    it("should use base info", () => {
      const modules: NipModule[] = [
        createModule({ id: "a", nips: [1], description: "", kinds: [] }),
      ]

      const info = mergeRelayInfo(modules, { version: "1.0.0" })
      expect(info.version).toBe("1.0.0")
    })
  })
})

// =============================================================================
// Built-in Module Tests
// =============================================================================

describe("Built-in Modules", () => {
  describe("Nip01Module", () => {
    it("should have correct NIP number", () => {
      expect(Nip01Module.nips).toEqual([1])
    })

    it("should have policies for signature, content, and tags", () => {
      expect(Nip01Module.policies.length).toBe(3)
    })

    it("should be configurable", () => {
      const custom = createNip01Module({
        maxContentLength: 1000,
        maxTags: 100,
      })

      expect(custom.limitations?.max_content_length).toBe(1000)
      expect(custom.limitations?.max_event_tags).toBe(100)
    })

    it("should support timestamp limits", () => {
      const custom = createNip01Module({
        maxFutureSeconds: 60,
        maxPastSeconds: 3600,
      })

      // Should add timestamp policies (signature + content + tags + 2 timestamp = 5)
      expect(custom.policies.length).toBe(5)
      // Should report limits in NIP-11
      expect(custom.limitations?.created_at_upper_limit).toBe(60)
      expect(custom.limitations?.created_at_lower_limit).toBe(3600)
    })

    it("should not include timestamp limits when not configured", () => {
      const custom = createNip01Module({})

      // Only signature, content, tags
      expect(custom.policies.length).toBe(3)
      expect(custom.limitations?.created_at_upper_limit).toBeUndefined()
      expect(custom.limitations?.created_at_lower_limit).toBeUndefined()
    })
  })

  describe("Nip11Module", () => {
    it("should have correct NIP number", () => {
      expect(Nip11Module.nips).toEqual([11])
    })

    it("should be configurable", () => {
      const custom = createNip11Module({
        name: "My Relay",
        description: "My description",
        pubkey: "abc123",
      })

      expect(custom.relayInfo?.name).toBe("My Relay")
      expect(custom.relayInfo?.description).toBe("My description")
      expect(custom.relayInfo?.pubkey).toBe("abc123")
    })
  })

  describe("Nip16Module", () => {
    it("should have correct NIP numbers", () => {
      expect(Nip16Module.nips).toEqual([16, 33])
    })

    it("should have a pre-store hook", () => {
      expect(Nip16Module.preStoreHook).toBeDefined()
    })

    it("should return store action for regular events", async () => {
      const event = createTestEvent({ kind: 1 })
      const result = await Effect.runPromise(Nip16Module.preStoreHook!(event))

      expect(result.action).toBe("store")
      if (result.action === "store") {
        expect(result.event).toBe(event)
      }
    })

    it("should return replace action for replaceable events", async () => {
      const event = createTestEvent({ kind: 0 }) // kind 0 is replaceable
      const result = await Effect.runPromise(Nip16Module.preStoreHook!(event))

      expect(result.action).toBe("replace")
      if (result.action === "replace") {
        expect(result.deleteFilter?.kinds).toEqual([0])
        expect(result.deleteFilter?.authors).toEqual(["test-pubkey"])
      }
    })

    it("should return replace action for parameterized replaceable events", async () => {
      const event = createTestEvent({
        kind: 30000,
        tags: [["d", "my-identifier"]],
      })
      const result = await Effect.runPromise(Nip16Module.preStoreHook!(event))

      expect(result.action).toBe("replace")
      if (result.action === "replace") {
        expect(result.deleteFilter?.kinds).toEqual([30000])
        expect(result.deleteFilter?.dTag).toBe("my-identifier")
      }
    })
  })

  describe("DefaultModules", () => {
    it("should include NIP-01, NIP-11, and NIP-16", () => {
      const nips = getAllNips(DefaultModules)
      expect(nips).toContain(1)
      expect(nips).toContain(11)
      expect(nips).toContain(16)
      expect(nips).toContain(33)
    })
  })
})

// =============================================================================
// NipRegistry Tests
// =============================================================================

describe("NipRegistry", () => {
  it("should create registry with modules", () => {
    const registry = Effect.runSync(
      Effect.gen(function* () {
        return yield* NipRegistry
      }).pipe(Effect.provide(NipRegistryLive(DefaultModules)))
    )

    expect(registry.modules.length).toBe(3)
    expect(registry.supportedNips).toEqual([1, 11, 16, 33])
  })

  it("should check if module exists", () => {
    const registry = Effect.runSync(
      Effect.gen(function* () {
        return yield* NipRegistry
      }).pipe(Effect.provide(NipRegistryLive(DefaultModules)))
    )

    expect(registry.hasModule("nip-01")).toBe(true)
    expect(registry.hasModule("nip-99")).toBe(false)
  })

  it("should get module by ID", () => {
    const registry = Effect.runSync(
      Effect.gen(function* () {
        return yield* NipRegistry
      }).pipe(Effect.provide(NipRegistryLive(DefaultModules)))
    )

    const module = registry.getModule("nip-16")
    expect(module?.nips).toEqual([16, 33])
  })

  it("should get combined relay info", () => {
    const registry = Effect.runSync(
      Effect.gen(function* () {
        return yield* NipRegistry
      }).pipe(Effect.provide(NipRegistryLive(DefaultModules)))
    )

    const info = registry.getRelayInfo()
    expect(info.supported_nips).toEqual([1, 11, 16, 33])
    expect(info.name).toBe("nostr-effect relay")
  })

  it("should run pre-store hooks", async () => {
    const registry = Effect.runSync(
      Effect.gen(function* () {
        return yield* NipRegistry
      }).pipe(Effect.provide(NipRegistryLive(DefaultModules)))
    )

    // Regular event
    const regularEvent = createTestEvent({ kind: 1 })
    const result1 = await Effect.runPromise(registry.runPreStoreHooks(regularEvent))
    expect(result1.action).toBe("store")

    // Replaceable event
    const replaceableEvent = createTestEvent({ kind: 0 })
    const result2 = await Effect.runPromise(registry.runPreStoreHooks(replaceableEvent))
    expect(result2.action).toBe("replace")
  })
})
