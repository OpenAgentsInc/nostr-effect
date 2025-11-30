/**
 * SandboxService
 *
 * NIP-SB Remote Sandbox Protocol client service.
 * Enables interaction with sandbox providers for remote code execution.
 *
 * @see https://github.com/OpenAgentsInc/openagents.com/blob/main/docs/mechacoder/NIP-SB.md
 */
import { Context, Effect, Layer, Stream, Schema } from "effect"
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
  SANDBOX_EXECUTE_RESULT_KIND,
  SANDBOX_UPLOAD_RESULT_KIND,
  SANDBOX_DOWNLOAD_RESULT_KIND,
  SANDBOX_CONTROL_RESULT_KIND,
  SANDBOX_STATUS_RESULT_KIND,
  SANDBOX_GIT_CLONE_RESULT_KIND,
  SANDBOX_PORT_FORWARD_RESULT_KIND,
  SANDBOX_FEEDBACK_KIND,
  type SandboxId,
  type SandboxStatus,
  type SandboxControlAction,
  type SandboxCreateConfig,
  type SandboxExecuteOptions,
  type SandboxGitCloneOptions,
  type SandboxUploadOptions,
  type SandboxDownloadOptions,
  type SandboxPortForwardOptions,
  type SandboxCreateResult,
  type SandboxExecuteResult,
  type SandboxUploadResult,
  type SandboxDownloadResult,
  type SandboxControlResult,
  type SandboxStatusResult,
  type SandboxGitCloneResult,
  type SandboxPortForwardResult,
  SandboxCreateResult as SandboxCreateResultSchema,
  SandboxExecuteResult as SandboxExecuteResultSchema,
  SandboxUploadResult as SandboxUploadResultSchema,
  SandboxDownloadResult as SandboxDownloadResultSchema,
  SandboxControlResult as SandboxControlResultSchema,
  SandboxStatusResult as SandboxStatusResultSchema,
  SandboxGitCloneResult as SandboxGitCloneResultSchema,
  SandboxPortForwardResult as SandboxPortForwardResultSchema,
  buildSandboxTag,
  buildParamTag,
  buildEnvTag,
  getResultKind,
} from "../core/NipSB.js"

// =============================================================================
// Types
// =============================================================================

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

/** Sandbox handle returned from creation */
export interface Sandbox {
  readonly id: SandboxId
  readonly status: SandboxStatus
  readonly urls?: {
    readonly ssh?: string
    readonly http?: string
  }
  readonly expiresAt?: number
  readonly event: NostrEvent
}

/** Feedback from sandbox operations */
export interface SandboxFeedback {
  readonly event: NostrEvent
  readonly status: "payment-required" | "creating" | "ready" | "processing" | "streaming" | "error" | "success"
  readonly extraInfo?: string
  readonly requestId: string
  readonly output?: string
}

/** Subscription to sandbox operation responses */
export interface SandboxSubscription<T> {
  /** Stream of feedback and final result */
  readonly responses: Stream.Stream<
    | { readonly type: "feedback"; readonly feedback: SandboxFeedback }
    | { readonly type: "result"; readonly result: T },
    RelayError
  >
  /** Unsubscribe from the operation */
  readonly unsubscribe: () => Effect.Effect<void, RelayError>
}

// =============================================================================
// Service Interface
// =============================================================================

export interface SandboxService {
  readonly _tag: "SandboxService"

  /**
   * Create a new sandbox (kind 5700)
   */
  createSandbox(
    config: SandboxCreateConfig,
    privateKey: PrivateKey
  ): Effect.Effect<
    { event: NostrEvent; result: PublishResult; subscription: SandboxSubscription<Sandbox> },
    RelayError
  >

  /**
   * Execute a command in a sandbox (kind 5701)
   */
  execute(
    sandboxId: SandboxId,
    command: string,
    options: SandboxExecuteOptions | undefined,
    privateKey: PrivateKey
  ): Effect.Effect<
    { event: NostrEvent; result: PublishResult; subscription: SandboxSubscription<SandboxExecuteResult> },
    RelayError
  >

  /**
   * Upload a file to a sandbox (kind 5702)
   */
  uploadFile(
    sandboxId: SandboxId,
    path: string,
    content: string,
    options: SandboxUploadOptions | undefined,
    privateKey: PrivateKey
  ): Effect.Effect<
    { event: NostrEvent; result: PublishResult; subscription: SandboxSubscription<SandboxUploadResult> },
    RelayError
  >

  /**
   * Download a file from a sandbox (kind 5703)
   */
  downloadFile(
    sandboxId: SandboxId,
    path: string,
    options: SandboxDownloadOptions | undefined,
    privateKey: PrivateKey
  ): Effect.Effect<
    { event: NostrEvent; result: PublishResult; subscription: SandboxSubscription<SandboxDownloadResult> },
    RelayError
  >

  /**
   * Control a sandbox (kind 5704) - start, stop, restart, delete, snapshot
   */
  control(
    sandboxId: SandboxId,
    action: SandboxControlAction,
    privateKey: PrivateKey
  ): Effect.Effect<
    { event: NostrEvent; result: PublishResult; subscription: SandboxSubscription<SandboxControlResult> },
    RelayError
  >

  /**
   * Get sandbox status (kind 5705)
   */
  getStatus(
    sandboxId: SandboxId,
    privateKey: PrivateKey
  ): Effect.Effect<
    { event: NostrEvent; result: PublishResult; subscription: SandboxSubscription<SandboxStatusResult> },
    RelayError
  >

  /**
   * Clone a git repository into sandbox (kind 5706)
   */
  gitClone(
    sandboxId: SandboxId,
    url: string,
    options: SandboxGitCloneOptions | undefined,
    privateKey: PrivateKey
  ): Effect.Effect<
    { event: NostrEvent; result: PublishResult; subscription: SandboxSubscription<SandboxGitCloneResult> },
    RelayError
  >

  /**
   * Request port forwarding (kind 5707)
   */
  portForward(
    sandboxId: SandboxId,
    port: number,
    options: SandboxPortForwardOptions | undefined,
    privateKey: PrivateKey
  ): Effect.Effect<
    { event: NostrEvent; result: PublishResult; subscription: SandboxSubscription<SandboxPortForwardResult> },
    RelayError
  >

  /**
   * Subscribe to responses for a sandbox request
   */
  subscribeToRequest<T>(
    requestId: string,
    resultKind: EventKind,
    parseResult: (event: NostrEvent) => T | undefined
  ): Effect.Effect<SandboxSubscription<T>, RelayError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const SandboxService = Context.GenericTag<SandboxService>("SandboxService")

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse sandbox feedback event (kind 7000)
 */
const parseFeedback = (event: NostrEvent, requestId: string): SandboxFeedback | undefined => {
  let status: SandboxFeedback["status"] | undefined
  let extraInfo: string | undefined
  let foundRequestId: string | undefined

  for (const tag of event.tags) {
    if (tag[0] === "status" && tag[1]) {
      const s = tag[1]
      if (["payment-required", "creating", "ready", "processing", "streaming", "error", "success"].includes(s)) {
        status = s as SandboxFeedback["status"]
        extraInfo = tag[2]
      }
    } else if (tag[0] === "e" && tag[1]) {
      foundRequestId = tag[1]
    }
  }

  if (!status || foundRequestId !== requestId) return undefined

  // Parse output from content if present
  let output: string | undefined
  try {
    const parsed = JSON.parse(event.content) as { output?: string }
    output = parsed.output
  } catch {
    // Content might be plain text
    if (event.content) output = event.content
  }

  return {
    event,
    status,
    requestId,
    ...(extraInfo ? { extraInfo } : {}),
    ...(output ? { output } : {}),
  }
}

/**
 * Build tags for sandbox create request
 */
const buildCreateTags = (config: SandboxCreateConfig): typeof Tag.Type[] => {
  const tags: string[][] = []

  if (config.image) tags.push(buildParamTag("image", config.image) as string[])
  if (config.cpu) tags.push(buildParamTag("cpu", String(config.cpu)) as string[])
  if (config.memory) tags.push(buildParamTag("memory", String(config.memory)) as string[])
  if (config.disk) tags.push(buildParamTag("disk", String(config.disk)) as string[])
  if (config.language) tags.push(buildParamTag("language", config.language) as string[])
  if (config.timeout) tags.push(buildParamTag("timeout", String(config.timeout)) as string[])

  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      tags.push(buildEnvTag(key, value) as string[])
    }
  }

  return tags.map((t) => decodeTag(t))
}

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const eventService = yield* EventService
  yield* CryptoService // Required dependency

  const subscribeToRequest = <T>(
    requestId: string,
    resultKind: EventKind,
    parseResult: (event: NostrEvent) => T | undefined
  ): Effect.Effect<SandboxSubscription<T>, RelayError> =>
    Effect.gen(function* () {
      // Subscribe to feedback (kind 7000)
      const feedbackFilter = decodeFilter({
        kinds: [decodeKind(SANDBOX_FEEDBACK_KIND as number)],
        "#e": [requestId],
      })

      // Subscribe to result
      const resultFilter = decodeFilter({
        kinds: [resultKind],
        "#e": [requestId],
      })

      const feedbackSub = yield* relay.subscribe([feedbackFilter])
      const resultSub = yield* relay.subscribe([resultFilter])

      type Response =
        | { readonly type: "feedback"; readonly feedback: SandboxFeedback }
        | { readonly type: "result"; readonly result: T }

      const feedbackStream = feedbackSub.events.pipe(
        Stream.map((event): Response | null => {
          const feedback = parseFeedback(event, requestId)
          if (feedback) return { type: "feedback", feedback }
          return null
        }),
        Stream.filter((r): r is Response => r !== null),
        Stream.mapError(
          (error) =>
            new RelayError({
              message: `Feedback stream error: ${String(error)}`,
              relay: relay.url,
            })
        )
      )

      const resultStream = resultSub.events.pipe(
        Stream.map((event): Response | null => {
          const result = parseResult(event)
          if (result) return { type: "result", result }
          return null
        }),
        Stream.filter((r): r is Response => r !== null),
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
            message: `Failed to subscribe to request: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const createSandbox: SandboxService["createSandbox"] = (config, privateKey) =>
    Effect.gen(function* () {
      const tags = buildCreateTags(config)

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(SANDBOX_CREATE_KIND as number),
          content: "",
          tags,
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      const parseCreateResult = (e: NostrEvent): Sandbox | undefined => {
        try {
          const parsed = Schema.decodeUnknownSync(SandboxCreateResultSchema)(JSON.parse(e.content))
          return {
            id: parsed.id,
            status: parsed.status,
            urls: parsed.urls,
            expiresAt: parsed.expiresAt,
            event: e,
          }
        } catch {
          return undefined
        }
      }

      const subscription = yield* subscribeToRequest(
        event.id,
        decodeKind(SANDBOX_CREATE_RESULT_KIND as number),
        parseCreateResult
      )

      return { event, result, subscription }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to create sandbox: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const execute: SandboxService["execute"] = (sandboxId, command, options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [buildSandboxTag(sandboxId) as string[]]

      if (options?.cwd) tags.push(buildParamTag("cwd", options.cwd) as string[])
      if (options?.timeout) tags.push(buildParamTag("timeout", String(options.timeout)) as string[])
      if (options?.stream) tags.push(buildParamTag("stream", String(options.stream)) as string[])
      if (options?.shell) tags.push(buildParamTag("shell", options.shell) as string[])

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(SANDBOX_EXECUTE_KIND as number),
          content: command,
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      const parseExecResult = (e: NostrEvent): SandboxExecuteResult | undefined => {
        try {
          return Schema.decodeUnknownSync(SandboxExecuteResultSchema)(JSON.parse(e.content))
        } catch {
          return undefined
        }
      }

      const subscription = yield* subscribeToRequest(
        event.id,
        decodeKind(SANDBOX_EXECUTE_RESULT_KIND as number),
        parseExecResult
      )

      return { event, result, subscription }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to execute command: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const uploadFile: SandboxService["uploadFile"] = (sandboxId, path, content, options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [
        buildSandboxTag(sandboxId) as string[],
        buildParamTag("path", path) as string[],
      ]

      if (options?.encoding) tags.push(buildParamTag("encoding", options.encoding) as string[])
      if (options?.permissions) tags.push(buildParamTag("permissions", options.permissions) as string[])

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(SANDBOX_UPLOAD_KIND as number),
          content,
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      const parseUploadResult = (e: NostrEvent): SandboxUploadResult | undefined => {
        try {
          return Schema.decodeUnknownSync(SandboxUploadResultSchema)(JSON.parse(e.content))
        } catch {
          return undefined
        }
      }

      const subscription = yield* subscribeToRequest(
        event.id,
        decodeKind(SANDBOX_UPLOAD_RESULT_KIND as number),
        parseUploadResult
      )

      return { event, result, subscription }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to upload file: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const downloadFile: SandboxService["downloadFile"] = (sandboxId, path, options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [
        buildSandboxTag(sandboxId) as string[],
        buildParamTag("path", path) as string[],
      ]

      if (options?.format) tags.push(buildParamTag("format", options.format) as string[])

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(SANDBOX_DOWNLOAD_KIND as number),
          content: "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      const parseDownloadResult = (e: NostrEvent): SandboxDownloadResult | undefined => {
        try {
          return Schema.decodeUnknownSync(SandboxDownloadResultSchema)(JSON.parse(e.content))
        } catch {
          return undefined
        }
      }

      const subscription = yield* subscribeToRequest(
        event.id,
        decodeKind(SANDBOX_DOWNLOAD_RESULT_KIND as number),
        parseDownloadResult
      )

      return { event, result, subscription }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to download file: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const control: SandboxService["control"] = (sandboxId, action, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [
        buildSandboxTag(sandboxId) as string[],
        buildParamTag("action", action) as string[],
      ]

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(SANDBOX_CONTROL_KIND as number),
          content: "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      const parseControlResult = (e: NostrEvent): SandboxControlResult | undefined => {
        try {
          return Schema.decodeUnknownSync(SandboxControlResultSchema)(JSON.parse(e.content))
        } catch {
          return undefined
        }
      }

      const subscription = yield* subscribeToRequest(
        event.id,
        decodeKind(SANDBOX_CONTROL_RESULT_KIND as number),
        parseControlResult
      )

      return { event, result, subscription }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to control sandbox: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const getStatus: SandboxService["getStatus"] = (sandboxId, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [buildSandboxTag(sandboxId) as string[]]

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(SANDBOX_STATUS_KIND as number),
          content: "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      const parseStatusResult = (e: NostrEvent): SandboxStatusResult | undefined => {
        try {
          return Schema.decodeUnknownSync(SandboxStatusResultSchema)(JSON.parse(e.content))
        } catch {
          return undefined
        }
      }

      const subscription = yield* subscribeToRequest(
        event.id,
        decodeKind(SANDBOX_STATUS_RESULT_KIND as number),
        parseStatusResult
      )

      return { event, result, subscription }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to get sandbox status: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const gitClone: SandboxService["gitClone"] = (sandboxId, url, options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [
        buildSandboxTag(sandboxId) as string[],
        buildParamTag("url", url) as string[],
      ]

      if (options?.branch) tags.push(buildParamTag("branch", options.branch) as string[])
      if (options?.path) tags.push(buildParamTag("path", options.path) as string[])
      if (options?.depth) tags.push(buildParamTag("depth", String(options.depth)) as string[])

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(SANDBOX_GIT_CLONE_KIND as number),
          content: "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      const parseCloneResult = (e: NostrEvent): SandboxGitCloneResult | undefined => {
        try {
          return Schema.decodeUnknownSync(SandboxGitCloneResultSchema)(JSON.parse(e.content))
        } catch {
          return undefined
        }
      }

      const subscription = yield* subscribeToRequest(
        event.id,
        decodeKind(SANDBOX_GIT_CLONE_RESULT_KIND as number),
        parseCloneResult
      )

      return { event, result, subscription }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to clone git repo: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  const portForward: SandboxService["portForward"] = (sandboxId, port, options, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = [
        buildSandboxTag(sandboxId) as string[],
        buildParamTag("port", String(port)) as string[],
      ]

      if (options?.protocol) tags.push(buildParamTag("protocol", options.protocol) as string[])
      if (options?.public !== undefined) tags.push(buildParamTag("public", String(options.public)) as string[])

      const event = yield* eventService.createEvent(
        {
          kind: decodeKind(SANDBOX_PORT_FORWARD_KIND as number),
          content: "",
          tags: tags.map((t) => decodeTag(t)),
        },
        privateKey
      )

      const result = yield* relay.publish(event)

      const parsePortForwardResult = (e: NostrEvent): SandboxPortForwardResult | undefined => {
        try {
          return Schema.decodeUnknownSync(SandboxPortForwardResultSchema)(JSON.parse(e.content))
        } catch {
          return undefined
        }
      }

      const subscription = yield* subscribeToRequest(
        event.id,
        decodeKind(SANDBOX_PORT_FORWARD_RESULT_KIND as number),
        parsePortForwardResult
      )

      return { event, result, subscription }
    }).pipe(
      Effect.mapError(
        (error) =>
          new RelayError({
            message: `Failed to forward port: ${String(error)}`,
            relay: relay.url,
          })
      )
    )

  return {
    _tag: "SandboxService" as const,
    createSandbox,
    execute,
    uploadFile,
    downloadFile,
    control,
    getStatus,
    gitClone,
    portForward,
    subscribeToRequest,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for SandboxService
 * Requires RelayService, EventService, and CryptoService
 */
export const SandboxServiceLive = Layer.effect(SandboxService, make)
