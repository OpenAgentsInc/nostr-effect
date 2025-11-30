/**
 * NipC0Service tests (NIP-C0 Code Snippets)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventServiceLive } from "../services/EventService.js"
import { NipC0Service, NipC0ServiceLive } from "./NipC0Service.js"
import { CodeSnippet as CODE_SNIPPET_KIND } from "../wrappers/kinds.js"

describe("NipC0Service (NIP-C0)", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 32000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.merge(
      RelayLayer,
      Layer.merge(ServiceLayer, NipC0ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))
    )
  }

  test("publish snippet and list by author", async () => {
    const program = Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const svc = yield* NipC0Service
      const crypto = yield* CryptoService
      yield* relaySvc.connect()

      const sk = yield* crypto.generatePrivateKey()
      const author = yield* crypto.getPublicKey(sk)

      const content = "function hi(){return 'nostr'}";
      const res = yield* svc.publishSnippet(
        {
          content,
          language: "JavaScript",
          name: "hi.js",
          extension: "JS",
          description: "Says hi",
          runtime: "node v18.15.0",
          repo: "https://github.com/example/repo",
          licenses: [{ id: "MIT" }, { id: "GPL-3.0-or-later", ref: "https://www.gnu.org/licenses/gpl-3.0.txt" }],
          deps: ["effect@3", "bun@1"],
        },
        sk
      )
      expect(res.accepted).toBe(true)

      const list = yield* svc.listByAuthor({ author, limit: 1, timeoutMs: 800 })
      expect(list.length).toBeGreaterThanOrEqual(1)
      const ev = list[0]!
      expect(ev.kind as number).toBe(CODE_SNIPPET_KIND)
      expect(ev.content).toBe(content)
      // Check tags
      const tags = ev.tags
      expect(tags.find((t) => t[0] === "l")?.[1]).toBe("javascript")
      expect(tags.find((t) => t[0] === "extension")?.[1]).toBe("js")
      expect(tags.find((t) => t[0] === "name")?.[1]).toBe("hi.js")
      expect(tags.find((t) => t[0] === "description")?.[1]).toBe("Says hi")
      expect(tags.find((t) => t[0] === "runtime")?.[1]).toBe("node v18.15.0")
      expect(tags.find((t) => t[0] === "repo")?.[1]).toBe("https://github.com/example/repo")
      expect(tags.filter((t) => t[0] === "license").length).toBeGreaterThanOrEqual(1)
      expect(tags.filter((t) => t[0] === "dep").length).toBe(2)

      yield* relaySvc.disconnect()
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})

