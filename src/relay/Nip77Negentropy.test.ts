/**
 * NIP-77 Negentropy minimal handshake tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { startTestRelay, type RelayHandle } from "./index.js"

describe("NIP-77 Negentropy", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 23000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    const { Effect } = await import("effect")
    await Effect.runPromise(relay.stop())
  })

  test("NEG-OPEN -> NEG-MSG, NEG-MSG roundtrip, NEG-CLOSE", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/`)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = (e) => reject(e)
    })

    const subId = "neg1"
    const filter = { kinds: [1] }

    const recv = async (): Promise<any[]> =>
      new Promise<any[]>((resolve) => {
        ws.onmessage = (ev) => resolve(JSON.parse(String(ev.data)))
      })

    // Open
    ws.send(JSON.stringify(["NEG-OPEN", subId, filter, "61"]))
    const msg1 = await recv()
    expect(msg1[0]).toBe("NEG-MSG")
    expect(msg1[1]).toBe(subId)
    expect(typeof msg1[2]).toBe("string")

    // Exchange MSG
    ws.send(JSON.stringify(["NEG-MSG", subId, msg1[2]]))
    const msg2 = await recv()
    expect(msg2[0]).toBe("NEG-MSG")
    expect(msg2[1]).toBe(subId)

    // Close
    ws.send(JSON.stringify(["NEG-CLOSE", subId]))
    // No response needed; just ensure server stays open
    ws.close()
  })
})
