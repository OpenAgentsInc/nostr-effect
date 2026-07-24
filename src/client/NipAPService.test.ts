/**
 * Tests for NipAPService (NIP-AP: Agent Personas)
 */
import { test, expect, describe, beforeAll, afterAll } from "vite-plus/test"
import { Effect, Layer } from "effect"
import {
  NipAPService,
  NipAPServiceLive,
  PERSONA_KIND,
  INSTANCE_STATE_KIND,
  SLUG_PATTERN,
  MAX_CONTENT_BYTES,
  validateSlug,
  personaAddress,
  buildPersonaContent,
  parsePersonaContent,
  buildInstanceStateContent,
  parseInstanceStateContent,
} from "./NipAPService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/backends/node/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"

describe("NipAPService (NIP-AP) — pure build/parse", () => {
  test("kinds are the NIP-AP addressable kinds", () => {
    expect(PERSONA_KIND).toBe(30175)
    expect(INSTANCE_STATE_KIND).toBe(30177)
  })

  test("slug grammar accepts valid slugs and rejects invalid", async () => {
    const good = ["a", "test-agent", "agent_1", "0", "a".repeat(64)]
    const bad = ["", "-lead", "_lead", "UPPER", "has space", "a".repeat(65), "path/sep", "emoji😀"]

    for (const s of good) {
      expect(SLUG_PATTERN.test(s)).toBe(true)
      const r = await Effect.runPromise(validateSlug(s))
      expect(r).toBe(s)
    }
    for (const s of bad) {
      expect(SLUG_PATTERN.test(s)).toBe(false)
      const exit = await Effect.runPromiseExit(validateSlug(s))
      expect(exit._tag).toBe("Failure")
    }
  })

  test("persona address is 30175:<pubkey>:<slug>", () => {
    expect(personaAddress("abcd" as never, "my-persona")).toBe("30175:abcd:my-persona")
  })

  test("build -> parse round-trip preserves all persona fields", async () => {
    const content = {
      display_name: "Test Agent",
      system_prompt: "You are a test assistant.",
      avatar_url: "https://example.com/avatar.png",
      runtime: "goose",
      model: "claude-opus-4",
      provider: "anthropic",
      name_pool: ["Alpha", "Beta"],
    }
    const json = await Effect.runPromise(buildPersonaContent(content))
    // Field order follows the NIP-AP spec example.
    expect(json).toBe(
      '{"display_name":"Test Agent","system_prompt":"You are a test assistant.","avatar_url":"https://example.com/avatar.png","runtime":"goose","model":"claude-opus-4","provider":"anthropic","name_pool":["Alpha","Beta"]}'
    )
    const parsed = await Effect.runPromise(parsePersonaContent(json))
    expect(parsed).toEqual(content)
  })

  test("minimal persona: display_name only", async () => {
    const json = await Effect.runPromise(buildPersonaContent({ display_name: "Minimal" }))
    expect(json).toBe('{"display_name":"Minimal"}')
    const parsed = await Effect.runPromise(parsePersonaContent(json))
    expect(parsed.display_name).toBe("Minimal")
    expect(parsed.system_prompt).toBeUndefined()
  })

  test("build rejects empty display_name", async () => {
    const exit = await Effect.runPromiseExit(buildPersonaContent({ display_name: "" }))
    expect(exit._tag).toBe("Failure")
  })

  test("build rejects oversized content", async () => {
    const huge = "x".repeat(MAX_CONTENT_BYTES + 1)
    const exit = await Effect.runPromiseExit(buildPersonaContent({ display_name: "big", system_prompt: huge }))
    expect(exit._tag).toBe("Failure")
  })

  test("parse fails on non-JSON and on schema violation", async () => {
    const notJson = await Effect.runPromiseExit(parsePersonaContent("not json{"))
    expect(notJson._tag).toBe("Failure")
    // display_name missing -> schema violation
    const badSchema = await Effect.runPromiseExit(parsePersonaContent('{"runtime":"goose"}'))
    expect(badSchema._tag).toBe("Failure")
  })

  test("parse ignores unknown fields (forward compatibility)", async () => {
    const parsed = await Effect.runPromise(
      parsePersonaContent('{"display_name":"Fwd","future_field":42,"nested":{"a":1}}')
    )
    expect(parsed.display_name).toBe("Fwd")
    expect((parsed as Record<string, unknown>).future_field).toBeUndefined()
  })

  test("instance-state (30177) build -> parse round-trip", async () => {
    const content = {
      name: "Alpha",
      definition_id: "30175:abcd:test-agent",
      respond_to: "owner-only",
      respond_to_allowlist: ["79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"],
      parallelism: 3,
    }
    const json = await Effect.runPromise(buildInstanceStateContent(content))
    const parsed = await Effect.runPromise(parseInstanceStateContent(json))
    expect(parsed).toEqual(content)
  })

  test("instance-state tolerates definition-level fields for definition-less instances", async () => {
    const content = {
      name: "Solo",
      system_prompt: "standalone",
      model: "claude-opus-4",
      provider: "anthropic",
      persona_source_version: 2,
    }
    const json = await Effect.runPromise(buildInstanceStateContent(content))
    const parsed = await Effect.runPromise(parseInstanceStateContent(json))
    expect(parsed).toEqual(content)
  })
})

describe("NipAPService (NIP-AP) — addressable relay semantics", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 22000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        NipAPServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  test("publish persona, read head by (author, slug), parse content", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* NipAPService
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const r = yield* svc.publishPersona(
        { slug: "test-agent", content: { display_name: "Test Agent", system_prompt: "hi", name_pool: ["Alpha"] } },
        sk
      )
      expect(r.accepted).toBe(true)

      const evt = yield* svc.getPersona({ author: pk, slug: "test-agent" })
      expect(evt?.kind as number).toBe(30175)
      expect(evt?.tags.find((t) => t[0] === "d")?.[1]).toBe("test-agent")
      expect(evt?.tags.find((t) => t[0] === "alt")?.[1]).toBe("agent persona definition")

      const parsed = yield* svc.parsePersona(evt as NonNullable<typeof evt>)
      expect(parsed.slug).toBe("test-agent")
      expect(parsed.author).toBe(pk)
      expect(parsed.content.display_name).toBe("Test Agent")
      expect(parsed.content.name_pool).toEqual(["Alpha"])

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("replaceable semantics: newer event replaces same (pubkey, kind, d)", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* NipAPService
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      const slug = "repl-agent"
      const r1 = yield* svc.publishPersona({ slug, content: { display_name: "v1" } }, sk)
      expect(r1.accepted).toBe(true)
      yield* Effect.sleep(1100) // avoid same-second created_at tie
      const r2 = yield* svc.publishPersona({ slug, content: { display_name: "v2" } }, sk)
      expect(r2.accepted).toBe(true)

      const evt = yield* svc.getPersona({ author: pk, slug })
      const parsed = yield* svc.parsePersona(evt as NonNullable<typeof evt>)
      expect(parsed.content.display_name).toBe("v2")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("distinct slugs are independent addresses; listPersonas returns heads", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* NipAPService
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const sk = yield* crypto.generatePrivateKey()
      const pk = yield* crypto.getPublicKey(sk)

      yield* svc.publishPersona({ slug: "persona-a", content: { display_name: "A" } }, sk)
      yield* svc.publishPersona({ slug: "persona-b", content: { display_name: "B" } }, sk)

      const list = yield* svc.listPersonas({ author: pk, limit: 5 })
      expect(list.length).toBeGreaterThanOrEqual(2)
      const slugs = list.map((e) => e.tags.find((t) => t[0] === "d")?.[1]).sort()
      expect(slugs).toContain("persona-a")
      expect(slugs).toContain("persona-b")

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("publishPersona rejects an invalid slug before signing", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* NipAPService
      const crypto = yield* CryptoService
      const sk = yield* crypto.generatePrivateKey()
      return yield* svc.publishPersona({ slug: "Bad Slug", content: { display_name: "x" } }, sk)
    })
    const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(makeTestLayers())))
    expect(exit._tag).toBe("Failure")
  })

  test("instance-state (30177): publish keyed by agent pubkey, read + parse head", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const svc = yield* NipAPService
      const crypto = yield* CryptoService
      yield* relayService.connect()
      const ownerSk = yield* crypto.generatePrivateKey()
      const ownerPk = yield* crypto.getPublicKey(ownerSk)
      const agentSk = yield* crypto.generatePrivateKey()
      const agentPk = yield* crypto.getPublicKey(agentSk)

      const r = yield* svc.publishInstanceState(
        { agentPubkey: agentPk, content: { name: "Alpha", definition_id: "30175:x:test-agent", parallelism: 2 } },
        ownerSk
      )
      expect(r.accepted).toBe(true)

      const evt = yield* svc.getInstanceState({ author: ownerPk, agentPubkey: agentPk })
      expect(evt?.kind as number).toBe(30177)
      const parsed = yield* svc.parseInstanceState(evt as NonNullable<typeof evt>)
      expect(parsed.agentPubkey).toBe(agentPk)
      expect(parsed.content.name).toBe("Alpha")
      expect(parsed.content.parallelism).toBe(2)

      yield* relayService.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
