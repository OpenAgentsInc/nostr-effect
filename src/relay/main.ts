/**
 * Standalone relay entry point (Node 24)
 * Usage: node --import tsx src/relay/main.ts
 *    or: pnpm exec tsx src/relay/main.ts
 */
import { Effect } from "effect"
import { startRelayWithEventStore } from "./backends/node/index.js"
import { openPostgresStore } from "./backends/node/PostgresStore.js"

const port = Number(process.env.PORT) || 8080
const databaseUrl = process.env.DATABASE_URL?.trim()
const publicUrl = process.env.RELAY_PUBLIC_URL?.trim()

if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error("relay: DATABASE_URL is required")
}
if (publicUrl === undefined || !/^wss:\/\/[^/?#]+\/?$/.test(publicUrl)) {
  throw new Error("relay: RELAY_PUBLIC_URL must be an origin-only wss URL")
}

const store = await openPostgresStore(databaseUrl)
const relay = await startRelayWithEventStore(
  {
    port,
    relayInfo: {
      name: "OpenAgents Relay",
      description: "OpenAgents-owned Nostr relay",
      contact: "mailto:support@openagents.com",
    },
    nip42: {
      relayUrls: [publicUrl],
      authRequired: true,
    },
  },
  store.store
)

console.log(JSON.stringify({ event: "relay.listening", port: relay.port }))

let stopping = false
const stop = async (signal: string): Promise<void> => {
  if (stopping) return
  stopping = true
  console.log(JSON.stringify({ event: "relay.shutdown_start", signal }))
  await Effect.runPromise(relay.stop())
  await store.close()
  console.log(JSON.stringify({ event: "relay.shutdown_done" }))
}

process.on("SIGTERM", () => void stop("SIGTERM"))
process.on("SIGINT", () => void stop("SIGINT"))
