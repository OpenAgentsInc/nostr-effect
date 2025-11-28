/**
 * Standalone relay entry point
 * Usage: bun src/relay/main.ts
 */
import { startRelay } from "./index.js"

const port = Number(process.env.PORT) || 8080
const dbPath = process.env.DB_PATH || "./relay.db"

const relay = await startRelay({ port, dbPath })
console.log(`Relay running on ws://localhost:${relay.port}`)
console.log(`Database: ${dbPath}`)
console.log(`Press Ctrl+C to stop`)
