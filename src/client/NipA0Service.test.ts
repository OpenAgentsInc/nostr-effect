/**
 * NipA0Service tests (lettered spec placeholder)
 */
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { NipA0Service, NipA0ServiceLive } from "./NipA0Service.js"

describe("NipA0Service", () => {
  test("returns stub info", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* NipA0Service
      const info = yield* svc.info()
      expect(info.id).toBe("A0")
      expect(info.status).toBe("stub")
    }).pipe(Effect.provide(NipA0ServiceLive))

    await Effect.runPromise(program)
  })
})

