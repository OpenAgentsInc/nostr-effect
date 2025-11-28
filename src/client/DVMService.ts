/**
 * DVMService
 *
 * NIP-90 Data Vending Machine client service.
 * Enables interaction with DVM service providers for on-demand computation.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md
 */
import { Context, Effect, Layer, Stream } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { CryptoService } from "../services/CryptoService.js"
import { RelayError } from "../core/Errors.js"
import {
  type NostrEvent,
  type PrivateKey,
  EventKind,
  Filter,
  Tag,
} from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

/** Input types for job requests */
export type JobInputType = "url" | "event" | "job" | "text"

/** Input for a DVM job request */
export interface JobInput {
  /** The input data */
  readonly data: string
  /** How to interpret the data */
  readonly inputType: JobInputType
  /** Relay hint (for event/job types) */
  readonly relay?: string
  /** Optional marker for how to use this input */
  readonly marker?: string
}

/** Parameter for a DVM job request */
export interface JobParam {
  /** Parameter key */
  readonly key: string
  /** Parameter value */
  readonly value: string
}

/** Job request configuration */
export interface JobRequestConfig {
  /** Job kind (5000-5999) */
  readonly kind: number
  /** Input data for the job */
  readonly inputs?: readonly JobInput[]
  /** Job parameters */
  readonly params?: readonly JobParam[]
  /** Expected output MIME type */
  readonly output?: string
  /** Maximum bid in millisats */
  readonly bid?: number
  /** Relays where providers should publish responses */
  readonly relays?: readonly string[]
  /** Preferred service provider pubkeys */
  readonly preferredProviders?: readonly string[]
}

/** Status values for job feedback */
export type JobFeedbackStatus =
  | "payment-required"
  | "processing"
  | "error"
  | "success"
  | "partial"

/** Parsed job feedback from kind 7000 */
export interface JobFeedback {
  /** The feedback event */
  readonly event: NostrEvent
  /** Feedback status */
  readonly status: JobFeedbackStatus
  /** Extra info about the status */
  readonly extraInfo?: string
  /** Job request event ID this feedback is for */
  readonly jobRequestId: string
  /** Amount requested in millisats */
  readonly amount?: number
  /** Optional bolt11 invoice */
  readonly bolt11?: string
  /** Partial results (in content) */
  readonly content: string
}

/** Parsed job result from kind 6000-6999 */
export interface JobResult {
  /** The result event */
  readonly event: NostrEvent
  /** Result kind (6000-6999) */
  readonly kind: number
  /** Result payload */
  readonly content: string
  /** Job request event ID */
  readonly jobRequestId: string
  /** Amount requested in millisats */
  readonly amount?: number
  /** Optional bolt11 invoice */
  readonly bolt11?: string
  /** Original inputs echoed back */
  readonly inputs: readonly JobInput[]
}

/** Union type for job responses */
export type JobResponse =
  | { readonly type: "feedback"; readonly feedback: JobFeedback }
  | { readonly type: "result"; readonly result: JobResult }

/** Job subscription handle */
export interface JobSubscription {
  /** Stream of job responses (feedback and results) */
  readonly responses: Stream.Stream<JobResponse, RelayError>
  /** Unsubscribe from the job */
  readonly unsubscribe: () => Effect.Effect<void, RelayError>
}

// =============================================================================
// Service Interface
// =============================================================================

export interface DVMService {
  readonly _tag: "DVMService"

  /**
   * Create and publish a job request (kind 5000-5999)
   */
  createJobRequest(
    config: JobRequestConfig,
    privateKey: PrivateKey
  ): Effect.Effect<{ event: NostrEvent; result: PublishResult }, RelayError>

  /**
   * Subscribe to responses for a job request.
   * Returns a stream of feedback (kind 7000) and results (kind 6000-6999).
   */
  subscribeToJob(jobRequestId: string): Effect.Effect<JobSubscription, RelayError>

  /**
   * Cancel a job request by publishing a kind 5 delete event
   */
  cancelJob(
    jobRequestId: string,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, RelayError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const DVMService = Context.GenericTag<DVMService>("DVMService")

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate job request kind is in 5000-5999 range
 */
const validateJobRequestKind = (kind: number): boolean => {
  return kind >= 5000 && kind <= 5999
}

/**
 * Build tags for a job request event
 */
const buildJobRequestTags = (config: JobRequestConfig): typeof Tag.Type[] => {
  const tags: string[][] = []

  // Input tags
  if (config.inputs) {
    for (const input of config.inputs) {
      const iTag = ["i", input.data, input.inputType]
      if (input.relay) {
        iTag.push(input.relay)
        if (input.marker) {
          iTag.push(input.marker)
        }
      } else if (input.marker) {
        iTag.push("") // empty relay
        iTag.push(input.marker)
      }
      tags.push(iTag)
    }
  }

  // Param tags
  if (config.params) {
    for (const param of config.params) {
      tags.push(["param", param.key, param.value])
    }
  }

  // Output tag
  if (config.output) {
    tags.push(["output", config.output])
  }

  // Bid tag
  if (config.bid !== undefined) {
    tags.push(["bid", config.bid.toString()])
  }

  // Relays tag
  if (config.relays && config.relays.length > 0) {
    tags.push(["relays", ...config.relays])
  }

  // Preferred provider tags
  if (config.preferredProviders) {
    for (const provider of config.preferredProviders) {
      tags.push(["p", provider])
    }
  }

  return tags.map((t) => decodeTag(t))
}

/**
 * Parse a job feedback event (kind 7000)
 */
const parseJobFeedback = (event: NostrEvent): JobFeedback | undefined => {
  let status: JobFeedbackStatus | undefined
  let extraInfo: string | undefined
  let jobRequestId: string | undefined
  let amount: number | undefined
  let bolt11: string | undefined

  for (const tag of event.tags) {
    if (tag[0] === "status" && tag[1]) {
      const statusValue = tag[1] as JobFeedbackStatus
      if (
        ["payment-required", "processing", "error", "success", "partial"].includes(
          statusValue
        )
      ) {
        status = statusValue
        extraInfo = tag[2]
      }
    } else if (tag[0] === "e" && tag[1]) {
      jobRequestId = tag[1]
    } else if (tag[0] === "amount" && tag[1]) {
      amount = parseInt(tag[1], 10)
      if (isNaN(amount)) amount = undefined
      bolt11 = tag[2]
    }
  }

  if (!status || !jobRequestId) return undefined

  const result: JobFeedback = {
    event,
    status,
    jobRequestId,
    content: event.content,
  }

  if (extraInfo) {
    ;(result as { extraInfo?: string }).extraInfo = extraInfo
  }
  if (amount !== undefined) {
    ;(result as { amount?: number }).amount = amount
  }
  if (bolt11) {
    ;(result as { bolt11?: string }).bolt11 = bolt11
  }

  return result
}

/**
 * Parse a job result event (kind 6000-6999)
 */
const parseJobResult = (event: NostrEvent): JobResult | undefined => {
  const kind = event.kind as number
  if (kind < 6000 || kind > 6999) return undefined

  let jobRequestId: string | undefined
  let amount: number | undefined
  let bolt11: string | undefined
  const inputs: JobInput[] = []

  for (const tag of event.tags) {
    if (tag[0] === "e" && tag[1]) {
      jobRequestId = tag[1]
    } else if (tag[0] === "amount" && tag[1]) {
      amount = parseInt(tag[1], 10)
      if (isNaN(amount)) amount = undefined
      bolt11 = tag[2]
    } else if (tag[0] === "i" && tag[1] && tag[2]) {
      const input: JobInput = {
        data: tag[1],
        inputType: tag[2] as JobInputType,
      }
      if (tag[3]) {
        ;(input as { relay?: string }).relay = tag[3]
      }
      if (tag[4]) {
        ;(input as { marker?: string }).marker = tag[4]
      }
      inputs.push(input)
    }
  }

  if (!jobRequestId) return undefined

  const result: JobResult = {
    event,
    kind,
    content: event.content,
    jobRequestId,
    inputs,
  }

  if (amount !== undefined) {
    ;(result as { amount?: number }).amount = amount
  }
  if (bolt11) {
    ;(result as { bolt11?: string }).bolt11 = bolt11
  }

  return result
}

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  yield* CryptoService // Required dependency

  const createJobRequest: DVMService["createJobRequest"] = (config, privateKey) =>
    Effect.gen(function* () {
      // Validate kind
      if (!validateJobRequestKind(config.kind)) {
        return yield* Effect.fail(
          new RelayError({
            message: `Invalid job request kind: ${config.kind}. Must be 5000-5999.`,
            relay: relay.url,
          })
        )
      }

      const tags = buildJobRequestTags(config)

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(config.kind),
          content: "",
          tags,
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      return { event, result }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to create job request: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const subscribeToJob: DVMService["subscribeToJob"] = (jobRequestId) =>
    Effect.gen(function* () {
      // Subscribe to feedback (kind 7000) and results (kind 6000-6999)
      // We use a filter for kind 7000 with #e tag and a separate approach for results
      const feedbackFilter = decodeFilter({
        kinds: [decodeKind(7000)],
        "#e": [jobRequestId],
      })

      // For results, we need to subscribe to kinds 6000-6999 with #e tag
      // Since we don't know which specific kind, we'll use a range approach
      // by subscribing to multiple kinds or using a broader filter
      const resultKinds = Array.from({ length: 1000 }, (_, i) => decodeKind(6000 + i))
      const resultFilter = decodeFilter({
        kinds: resultKinds,
        "#e": [jobRequestId],
      })

      const feedbackSub = yield* relay.subscribe([feedbackFilter])
      const resultSub = yield* relay.subscribe([resultFilter])

      // Merge the streams and parse events
      const feedbackStream = feedbackSub.events.pipe(
        Stream.map((event): JobResponse | null => {
          const feedback = parseJobFeedback(event)
          if (feedback) {
            return { type: "feedback", feedback }
          }
          return null
        }),
        Stream.filter((r): r is JobResponse => r !== null),
        Stream.mapError(
          (error) =>
            new RelayError({
              message: `Feedback stream error: ${String(error)}`,
              relay: relay.url,
            })
        )
      )

      const resultStream = resultSub.events.pipe(
        Stream.map((event): JobResponse | null => {
          const result = parseJobResult(event)
          if (result) {
            return { type: "result", result }
          }
          return null
        }),
        Stream.filter((r): r is JobResponse => r !== null),
        Stream.mapError(
          (error) =>
            new RelayError({
              message: `Result stream error: ${String(error)}`,
              relay: relay.url,
            })
        )
      )

      const responses = Stream.merge(feedbackStream, resultStream)

      const unsubscribe = () =>
        Effect.gen(function* () {
          yield* feedbackSub.unsubscribe()
          yield* resultSub.unsubscribe()
        }).pipe(
          Effect.mapError(
            (error) =>
              new RelayError({
                message: `Failed to unsubscribe: ${String(error)}`,
                relay: relay.url,
              })
          )
        )

      return { responses, unsubscribe }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to subscribe to job: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const cancelJob: DVMService["cancelJob"] = (jobRequestId, privateKey) =>
    Effect.gen(function* () {
      // Kind 5 is the deletion event kind per NIP-09
      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(5),
          content: "Job cancelled",
          tags: [decodeTag(["e", jobRequestId])],
        },
        privateKey
      )

      return yield* relay.publish(event)
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to cancel job: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  return {
    _tag: "DVMService" as const,
    createJobRequest,
    subscribeToJob,
    cancelJob,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for DVMService
 * Requires RelayService, EventService, and CryptoService
 */
export const DVMServiceLive = Layer.effect(DVMService, make)
