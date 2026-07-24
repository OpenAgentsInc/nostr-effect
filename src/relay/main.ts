/**
 * Standalone relay entry point (Node 24)
 * Usage: node --import tsx src/relay/main.ts
 *    or: pnpm exec tsx src/relay/main.ts
 */
import { startRelay } from "./backends/node/index.js"

const port = Number(process.env.PORT) || 8080

const relay = await startRelay({ port })
console.log(`Relay running on ws://localhost:${relay.port}`)
console.log(`Press Ctrl+C to stop`)
