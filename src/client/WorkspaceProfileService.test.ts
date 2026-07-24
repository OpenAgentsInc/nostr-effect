/**
 * WorkspaceProfileService tests (NIP-WP Workspace Profile)
 */
import { describe, test, expect, afterEach } from "vite-plus/test"
import { Effect, Layer } from "effect"
import { makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import {
  WorkspaceProfileService,
  WorkspaceProfileServiceLive,
  WORKSPACE_PROFILE_KIND,
  MAX_ICON_URL_BYTES,
  MAX_ICON_DATA_URL_BYTES,
  isValidIconValue,
  parseIconFromTags,
  validateSetWorkspaceProfileCommand,
  admitSetWorkspaceProfile,
  iconFromRelayInformation,
} from "./WorkspaceProfileService.js"
import { useFetchImplementation, type RelayInformation } from "../core/Nip11.js"
import { SetWorkspaceProfile } from "../wrappers/kinds.js"

const ServiceLayer = Layer.merge(
  CryptoServiceLive,
  EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
)

const makeLayers = (port = 1) => {
  const RelayLayer = makeRelayService({
    url: `ws://localhost:${port}`,
    reconnect: false,
  })
  return Layer.merge(
    RelayLayer,
    Layer.merge(
      ServiceLayer,
      WorkspaceProfileServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
    )
  )
}

const originalFetch = globalThis.fetch

afterEach(() => {
  useFetchImplementation(originalFetch)
})

describe("WorkspaceProfileService pure helpers (NIP-WP)", () => {
  test("kind constant is 9033", () => {
    expect(WORKSPACE_PROFILE_KIND).toBe(9033)
    expect(SetWorkspaceProfile).toBe(9033)
  })

  describe("isValidIconValue", () => {
    test("empty clears", () => {
      expect(isValidIconValue("")).toBe(true)
    })

    test("accepts http and https URLs", () => {
      expect(isValidIconValue("https://cdn.example/icon.webp")).toBe(true)
      expect(isValidIconValue("http://cdn.example/icon.png")).toBe(true)
    })

    test("accepts data:image/* URLs", () => {
      expect(isValidIconValue("data:image/webp;base64,AAAA")).toBe(true)
      expect(isValidIconValue("data:image/png;base64,iVBORw0KGgo=")).toBe(true)
      expect(isValidIconValue("data:image/svg+xml,%3Csvg/%3E")).toBe(true)
    })

    test("rejects whitespace and control characters", () => {
      expect(isValidIconValue("https://x.example/a b.png")).toBe(false)
      expect(isValidIconValue("https://x.example/a\n.png")).toBe(false)
      expect(isValidIconValue(" data:image/png;base64,AA")).toBe(false)
    })

    test("rejects non-image data and dangerous schemes", () => {
      expect(isValidIconValue("data:text/html,<script>")).toBe(false)
      expect(isValidIconValue("data:image/,AAAA")).toBe(false)
      expect(isValidIconValue("javascript:alert(1)")).toBe(false)
      expect(isValidIconValue("ftp://files.example/icon.png")).toBe(false)
    })

    test("enforces size caps", () => {
      const longHttp = "https://x.example/" + "a".repeat(MAX_ICON_URL_BYTES)
      expect(isValidIconValue(longHttp)).toBe(false)
      expect(isValidIconValue("https://x.example/ok")).toBe(true)

      const longData =
        "data:image/png;base64," + "A".repeat(MAX_ICON_DATA_URL_BYTES)
      expect(isValidIconValue(longData)).toBe(false)
      expect(isValidIconValue("data:image/png;base64,AA")).toBe(true)
    })
  })

  describe("parseIconFromTags / validateSetWorkspaceProfileCommand", () => {
    test("absent icon tag clears", () => {
      const r = parseIconFromTags([])
      expect(r).toEqual({ ok: true, icon: null })
    })

    test("empty icon value clears", () => {
      expect(parseIconFromTags([["icon", ""]])).toEqual({ ok: true, icon: null })
      expect(parseIconFromTags([["icon"]])).toEqual({ ok: true, icon: null })
    })

    test("valid icon is returned", () => {
      const url = "https://cdn.example/ws.webp"
      expect(parseIconFromTags([["icon", url]])).toEqual({ ok: true, icon: url })
    })

    test("multiple icon tags rejected", () => {
      const r = parseIconFromTags([
        ["icon", "https://a.example/1.png"],
        ["icon", "https://a.example/2.png"],
      ])
      expect(r.ok).toBe(false)
    })

    test("invalid icon value rejected", () => {
      const r = parseIconFromTags([["icon", "javascript:void(0)"]])
      expect(r.ok).toBe(false)
    })

    test("validate requires kind 9033 and empty content", () => {
      const good = validateSetWorkspaceProfileCommand({
        kind: 9033,
        content: "",
        tags: [["icon", "https://cdn.example/i.png"]],
      })
      expect(good).toEqual({ ok: true, icon: "https://cdn.example/i.png" })

      expect(
        validateSetWorkspaceProfileCommand({
          kind: 1,
          content: "",
          tags: [["icon", ""]],
        }).ok
      ).toBe(false)

      expect(
        validateSetWorkspaceProfileCommand({
          kind: 9033,
          content: "nope",
          tags: [["icon", ""]],
        }).ok
      ).toBe(false)
    })
  })

  describe("admitSetWorkspaceProfile", () => {
    const base = {
      kind: 9033,
      content: "",
      tags: [["icon", "https://cdn.example/i.png"]],
      pubkey: "ab".repeat(32),
    }

    test("admits admin and owner", () => {
      expect(admitSetWorkspaceProfile(base, new Set(["admin"]))).toEqual({
        admit: true,
        icon: "https://cdn.example/i.png",
      })
      expect(admitSetWorkspaceProfile(base, new Set(["owner"]))).toEqual({
        admit: true,
        icon: "https://cdn.example/i.png",
      })
      expect(
        admitSetWorkspaceProfile(
          { ...base, tags: [["icon", ""]] },
          new Set(["admin", "member"])
        )
      ).toEqual({ admit: true, icon: null })
    })

    test("rejects non-admin roles and invalid structure", () => {
      expect(admitSetWorkspaceProfile(base, new Set(["member"])).admit).toBe(false)
      expect(admitSetWorkspaceProfile(base, new Set()).admit).toBe(false)
      expect(
        admitSetWorkspaceProfile(
          { ...base, content: "x" },
          new Set(["admin"])
        ).admit
      ).toBe(false)
    })
  })

  describe("iconFromRelayInformation", () => {
    test("returns non-empty icon or null", () => {
      expect(iconFromRelayInformation({ icon: "https://x/i.png" })).toBe(
        "https://x/i.png"
      )
      expect(iconFromRelayInformation({ icon: "" })).toBe(null)
      expect(iconFromRelayInformation({})).toBe(null)
    })
  })
})

describe("WorkspaceProfileService (NIP-WP)", () => {
  test("buildSetWorkspaceProfile sets icon tag and empty content", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* WorkspaceProfileService
      const crypto = yield* CryptoService
      const sk = yield* crypto.generatePrivateKey()
      const icon = "data:image/webp;base64,AAAA"
      const ev = yield* svc.buildSetWorkspaceProfile({ icon, createdAt: 1_700_000_000 }, sk)
      expect(ev.kind as number).toBe(9033)
      expect(ev.content).toBe("")
      expect(ev.created_at as number).toBe(1_700_000_000)
      expect(ev.tags).toEqual([["icon", icon]] as never)
      expect(validateSetWorkspaceProfileCommand(ev).ok).toBe(true)
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("buildSetWorkspaceProfile clears with empty icon tag", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* WorkspaceProfileService
      const crypto = yield* CryptoService
      const sk = yield* crypto.generatePrivateKey()
      const ev = yield* svc.buildSetWorkspaceProfile({ icon: null }, sk)
      expect(ev.kind as number).toBe(9033)
      expect(ev.content).toBe("")
      expect(ev.tags.find((t) => t[0] === "icon")?.[1]).toBe("")
      expect(validateSetWorkspaceProfileCommand(ev)).toEqual({ ok: true, icon: null })
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("buildSetWorkspaceProfile rejects invalid icon", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* WorkspaceProfileService
      const crypto = yield* CryptoService
      const sk = yield* crypto.generatePrivateKey()
      const result = yield* svc
        .buildSetWorkspaceProfile({ icon: "javascript:alert(1)" }, sk)
        .pipe(Effect.result)
      expect(result._tag).toBe("Failure")
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("getWorkspaceIcon reads NIP-11 icon field", async () => {
    const mockInfo: RelayInformation = {
      name: "Workspace",
      icon: "https://cdn.example/workspace.webp",
      supported_nips: [1, 11],
    }
    const mockFetch = async (_url: string, _init?: RequestInit) =>
      ({
        ok: true,
        json: async () => mockInfo,
      }) as Response
    useFetchImplementation(mockFetch as typeof fetch)

    const program = Effect.gen(function* () {
      const svc = yield* WorkspaceProfileService
      const icon = yield* svc.getWorkspaceIcon("wss://workspace.example")
      expect(icon).toBe("https://cdn.example/workspace.webp")
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("getWorkspaceIcon returns null when NIP-11 has no icon", async () => {
    const mockFetch = async (_url: string, _init?: RequestInit) =>
      ({
        ok: true,
        json: async () => ({ name: "NoIcon", supported_nips: [1, 11] }),
      }) as Response
    useFetchImplementation(mockFetch as typeof fetch)

    const program = Effect.gen(function* () {
      const svc = yield* WorkspaceProfileService
      const icon = yield* svc.getWorkspaceIcon("wss://workspace.example")
      expect(icon).toBe(null)
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
