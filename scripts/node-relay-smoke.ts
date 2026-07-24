/**
 * Smoke: start a Node relay under Node 24 (no Bun runtime).
 *
 *   node --experimental-strip-types scripts/node-relay-smoke.ts
 */
import { Effect } from "effect"
import { startTestRelay } from "../src/relay/backends/node/index.ts"

const port = 18765
const relay = await startTestRelay(port)

const nip11 = await fetch(`http://127.0.0.1:${port}/`, {
  headers: { Accept: "application/nostr+json" },
})
if (!nip11.ok) {
  throw new Error(`NIP-11 failed: ${nip11.status}`)
}
const info = (await nip11.json()) as { name?: string }
console.log("nip11", info.name)

const { default: WebSocket } = await import("ws")
const ws = new WebSocket(`ws://127.0.0.1:${port}`)
const auth = await new Promise<unknown>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("AUTH timeout")), 3000)
  ws.once("open", () => {
    /* wait for AUTH */
  })
  ws.once("message", (data) => {
    clearTimeout(timer)
    resolve(JSON.parse(data.toString()))
  })
  ws.once("error", reject)
})
console.log("auth", auth)
ws.close()

await Effect.runPromise(relay.stop())
console.log("ok node relay smoke")
