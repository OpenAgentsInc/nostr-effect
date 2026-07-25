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
// A relay may legitimately answer on more than one hostname: a custom domain
// plus its platform hostname during certificate provisioning, or two names
// during a migration. NIP-42 binds the auth event to the URL the client
// dialled, and clients validate that binding locally too, so a relay that
// accepts only one name cannot be reached through any other. Accept a
// comma-separated set. The first entry stays the canonical public URL.
const publicUrls = (process.env.RELAY_PUBLIC_URL ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0)

if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error("relay: DATABASE_URL is required")
}
if (
  publicUrls.length === 0 ||
  !publicUrls.every((value) => /^wss:\/\/[^/?#]+\/?$/.test(value))
) {
  throw new Error(
    "relay: RELAY_PUBLIC_URL must be one or more comma-separated origin-only wss URLs"
  )
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
      relayUrls: publicUrls,
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
