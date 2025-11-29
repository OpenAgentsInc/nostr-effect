/**
 * NIP-86 Management API tests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { startTestRelay, type RelayHandle } from "./index.js"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, randomBytes } from "@noble/hashes/utils"
import { schnorr } from "@noble/curves/secp256k1"
import { HTTP_AUTH_KIND, type EventTemplate } from "../core/Nip98.js"

function generateSecretKey(): Uint8Array {
  return randomBytes(32)
}

function getPublicKey(sk: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(sk))
}

function finalizeEvent(event: EventTemplate, sk: Uint8Array) {
  const pubkey = getPublicKey(sk)
  const serialized = JSON.stringify([
    0,
    pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ])
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)))
  const sig = bytesToHex(schnorr.sign(id, sk))
  return { id, pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags as any, content: event.content, sig }
}

const getToken = async (url: string, method: string, payload?: any, withScheme = true) => {
  const sk = generateSecretKey()
  const tags: string[][] = [["u", url], ["method", method.toLowerCase()]]
  if (payload) tags.push(["payload", bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(payload))))])
  const ev: EventTemplate = { kind: HTTP_AUTH_KIND, tags, created_at: Math.round(Date.now() / 1000) as any, content: "" }
  const signed = finalizeEvent(ev, sk)
  const scheme = withScheme ? "Nostr " : ""
  return scheme + btoa(JSON.stringify(signed))
}

describe("NIP-86 Management API", () => {
  let relay: RelayHandle
  let port: number
  let baseUrl: string

  beforeAll(async () => {
    port = 20000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
    baseUrl = `http://localhost:${port}/`
  })

  afterAll(async () => {
    await (await import("effect")).Effect.runPromise(relay.stop())
  })

  const rpc = async (method: string, params: any[] = []) => {
    const body = { method, params }
    const token = await getToken(baseUrl, "post", body, true)
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/nostr+json+rpc",
        Authorization: token,
      },
      body: JSON.stringify(body),
    })
    return res
  }

  test("supportedmethods returns list", async () => {
    const res = await rpc("supportedmethods")
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(Array.isArray(json.result)).toBe(true)
    expect(json.result).toContain("banpubkey")
  })

  test("ban/list banned pubkeys", async () => {
    const pk = "a".repeat(64)
    let res = await rpc("banpubkey", [pk, "spammer"]) ; expect(res.status).toBe(200)
    res = await rpc("listbannedpubkeys") ; const json: any = await res.json()
    expect(json.result.some((x: any) => x.pubkey === pk)).toBe(true)
  })

  test("change relay name updates NIP-11 GET /", async () => {
    const res = await rpc("changerelayname", ["My Relay"]) ; expect(res.status).toBe(200)
    const info = await fetch(baseUrl, { headers: { accept: "application/nostr+json" } })
    expect(info.status).toBe(200)
    const json: any = await info.json()
    expect(json.name).toBe("My Relay")
  })

  test("401 when Authorization missing or invalid", async () => {
    const body = { method: "supportedmethods", params: [] }
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/nostr+json+rpc" },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(401)
  })
})
