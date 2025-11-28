/**
 * Cloudflare Worker Entrypoint
 *
 * Routes all requests to the NostrRelayDO Durable Object.
 * Uses a single global DO instance by default.
 */
import { NostrRelayDO, type Env } from "./NostrRelayDO.js"

// Re-export the Durable Object class for Wrangler
export { NostrRelayDO }

export default {
  /**
   * Handle incoming requests by routing to the Durable Object
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    // Get the single global relay instance
    // For sharding, you could use pubkey prefix or other routing logic
    const id = env.NOSTR_RELAY.idFromName("global")
    const stub = env.NOSTR_RELAY.get(id)

    // Forward the request to the DO
    return stub.fetch(request)
  },
}
