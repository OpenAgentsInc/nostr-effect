/**
 * Tests for SandboxService (NIP-SB)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Schema } from "@effect/schema"
import {
  SandboxService,
  SandboxServiceLive,
  type Sandbox,
  type SandboxFeedback,
} from "./SandboxService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { EventKind, Tag } from "../core/Schema.js"
import {
  SANDBOX_CREATE_KIND,
  SANDBOX_EXECUTE_KIND,
  SANDBOX_UPLOAD_KIND,
  SANDBOX_DOWNLOAD_KIND,
  SANDBOX_CONTROL_KIND,
  SANDBOX_STATUS_KIND,
  SANDBOX_GIT_CLONE_KIND,
  SANDBOX_PORT_FORWARD_KIND,
  SANDBOX_CREATE_RESULT_KIND,
  SANDBOX_FEEDBACK_KIND,
  type SandboxId,
} from "../core/NipSB.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

describe("SandboxService", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 17000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({
      url: `ws://localhost:${port}`,
      reconnect: false,
    })

    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )

    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        SandboxServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  describe("createSandbox", () => {
    test("creates and publishes a sandbox creation request with config", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const { event, result, subscription } = yield* sandboxService.createSandbox(
          {
            image: "ubuntu:22.04",
            language: "typescript",
            cpu: 2,
            memory: 4096,
            disk: 10,
            timeout: 3600,
            env: {
              NODE_ENV: "development",
              DEBUG: "true",
            },
          },
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_CREATE_KIND)

        // Check param tags
        const paramTags = event.tags.filter((t) => t[0] === "param")
        const imageParam = paramTags.find((t) => t[1] === "image")
        expect(imageParam?.[2]).toBe("ubuntu:22.04")

        const languageParam = paramTags.find((t) => t[1] === "language")
        expect(languageParam?.[2]).toBe("typescript")

        const cpuParam = paramTags.find((t) => t[1] === "cpu")
        expect(cpuParam?.[2]).toBe("2")

        const memoryParam = paramTags.find((t) => t[1] === "memory")
        expect(memoryParam?.[2]).toBe("4096")

        // Check env tags
        const envTags = event.tags.filter((t) => t[0] === "env")
        expect(envTags.length).toBe(2)

        const nodeEnvTag = envTags.find((t) => t[1] === "NODE_ENV")
        expect(nodeEnvTag?.[2]).toBe("development")

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("creates minimal sandbox request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const { event, result, subscription } = yield* sandboxService.createSandbox(
          {},
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_CREATE_KIND)
        expect(event.tags.length).toBe(0)

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("execute", () => {
    test("creates and publishes an execute command request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const sandboxId = "sb_test123" as unknown as SandboxId

        const { event, result, subscription } = yield* sandboxService.execute(
          sandboxId,
          "npm install && npm test",
          {
            cwd: "/app",
            timeout: 300,
            stream: true,
            shell: "/bin/bash",
          },
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_EXECUTE_KIND)
        expect(event.content).toBe("npm install && npm test")

        // Check sandbox tag
        const sandboxTag = event.tags.find((t) => t[0] === "sandbox")
        expect(sandboxTag?.[1]).toBe(sandboxId)

        // Check param tags
        const paramTags = event.tags.filter((t) => t[0] === "param")
        const cwdParam = paramTags.find((t) => t[1] === "cwd")
        expect(cwdParam?.[2]).toBe("/app")

        const timeoutParam = paramTags.find((t) => t[1] === "timeout")
        expect(timeoutParam?.[2]).toBe("300")

        const streamParam = paramTags.find((t) => t[1] === "stream")
        expect(streamParam?.[2]).toBe("true")

        const shellParam = paramTags.find((t) => t[1] === "shell")
        expect(shellParam?.[2]).toBe("/bin/bash")

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("creates minimal execute request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const minimalSandboxId = "sb_test456" as unknown as SandboxId
        const { event, result, subscription } = yield* sandboxService.execute(
          minimalSandboxId,
          "echo hello",
          undefined,
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_EXECUTE_KIND)
        expect(event.content).toBe("echo hello")

        // Only sandbox tag should be present
        expect(event.tags.length).toBe(1)
        expect(event.tags[0]?.[0]).toBe("sandbox")

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("uploadFile", () => {
    test("creates and publishes an upload file request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const fileContent = "console.log('Hello World')"

        const uploadId = "sb_upload123" as unknown as SandboxId
        const { event, result, subscription } = yield* sandboxService.uploadFile(
          uploadId,
          "/app/index.js",
          fileContent,
          {
            encoding: "utf8",
            permissions: "755",
          },
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_UPLOAD_KIND)
        expect(event.content).toBe(fileContent)

        // Check sandbox tag
        const sandboxTag = event.tags.find((t) => t[0] === "sandbox")
        expect(sandboxTag?.[1]).toBe(uploadId)

        // Check param tags
        const paramTags = event.tags.filter((t) => t[0] === "param")
        const pathParam = paramTags.find((t) => t[1] === "path")
        expect(pathParam?.[2]).toBe("/app/index.js")

        const encodingParam = paramTags.find((t) => t[1] === "encoding")
        expect(encodingParam?.[2]).toBe("utf8")

        const permissionsParam = paramTags.find((t) => t[1] === "permissions")
        expect(permissionsParam?.[2]).toBe("755")

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("downloadFile", () => {
    test("creates and publishes a download file request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const dlId = "sb_download123" as unknown as SandboxId
        const { event, result, subscription } = yield* sandboxService.downloadFile(
          dlId,
          "/app/output.log",
          { format: "base64" },
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_DOWNLOAD_KIND)

        // Check sandbox tag
        const sandboxTag = event.tags.find((t) => t[0] === "sandbox")
        expect(sandboxTag?.[1]).toBe(dlId)

        // Check param tags
        const paramTags = event.tags.filter((t) => t[0] === "param")
        const pathParam = paramTags.find((t) => t[1] === "path")
        expect(pathParam?.[2]).toBe("/app/output.log")

        const formatParam = paramTags.find((t) => t[1] === "format")
        expect(formatParam?.[2]).toBe("base64")

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("control", () => {
    test("creates and publishes a control request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const ctrlId = "sb_control123" as unknown as SandboxId
        const { event, result, subscription } = yield* sandboxService.control(
          ctrlId,
          "restart",
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_CONTROL_KIND)

        // Check sandbox tag
        const sandboxTag = event.tags.find((t) => t[0] === "sandbox")
        expect(sandboxTag?.[1]).toBe(ctrlId)

        // Check action tag
        const paramTags = event.tags.filter((t) => t[0] === "param")
        const actionParam = paramTags.find((t) => t[1] === "action")
        expect(actionParam?.[2]).toBe("restart")

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("supports all control actions", async () => {
      const actions = ["start", "stop", "restart", "delete", "snapshot"] as const

      for (const action of actions) {
        const program = Effect.gen(function* () {
          const relayService = yield* RelayService
          const sandboxService = yield* SandboxService
          const crypto = yield* CryptoService

          yield* relayService.connect()

          const privateKey = yield* crypto.generatePrivateKey()

          const actId = "sb_action_test" as unknown as SandboxId
          const { event, result, subscription } = yield* sandboxService.control(
            actId,
            action,
            privateKey
          )

          expect(result.accepted).toBe(true)
          expect(event.kind as number).toBe(SANDBOX_CONTROL_KIND)

          const paramTags = event.tags.filter((t) => t[0] === "param")
          const actionParam = paramTags.find((t) => t[1] === "action")
          expect(actionParam?.[2]).toBe(action)

          yield* subscription.unsubscribe()
          yield* relayService.disconnect()
        })

        await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
      }
    })
  })

  describe("getStatus", () => {
    test("creates and publishes a status request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const statusId = "sb_status123" as unknown as SandboxId
        const { event, result, subscription } = yield* sandboxService.getStatus(
          statusId,
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_STATUS_KIND)

        // Check sandbox tag
        const sandboxTag = event.tags.find((t) => t[0] === "sandbox")
        expect(sandboxTag?.[1]).toBe(statusId)

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("gitClone", () => {
    test("creates and publishes a git clone request with options", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const gitId = "sb_git123" as unknown as SandboxId
        const { event, result, subscription } = yield* sandboxService.gitClone(
          gitId,
          "https://github.com/example/repo.git",
          {
            branch: "develop",
            path: "/app/project",
            depth: 1,
          },
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_GIT_CLONE_KIND)

        // Check sandbox tag
        const sandboxTag = event.tags.find((t) => t[0] === "sandbox")
        expect(sandboxTag?.[1]).toBe(gitId)

        // Check param tags
        const paramTags = event.tags.filter((t) => t[0] === "param")

        const urlParam = paramTags.find((t) => t[1] === "url")
        expect(urlParam?.[2]).toBe("https://github.com/example/repo.git")

        const branchParam = paramTags.find((t) => t[1] === "branch")
        expect(branchParam?.[2]).toBe("develop")

        const pathParam = paramTags.find((t) => t[1] === "path")
        expect(pathParam?.[2]).toBe("/app/project")

        const depthParam = paramTags.find((t) => t[1] === "depth")
        expect(depthParam?.[2]).toBe("1")

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("creates minimal git clone request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const gitId2 = "sb_git456" as unknown as SandboxId
        const { event, result, subscription } = yield* sandboxService.gitClone(
          gitId2,
          "https://github.com/example/simple.git",
          undefined,
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_GIT_CLONE_KIND)

        // Only sandbox and url tags should be present
        expect(event.tags.length).toBe(2)

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("portForward", () => {
    test("creates and publishes a port forward request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const pfId = "sb_port123" as unknown as SandboxId
        const { event, result, subscription } = yield* sandboxService.portForward(
          pfId,
          3000,
          {
            protocol: "tcp",
            public: true,
          },
          privateKey
        )

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(SANDBOX_PORT_FORWARD_KIND)

        // Check sandbox tag
        const sandboxTag = event.tags.find((t) => t[0] === "sandbox")
        expect(sandboxTag?.[1]).toBe(pfId)

        // Check param tags
        const paramTags = event.tags.filter((t) => t[0] === "param")

        const portParam = paramTags.find((t) => t[1] === "port")
        expect(portParam?.[2]).toBe("3000")

        const protocolParam = paramTags.find((t) => t[1] === "protocol")
        expect(protocolParam?.[2]).toBe("tcp")

        const publicParam = paramTags.find((t) => t[1] === "public")
        expect(publicParam?.[2]).toBe("true")

        yield* subscription.unsubscribe()
        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("subscribeToRequest", () => {
    test("receives feedback and results for a sandbox request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService
        const eventService = yield* EventService

        yield* relayService.connect()

        const customerKey = yield* crypto.generatePrivateKey()
        const providerKey = yield* crypto.generatePrivateKey()
        const customerPubkey = yield* crypto.getPublicKey(customerKey)

        // Create a sandbox request
        const { event: requestEvent, subscription } = yield* sandboxService.createSandbox(
          { language: "typescript" },
          customerKey
        )

        yield* Effect.sleep(300)

        // Simulate provider sending feedback
        const feedbackEvent = yield* eventService.createEvent(
          {
            kind: decodeKind(SANDBOX_FEEDBACK_KIND as number),
            content: JSON.stringify({ output: "Provisioning sandbox..." }),
            tags: [
              decodeTag(["status", "creating", "Initializing container"]),
              decodeTag(["e", requestEvent.id]),
              decodeTag(["p", customerPubkey]),
            ],
          },
          providerKey
        )

        yield* relayService.publish(feedbackEvent)

        yield* Effect.sleep(300)

        // Simulate provider sending result
        const resultContent = JSON.stringify({
          id: "sb_new123",
          status: "running",
          urls: {
            ssh: "ssh://user@sandbox.example.com",
            http: "https://sandbox.example.com",
          },
          expiresAt: Date.now() + 3600000,
        })

        const resultEvent = yield* eventService.createEvent(
          {
            kind: decodeKind(SANDBOX_CREATE_RESULT_KIND as number),
            content: resultContent,
            tags: [
              decodeTag(["e", requestEvent.id]),
              decodeTag(["p", customerPubkey]),
            ],
          },
          providerKey
        )

        yield* relayService.publish(resultEvent)

        yield* Effect.sleep(300)

        // Collect responses
        type Response =
          | { readonly type: "feedback"; readonly feedback: SandboxFeedback }
          | { readonly type: "result"; readonly result: Sandbox }

        const responses: Response[] = []
        const collectEffect = subscription.responses.pipe(
          Stream.takeUntil(() => false),
          Stream.runForEach((response) =>
            Effect.sync(() => {
              responses.push(response)
            })
          )
        )

        yield* Effect.race(collectEffect, Effect.sleep(1000))
        yield* subscription.unsubscribe()

        // Check we received feedback
        const feedbackResponses = responses.filter((r) => r.type === "feedback")
        expect(feedbackResponses.length).toBeGreaterThanOrEqual(1)

        const feedback = feedbackResponses[0]
        if (feedback?.type === "feedback") {
          expect(feedback.feedback.status).toBe("creating")
          expect(feedback.feedback.extraInfo).toBe("Initializing container")
          expect(feedback.feedback.requestId).toBe(requestEvent.id)
        }

        // Check we received result
        const resultResponses = responses.filter((r) => r.type === "result")
        expect(resultResponses.length).toBeGreaterThanOrEqual(1)

        const result = resultResponses[0]
        if (result?.type === "result") {
          expect(String(result.result.id)).toBe("sb_new123")
          expect(result.result.status).toBe("running")
          expect(result.result.urls?.ssh).toBe("ssh://user@sandbox.example.com")
        }

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("handles payment-required feedback", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService
        const eventService = yield* EventService

        yield* relayService.connect()

        const customerKey = yield* crypto.generatePrivateKey()
        const providerKey = yield* crypto.generatePrivateKey()
        const customerPubkey = yield* crypto.getPublicKey(customerKey)

        // Create an execute request
        const execId = "sb_test" as unknown as SandboxId
        const { event: requestEvent, subscription } = yield* sandboxService.execute(
          execId,
          "bun test",
          undefined,
          customerKey
        )

        yield* Effect.sleep(300)

        // Provider sends payment-required
        const feedbackEvent = yield* eventService.createEvent(
          {
            kind: decodeKind(SANDBOX_FEEDBACK_KIND as number),
            content: "",
            tags: [
              decodeTag(["status", "payment-required"]),
              decodeTag(["e", requestEvent.id]),
              decodeTag(["p", customerPubkey]),
              decodeTag(["amount", "5000", "lnbc5000..."]),
            ],
          },
          providerKey
        )

        yield* relayService.publish(feedbackEvent)

        yield* Effect.sleep(500)

        type Response =
          | { readonly type: "feedback"; readonly feedback: SandboxFeedback }
          | { readonly type: "result"; readonly result: unknown }

        const responses: Response[] = []
        const collectEffect = subscription.responses.pipe(
          Stream.runForEach((response) =>
            Effect.sync(() => {
              responses.push(response)
            })
          )
        )

        yield* Effect.race(collectEffect, Effect.sleep(500))
        yield* subscription.unsubscribe()

        const paymentFeedback = responses.find(
          (r) => r.type === "feedback" && r.feedback.status === "payment-required"
        )

        expect(paymentFeedback).toBeDefined()

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("handles streaming output feedback", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const sandboxService = yield* SandboxService
        const crypto = yield* CryptoService
        const eventService = yield* EventService

        yield* relayService.connect()

        const customerKey = yield* crypto.generatePrivateKey()
        const providerKey = yield* crypto.generatePrivateKey()
        const customerPubkey = yield* crypto.getPublicKey(customerKey)

        // Create an execute request with streaming
        const streamId = "sb_stream" as unknown as SandboxId
        const { event: requestEvent, subscription } = yield* sandboxService.execute(
          streamId,
          "npm test",
          { stream: true },
          customerKey
        )

        yield* Effect.sleep(300)

        // Provider sends streaming feedback
        const streamingOutputs = [
          "Running tests...",
          "Test 1 passed",
          "Test 2 passed",
          "All tests complete!",
        ]

        for (const output of streamingOutputs) {
          const feedbackEvent = yield* eventService.createEvent(
            {
              kind: decodeKind(SANDBOX_FEEDBACK_KIND as number),
              content: JSON.stringify({ output }),
              tags: [
                decodeTag(["status", "streaming"]),
                decodeTag(["e", requestEvent.id]),
                decodeTag(["p", customerPubkey]),
              ],
            },
            providerKey
          )

          yield* relayService.publish(feedbackEvent)
          yield* Effect.sleep(100)
        }

        yield* Effect.sleep(300)

        type Response =
          | { readonly type: "feedback"; readonly feedback: SandboxFeedback }
          | { readonly type: "result"; readonly result: unknown }

        const responses: Response[] = []
        const collectEffect = subscription.responses.pipe(
          Stream.runForEach((response) =>
            Effect.sync(() => {
              responses.push(response)
            })
          )
        )

        yield* Effect.race(collectEffect, Effect.sleep(1000))
        yield* subscription.unsubscribe()

        const streamingFeedbacks = responses.filter(
          (r) => r.type === "feedback" && r.feedback.status === "streaming"
        )

        expect(streamingFeedbacks.length).toBeGreaterThanOrEqual(1)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })
})
