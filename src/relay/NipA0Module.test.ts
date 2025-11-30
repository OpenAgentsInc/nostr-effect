/**
 * NIP-A0 module registration test (lettered spec)
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { NipRegistry, NipRegistryLive } from "./core/nip/NipRegistry.js"
import { DefaultModules } from "./core/nip/modules/index.js"

describe("NipA0Module", () => {
  test("registry includes nip-A0 module", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* NipRegistry
      const has = reg.hasModule("nip-A0")
      expect(has).toBe(true)
    }).pipe(Effect.provide(NipRegistryLive(DefaultModules as any)))

    await Effect.runPromise(program)
  })
})
