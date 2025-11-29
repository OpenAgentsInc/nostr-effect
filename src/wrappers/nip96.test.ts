/**
 * Tests for NIP-96 HTTP File Storage wrapper
 */
import { describe, test, expect, afterEach } from "bun:test"
import { generateSecretKey } from "./pure.js"
import { fetchNip96Info, uploadFile, pollProcessing, deleteFile, signerFromSecretKey } from "./nip96.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("NIP-96 wrapper", () => {
  test("fetchNip96Info reads .well-known JSON", async () => {
    const mockInfo = {
      api_url: "https://files.example/api",
      download_url: "https://cdn.example/dl",
      supported_nips: [60],
      content_types: ["image/jpeg"],
    }
    globalThis.fetch = (async (input: RequestInfo, _init?: RequestInit) => {
      expect(String(input)).toContain("/.well-known/nostr/nip96.json")
      return new Response(JSON.stringify(mockInfo), { status: 200, headers: { "Content-Type": "application/json" } })
    }) as typeof fetch

    const info = await fetchNip96Info("https://files.example")
    expect(info.api_url).toBe("https://files.example/api")
    expect(info.download_url).toBe("https://cdn.example/dl")
  })

  test("uploadFile posts multipart with Authorization header", async () => {
    const sk = generateSecretKey()
    const sign = signerFromSecretKey(sk)
    let sawAuth = false
    let sawForm = false

    globalThis.fetch = (async (_input: RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      const auth = (init?.headers as any)?.Authorization || (init?.headers instanceof Headers ? init.headers.get("Authorization") : undefined)
      expect(typeof auth).toBe("string")
      expect(String(auth).startsWith("Nostr ")).toBe(true)
      sawAuth = true
      // body should be a FormData
      // Bun passes FormData directly
      const body: any = init?.body
      if (body && typeof body.get === "function") {
        const fileField = body.get("file")
        expect(fileField).toBeTruthy()
        sawForm = true
      }
      const resp = {
        status: 201,
        url: "https://cdn.example/media/abc.png",
        nip94_event: { kind: 1063, tags: [["url", "https://cdn.example/media/abc.png"], ["m", "image/png"]], content: "" },
      }
      return new Response(JSON.stringify(resp), { status: 201, headers: { "Content-Type": "application/json" } })
    }) as typeof fetch

    const file = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" })
    const res = await uploadFile("https://files.example/api", file, "a.png", sign, { caption: "hello" })
    expect(res.status === "success" || res.url).toBeTruthy()
    expect(sawAuth && sawForm).toBe(true)
  })

  test("pollProcessing resolves when server returns 201", async () => {
    let calls = 0
    globalThis.fetch = (async (_input: RequestInfo, _init?: RequestInit) => {
      calls++
      if (calls < 2) {
        return new Response(JSON.stringify({ status: "processing", message: "pending", percentage: 10 }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: "success", url: "https://cdn.example/x" }), { status: 201 })
    }) as typeof fetch

    const final = await pollProcessing("https://files.example/process/1", { intervalMs: 10, timeoutMs: 500 })
    expect(final.url).toBe("https://cdn.example/x")
  })

  test("deleteFile sends DELETE with Authorization header", async () => {
    const sk = generateSecretKey()
    const sign = signerFromSecretKey(sk)
    let ok = false
    globalThis.fetch = (async (_input: RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("DELETE")
      const auth = (init?.headers as any)?.Authorization || (init?.headers instanceof Headers ? init.headers.get("Authorization") : undefined)
      expect(String(auth).startsWith("Nostr ")).toBe(true)
      ok = true
      return new Response(null, { status: 200 })
    }) as typeof fetch

    const res = await deleteFile("https://files.example/api", "deadbeef.png", sign)
    expect(res).toBe(true)
    expect(ok).toBe(true)
  })
})
