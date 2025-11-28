/**
 * Tests for DVMService (NIP-90)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Schema } from "@effect/schema"
import {
  DVMService,
  DVMServiceLive,
  type JobRequestConfig,
  type JobResponse,
} from "./DVMService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { EventKind, Tag } from "../core/Schema.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

describe("DVMService", () => {
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
        DVMServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer))
      )
    )
  }

  describe("createJobRequest", () => {
    test("creates and publishes a job request with inputs", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const config: JobRequestConfig = {
          kind: 5000, // Generic job request
          inputs: [
            { data: "Hello world", inputType: "text" },
            { data: "https://example.com/data.json", inputType: "url" },
          ],
          params: [
            { key: "model", value: "gpt-4" },
            { key: "max_tokens", value: "100" },
          ],
          output: "text/plain",
          bid: 1000,
          relays: ["wss://relay.example.com"],
        }

        const { event, result } = yield* dvmService.createJobRequest(config, privateKey)

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(5000)

        // Check input tags
        const iTags = event.tags.filter((t) => t[0] === "i")
        expect(iTags.length).toBe(2)
        expect(iTags[0]?.[1]).toBe("Hello world")
        expect(iTags[0]?.[2]).toBe("text")
        expect(iTags[1]?.[1]).toBe("https://example.com/data.json")
        expect(iTags[1]?.[2]).toBe("url")

        // Check param tags
        const paramTags = event.tags.filter((t) => t[0] === "param")
        expect(paramTags.length).toBe(2)
        expect(paramTags[0]?.[1]).toBe("model")
        expect(paramTags[0]?.[2]).toBe("gpt-4")

        // Check output tag
        const outputTag = event.tags.find((t) => t[0] === "output")
        expect(outputTag?.[1]).toBe("text/plain")

        // Check bid tag
        const bidTag = event.tags.find((t) => t[0] === "bid")
        expect(bidTag?.[1]).toBe("1000")

        // Check relays tag
        const relaysTag = event.tags.find((t) => t[0] === "relays")
        expect(relaysTag?.[1]).toBe("wss://relay.example.com")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("creates job request with preferred providers", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()
        const provider1 = yield* crypto.generatePrivateKey()
        const provider1Pubkey = yield* crypto.getPublicKey(provider1)
        const provider2 = yield* crypto.generatePrivateKey()
        const provider2Pubkey = yield* crypto.getPublicKey(provider2)

        const config: JobRequestConfig = {
          kind: 5001, // Translation job
          inputs: [{ data: "Translate this text", inputType: "text" }],
          preferredProviders: [provider1Pubkey, provider2Pubkey],
        }

        const { event, result } = yield* dvmService.createJobRequest(config, privateKey)

        expect(result.accepted).toBe(true)

        // Check p tags for preferred providers
        const pTags = event.tags.filter((t) => t[0] === "p")
        expect(pTags.length).toBe(2)
        expect(pTags[0]?.[1]).toBe(provider1Pubkey)
        expect(pTags[1]?.[1]).toBe(provider2Pubkey)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("rejects invalid job request kind", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const config: JobRequestConfig = {
          kind: 6000, // Invalid - this is a result kind
          inputs: [{ data: "test", inputType: "text" }],
        }

        const result = yield* dvmService
          .createJobRequest(config, privateKey)
          .pipe(Effect.either)

        expect(result._tag).toBe("Left")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("creates minimal job request", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const config: JobRequestConfig = {
          kind: 5002,
        }

        const { event, result } = yield* dvmService.createJobRequest(config, privateKey)

        expect(result.accepted).toBe(true)
        expect(event.kind as number).toBe(5002)
        expect(event.tags.length).toBe(0)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("subscribeToJob", () => {
    test("subscribes to job feedback and results", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService
        const eventService = yield* EventService

        yield* relayService.connect()

        const customerKey = yield* crypto.generatePrivateKey()
        const providerKey = yield* crypto.generatePrivateKey()
        const customerPubkey = yield* crypto.getPublicKey(customerKey)

        // Create a job request
        const config: JobRequestConfig = {
          kind: 5003,
          inputs: [{ data: "Process this", inputType: "text" }],
        }

        const { event: jobRequest } = yield* dvmService.createJobRequest(
          config,
          customerKey
        )

        yield* Effect.sleep(300)

        // Subscribe to job responses
        const subscription = yield* dvmService.subscribeToJob(jobRequest.id)

        // Simulate provider sending feedback
        const feedbackEvent = yield* eventService.createEvent(
          {
            kind: decodeKind(7000),
            content: "",
            tags: [
              decodeTag(["status", "processing", "Starting work"]),
              decodeTag(["e", jobRequest.id]),
              decodeTag(["p", customerPubkey]),
            ],
          },
          providerKey
        )

        yield* relayService.publish(feedbackEvent)

        yield* Effect.sleep(300)

        // Simulate provider sending result
        const resultEvent = yield* eventService.createEvent(
          {
            kind: decodeKind(6003),
            content: "Job completed successfully",
            tags: [
              decodeTag(["e", jobRequest.id]),
              decodeTag(["p", customerPubkey]),
              decodeTag(["amount", "500", "lnbc..."]),
            ],
          },
          providerKey
        )

        yield* relayService.publish(resultEvent)

        yield* Effect.sleep(300)

        // Collect responses
        const responses: JobResponse[] = []
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

        // Check we received both feedback and result
        const feedbackResponses = responses.filter((r) => r.type === "feedback")
        const resultResponses = responses.filter((r) => r.type === "result")

        expect(feedbackResponses.length).toBeGreaterThanOrEqual(1)
        expect(resultResponses.length).toBeGreaterThanOrEqual(1)

        // Check feedback content
        const feedback = feedbackResponses[0]
        if (feedback?.type === "feedback") {
          expect(feedback.feedback.status).toBe("processing")
          expect(feedback.feedback.extraInfo).toBe("Starting work")
          expect(feedback.feedback.jobRequestId).toBe(jobRequest.id)
        }

        // Check result content
        const result = resultResponses[0]
        if (result?.type === "result") {
          expect(result.result.content).toBe("Job completed successfully")
          expect(result.result.jobRequestId).toBe(jobRequest.id)
          expect(result.result.amount).toBe(500)
          expect(result.result.bolt11).toBe("lnbc...")
        }

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("handles payment-required feedback", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService
        const eventService = yield* EventService

        yield* relayService.connect()

        const customerKey = yield* crypto.generatePrivateKey()
        const providerKey = yield* crypto.generatePrivateKey()
        const customerPubkey = yield* crypto.getPublicKey(customerKey)

        // Create a job request
        const { event: jobRequest } = yield* dvmService.createJobRequest(
          { kind: 5004, inputs: [{ data: "test", inputType: "text" }] },
          customerKey
        )

        yield* Effect.sleep(300)

        // Subscribe
        const subscription = yield* dvmService.subscribeToJob(jobRequest.id)

        // Provider sends payment-required
        const feedbackEvent = yield* eventService.createEvent(
          {
            kind: decodeKind(7000),
            content: "",
            tags: [
              decodeTag(["status", "payment-required"]),
              decodeTag(["e", jobRequest.id]),
              decodeTag(["p", customerPubkey]),
              decodeTag(["amount", "1000", "lnbc1000..."]),
            ],
          },
          providerKey
        )

        yield* relayService.publish(feedbackEvent)

        yield* Effect.sleep(500)

        const responses: JobResponse[] = []
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
        if (paymentFeedback?.type === "feedback") {
          expect(paymentFeedback.feedback.amount).toBe(1000)
          expect(paymentFeedback.feedback.bolt11).toBe("lnbc1000...")
        }

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("cancelJob", () => {
    test("publishes kind 5 delete event for job cancellation", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        // Create a job
        const { event: jobRequest } = yield* dvmService.createJobRequest(
          { kind: 5005, inputs: [{ data: "cancel me", inputType: "text" }] },
          privateKey
        )

        yield* Effect.sleep(300)

        // Cancel the job
        const cancelResult = yield* dvmService.cancelJob(jobRequest.id, privateKey)

        expect(cancelResult.accepted).toBe(true)

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })

  describe("input types", () => {
    test("handles event input type with relay hint", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        const config: JobRequestConfig = {
          kind: 5006,
          inputs: [
            {
              data: "abc123eventid",
              inputType: "event",
              relay: "wss://relay.example.com",
              marker: "source",
            },
          ],
        }

        const { event, result } = yield* dvmService.createJobRequest(config, privateKey)

        expect(result.accepted).toBe(true)

        const iTag = event.tags.find((t) => t[0] === "i")
        expect(iTag?.[1]).toBe("abc123eventid")
        expect(iTag?.[2]).toBe("event")
        expect(iTag?.[3]).toBe("wss://relay.example.com")
        expect(iTag?.[4]).toBe("source")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })

    test("handles job chaining input type", async () => {
      const program = Effect.gen(function* () {
        const relayService = yield* RelayService
        const dvmService = yield* DVMService
        const crypto = yield* CryptoService

        yield* relayService.connect()

        const privateKey = yield* crypto.generatePrivateKey()

        // First job
        const { event: firstJob } = yield* dvmService.createJobRequest(
          { kind: 5007, inputs: [{ data: "initial data", inputType: "text" }] },
          privateKey
        )

        // Second job that chains from first
        const config: JobRequestConfig = {
          kind: 5008,
          inputs: [
            {
              data: firstJob.id,
              inputType: "job",
              relay: "wss://relay.example.com",
            },
          ],
        }

        const { event, result } = yield* dvmService.createJobRequest(config, privateKey)

        expect(result.accepted).toBe(true)

        const iTag = event.tags.find((t) => t[0] === "i")
        expect(iTag?.[1]).toBe(firstJob.id)
        expect(iTag?.[2]).toBe("job")

        yield* relayService.disconnect()
      })

      await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
    })
  })
})
