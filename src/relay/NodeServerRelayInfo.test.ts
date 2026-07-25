/**
 * NIP-11 must describe what the relay actually enforces (#169).
 *
 * The deployed relay advertised `supported_nips: [1,11,16,33]` while actively
 * sending NIP-42 AUTH challenges and dropping unauthenticated REQs. A
 * conforming client reads NIP-11, sees no 42, issues a REQ, and is disconnected
 * with no way to discover why.
 *
 * `supported_nips` was a hardcoded literal that consulted neither the NIP
 * module registry nor the auth configuration.
 */
import { describe, test, expect, afterAll } from "vite-plus/test"
import { startTestRelay, type RelayHandle } from "./backends/node/index.js"

const PORT = 7793
let handle: RelayHandle | undefined

afterAll(async () => {
  if (handle) await handle.stop()
})

describe("NIP-11 supported_nips", () => {
  test("advertises NIP-42 when the relay enforces auth", async () => {
    handle = await startTestRelay(PORT)
    const response = await fetch(`http://127.0.0.1:${PORT}`, {
      headers: { Accept: "application/nostr+json" },
    })
    const info = (await response.json()) as { supported_nips?: number[] }

    expect(info.supported_nips).toBeDefined()
    // The relay sends an AUTH challenge on connect, so it must say so.
    expect(info.supported_nips).toContain(42)
    // Registry-derived NIPs come through as well, not just the old literal.
    expect(info.supported_nips).toContain(1)
    expect(info.supported_nips).toContain(11)
    // Sorted and unique.
    const nips = info.supported_nips as number[]
    expect([...new Set(nips)].sort((a, b) => a - b)).toEqual(nips)
  })
})
