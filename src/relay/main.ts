/**
 * Standalone relay entry point (Node 24)
 * Usage: node --import tsx src/relay/main.ts
 *    or: pnpm exec tsx src/relay/main.ts
 */
import { Effect } from "effect"
import { startRelayWithEventStore } from "./backends/node/index.js"
import { openPostgresStore } from "./backends/node/PostgresStore.js"
import {
  createRelayNip29Host,
  type RelayNip29SeedGroup,
} from "./backends/node/RelayNip29Host.js"

const port = Number(process.env.PORT) || 8080
const databaseUrl = process.env.DATABASE_URL?.trim()
let relayPrivateKey = process.env.RELAY_PRIVATE_KEY?.trim()
const seedGroupsJson = process.env.RELAY_NIP29_SEED_GROUPS?.trim()
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
if (relayPrivateKey === undefined || relayPrivateKey === "") {
  throw new Error("relay: RELAY_PRIVATE_KEY is required")
}
if (seedGroupsJson === undefined || seedGroupsJson === "") {
  throw new Error("relay: RELAY_NIP29_SEED_GROUPS is required")
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
let seedGroups: readonly RelayNip29SeedGroup[]
try {
  const decoded = JSON.parse(seedGroupsJson) as unknown
  if (!Array.isArray(decoded)) {
    throw new Error("value must be a JSON array")
  }
  seedGroups = decoded as readonly RelayNip29SeedGroup[]
} catch (error) {
  await store.close()
  throw new Error(
    `relay: RELAY_NIP29_SEED_GROUPS is invalid: ${error instanceof Error ? error.message : String(error)}`
  )
}

let nip29
try {
  nip29 = await createRelayNip29Host(
    {
      relayPrivateKey,
      seedGroups,
    },
    store.store
  )
} catch (error) {
  await store.close()
  throw error
} finally {
  relayPrivateKey = ""
  delete process.env.RELAY_PRIVATE_KEY
}

let relay
try {
  relay = await startRelayWithEventStore(
    {
      port,
      modules: nip29.modules,
      relayInfo: {
        name: "OpenAgents Relay",
        description: "OpenAgents-owned Nostr relay",
        contact: "mailto:support@openagents.com",
        self: nip29.relayPubkey,
        supported_kinds: [
          ...new Set(
            seedGroups.flatMap((group) => group.supportedKinds ?? [])
          ),
        ].sort((a, b) => a - b),
        limitation: {
          restricted_writes: true,
        },
      },
      nip42: {
        relayUrls: publicUrls,
        authRequired: true,
      },
    },
    store.store
  )
} catch (error) {
  nip29.dispose()
  await store.close()
  throw error
}

console.log(JSON.stringify({ event: "relay.listening", port: relay.port }))

let stopping = false
const stop = async (signal: string): Promise<void> => {
  if (stopping) return
  stopping = true
  console.log(JSON.stringify({ event: "relay.shutdown_start", signal }))
  await Effect.runPromise(relay.stop())
  nip29.dispose()
  await store.close()
  console.log(JSON.stringify({ event: "relay.shutdown_done" }))
}

process.on("SIGTERM", () => void stop("SIGTERM"))
process.on("SIGINT", () => void stop("SIGINT"))
