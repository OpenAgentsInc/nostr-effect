/**
 * NIP-40 Module Tests
 */
import { describe, it, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Nip40Module } from "./Nip40Module.js"
import { EventServiceLive } from "../../../../services/EventService.js"
import { CryptoServiceLive } from "../../../../services/CryptoService.js"
import type { NostrEvent, EventId, PublicKey, UnixTimestamp, EventKind, Signature, Tag } from "../../../../core/Schema.js"
import type { PolicyContext } from "../../policy/Policy.js"

const now = Math.floor(Date.now() / 1000)

const createMockEvent = (expirationTag?: string): NostrEvent => ({
  id: "mockid" as EventId,
  pubkey: "mockpubkey" as PublicKey,
  created_at: now as UnixTimestamp,
  kind: 1 as EventKind,
  tags: expirationTag ? ([["expiration", expirationTag]] as unknown as readonly Tag[]) : [],
  content: "test",
  sig: "mocksig" as Signature,
})

describe("Nip40Module", () => {
  const module = Nip40Module
  const EventLayer = EventServiceLive.pipe(Layer.provide(CryptoServiceLive))

  it("creates module with correct configuration", () => {
    expect(module.id).toBe("nip-40")
    expect(module.nips).toEqual([40])
    expect(module.kinds).toEqual([])
    expect(module.policies).toHaveLength(1)
  })

  describe("expiration policy", () => {
    it("accepts non-expired event (no expiry tag)", async () => {
      const ctx: PolicyContext = { event: createMockEvent(), connectionId: "test", remoteAddress: undefined }
      const policy = module.policies[0]!
      const decision = await Effect.runPromise(policy(ctx).pipe(Effect.provide(EventLayer)))

      expect(decision._tag).toBe("Accept")
    })

    it("accepts future expiry", async () => {
      const ctx: PolicyContext = { event: createMockEvent((now + 3600).toString()), connectionId: "test", remoteAddress: undefined }
      const policy = module.policies[0]!
      const decision = await Effect.runPromise(policy(ctx).pipe(Effect.provide(EventLayer)))

      expect(decision._tag).toBe("Accept")
    })

    it("rejects past expiry", async () => {
      const ctx: PolicyContext = { event: createMockEvent((now - 3600).toString()), connectionId: "test", remoteAddress: undefined }
      const policy = module.policies[0]!
      const decision = await Effect.runPromise(policy(ctx).pipe(Effect.provide(EventLayer)))

      expect(decision._tag).toBe("Reject")
      // TODO: reason when PolicyDecision supports it
    })
  })
})
