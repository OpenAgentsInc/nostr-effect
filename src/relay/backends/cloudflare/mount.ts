/**
 * Cloudflare relay mount helper
 *
 * Mount a Nostr relay at a specific path (e.g., "/relay") inside a
 * larger Cloudflare Worker app. Forwards WebSocket upgrades and NIP‑11
 * GET requests to the NostrRelayDO Durable Object.
 */
import type { Env as RelayEnv } from "./NostrRelayDO.js"

export interface MountOptions {
  /** Path to mount the relay (default: "/relay") */
  mountPath?: string
  /** Instance name for DO idFromName (default: "global") */
  instanceName?: string
}

/**
 * Handle a request for a relay mount path.
 * Returns a Response when the mount matches; otherwise returns null so
 * callers can fall through to other handlers.
 */
export async function handleRelayRequest(
  request: Request,
  env: RelayEnv,
  opts: MountOptions = {}
): Promise<Response | null> {
  const mountPath = opts.mountPath ?? "/relay"
  const instanceName = opts.instanceName ?? "global"

  const url = new URL(request.url)
  if (url.pathname !== mountPath) return null

  const upgrade = request.headers.get("upgrade")
  const id = env.NOSTR_RELAY.idFromName(instanceName)
  const stub = env.NOSTR_RELAY.get(id)

  if (upgrade === "websocket") {
    // Forward WebSocket upgrade directly
    return stub.fetch(request)
  }

  // For HTTP GET, forward to DO root ("/") to serve NIP‑11 relay info
  if (request.method === "GET") {
    const doUrl = new URL("http://do/")
    return stub.fetch(new Request(doUrl, { method: "GET", headers: request.headers }))
  }

  return new Response("Expected WebSocket upgrade or GET for NIP-11", { status: 400 })
}

