/**
 * NIP-90: Data Vending Machines
 *
 * Protocol-only helpers for job request, result, and feedback events.
 */
import { Schema } from "effect"
import {
  EventKind,
  NostrEvent,
  PublicKey,
  Tag,
  UnixTimestamp,
  type EventId,
  type UnsignedEvent,
} from "./Schema.js"

export const JOB_REQUEST_KIND_MIN = 5000
export const JOB_REQUEST_KIND_MAX = 5999
export const JOB_RESULT_KIND_MIN = 6000
export const JOB_RESULT_KIND_MAX = 6999
export const KIND_JOB_FEEDBACK = 7000

export const KIND_JOB_TEXT_EXTRACTION = 5000
export const KIND_JOB_SUMMARIZATION = 5001
export const KIND_JOB_TRANSLATION = 5002
export const KIND_JOB_TEXT_GENERATION = 5050
export const KIND_JOB_IMAGE_GENERATION = 5100
export const KIND_JOB_SPEECH_TO_TEXT = 5250

export const KIND_JOB_SANDBOX_RUN = 5930
export const KIND_JOB_REPO_INDEX = 5931
export const KIND_JOB_PATCH_GEN = 5932
export const KIND_JOB_CODE_REVIEW = 5933
export const KIND_JOB_RLM_SUBQUERY = 5940
export const KIND_RESULT_RLM_SUBQUERY = 6940

export const isJobRequestKind = (kind: number): boolean =>
  Number.isInteger(kind) && kind >= JOB_REQUEST_KIND_MIN && kind <= JOB_REQUEST_KIND_MAX

export const isJobResultKind = (kind: number): boolean =>
  Number.isInteger(kind) && kind >= JOB_RESULT_KIND_MIN && kind <= JOB_RESULT_KIND_MAX

export const isJobFeedbackKind = (kind: number): boolean => kind === KIND_JOB_FEEDBACK

export const isDvmKind = (kind: number): boolean =>
  isJobRequestKind(kind) || isJobResultKind(kind) || isJobFeedbackKind(kind)

export const getResultKind = (requestKind: number): number | undefined =>
  isJobRequestKind(requestKind) ? requestKind + 1000 : undefined

export const getRequestKind = (resultKind: number): number | undefined =>
  isJobResultKind(resultKind) ? resultKind - 1000 : undefined

const decodeKind = Schema.decodeSync(EventKind)
const decodeTimestamp = Schema.decodeSync(UnixTimestamp)
const decodePublicKey = Schema.decodeSync(PublicKey)
const decodeTag = Schema.decodeSync(Tag)
const decodeNostrEvent = Schema.decodeUnknownSync(NostrEvent)

export const JobRequestKind = EventKind.pipe(
  Schema.check(Schema.makeFilter((kind) => isJobRequestKind(kind)))
)
export type JobRequestKind = typeof JobRequestKind.Type

export const JobResultKind = EventKind.pipe(
  Schema.check(Schema.makeFilter((kind) => isJobResultKind(kind)))
)
export type JobResultKind = typeof JobResultKind.Type

export const JobFeedbackKind = EventKind.pipe(
  Schema.check(Schema.makeFilter((kind) => kind === KIND_JOB_FEEDBACK))
)
export type JobFeedbackKind = typeof JobFeedbackKind.Type

export const InputTypeSchema = Schema.Literals(["url", "event", "job", "text"])
export type InputType = typeof InputTypeSchema.Type

export const JobStatusSchema = Schema.Literals([
  "payment-required",
  "processing",
  "error",
  "success",
  "partial",
])
export type JobStatus = typeof JobStatusSchema.Type

export const JobInputSchema = Schema.Struct({
  data: Schema.String,
  inputType: InputTypeSchema,
  relay: Schema.optional(Schema.String),
  marker: Schema.optional(Schema.String),
})
export type JobInput = typeof JobInputSchema.Type

export const JobParamSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
})
export type JobParam = typeof JobParamSchema.Type

export const JobRequestSchema = Schema.Struct({
  kind: JobRequestKind,
  inputs: Schema.Array(JobInputSchema),
  output: Schema.optional(Schema.String),
  params: Schema.Array(JobParamSchema),
  bid: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  relays: Schema.Array(Schema.String),
  serviceProviders: Schema.Array(PublicKey),
  encrypted: Schema.Boolean,
  content: Schema.String,
})
export type JobRequest = typeof JobRequestSchema.Type

export const JobResultSchema = Schema.Struct({
  kind: JobResultKind,
  content: Schema.String,
  request: Schema.optional(Schema.String),
  requestId: Schema.String,
  requestRelay: Schema.optional(Schema.String),
  inputs: Schema.Array(JobInputSchema),
  customerPubkey: PublicKey,
  amount: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  bolt11: Schema.optional(Schema.String),
  encrypted: Schema.Boolean,
})
export type JobResult = typeof JobResultSchema.Type

export const JobFeedbackSchema = Schema.Struct({
  status: JobStatusSchema,
  statusExtra: Schema.optional(Schema.String),
  requestId: Schema.String,
  requestRelay: Schema.optional(Schema.String),
  customerPubkey: PublicKey,
  content: Schema.String,
  amount: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  bolt11: Schema.optional(Schema.String),
})
export type JobFeedback = typeof JobFeedbackSchema.Type

export const JobRequestEventSchema = NostrEvent.pipe(
  Schema.check(Schema.makeFilter((event) => isJobRequestKind(event.kind)))
)
export const JobResultEventSchema = NostrEvent.pipe(
  Schema.check(Schema.makeFilter((event) => isJobResultKind(event.kind)))
)
export const JobFeedbackEventSchema = NostrEvent.pipe(
  Schema.check(Schema.makeFilter((event) => event.kind === KIND_JOB_FEEDBACK))
)

export type Nip90ErrorReason =
  | "invalid_kind"
  | "missing_tag"
  | "invalid_input_type"
  | "invalid_status"
  | "invalid_amount"
  | "invalid_pubkey"
  | "invalid_event"

export class Nip90ProtocolError extends Error {
  readonly _tag = "Nip90ProtocolError"

  constructor(
    readonly reason: Nip90ErrorReason,
    message: string
  ) {
    super(message)
    this.name = "Nip90ProtocolError"
  }
}

const protocolError = (reason: Nip90ErrorReason, message: string): Nip90ProtocolError =>
  new Nip90ProtocolError(reason, message)

export const parseInputType = (value: string): InputType => {
  const normalized = value.trim().toLowerCase()
  if (normalized === "prompt") {
    return "text"
  }
  if (normalized === "url" || normalized === "event" || normalized === "job" || normalized === "text") {
    return normalized
  }
  throw protocolError("invalid_input_type", `invalid input type: ${value}`)
}

export const parseJobStatus = (value: string): JobStatus => {
  if (
    value === "payment-required" ||
    value === "processing" ||
    value === "error" ||
    value === "success" ||
    value === "partial"
  ) {
    return value
  }
  throw protocolError("invalid_status", `invalid status: ${value}`)
}

const parseNonNegativeInteger = (
  value: string,
  tagName: string
): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw protocolError("invalid_amount", `invalid ${tagName} amount: ${value}`)
  }
  return parsed
}

const maybeDecodePublicKey = (value: string): typeof PublicKey.Type => {
  try {
    return decodePublicKey(value)
  } catch {
    throw protocolError("invalid_pubkey", `invalid customer pubkey: ${value}`)
  }
}

const normalizeRelay = (relay: string | undefined): string | undefined =>
  relay === undefined || relay === "" ? undefined : relay

const findTags = (tags: ReadonlyArray<readonly string[]>, name: string): ReadonlyArray<readonly string[]> =>
  tags.filter((tag) => tag[0] === name)

export const jobInput = {
  text: (data: string): JobInput => ({ data, inputType: "text" }),
  url: (data: string): JobInput => ({ data, inputType: "url" }),
  event: (data: string, relay?: string): JobInput => ({ data, inputType: "event", relay }),
  job: (data: string, relay?: string): JobInput => ({ data, inputType: "job", relay }),
  withMarker: (input: JobInput, marker: string): JobInput => ({ ...input, marker }),
}

export const jobParam = (key: string, value: string): JobParam => ({ key, value })

export const inputToTag = (input: JobInput): typeof Tag.Type => {
  const tag = ["i", input.data, input.inputType]
  if (input.relay !== undefined || input.marker !== undefined) {
    tag.push(input.relay ?? "")
  }
  if (input.marker !== undefined) {
    tag.push(input.marker)
  }
  return decodeTag(tag)
}

export const inputFromTag = (tag: readonly string[]): JobInput => {
  if (tag.length < 3 || tag[0] !== "i") {
    throw protocolError("missing_tag", "i tag requires at least 3 elements")
  }
  return {
    data: tag[1] ?? "",
    inputType: parseInputType(tag[2] ?? ""),
    relay: normalizeRelay(tag[3]),
    marker: tag[4],
  }
}

export const paramToTag = (param: JobParam): typeof Tag.Type =>
  decodeTag(["param", param.key, param.value])

export const paramFromTag = (tag: readonly string[]): JobParam => {
  if (tag.length < 3 || tag[0] !== "param") {
    throw protocolError("missing_tag", "param tag requires 3 elements")
  }
  return { key: tag[1] ?? "", value: tag[2] ?? "" }
}

export interface JobRequestOptions {
  readonly kind: number
  readonly inputs?: readonly JobInput[]
  readonly output?: string
  readonly params?: readonly JobParam[]
  readonly bid?: number
  readonly relays?: readonly string[]
  readonly serviceProviders?: readonly string[]
  readonly encrypted?: boolean
  readonly content?: string
}

export const makeJobRequest = (options: JobRequestOptions): JobRequest => {
  if (!isJobRequestKind(options.kind)) {
    throw protocolError("invalid_kind", `invalid kind: ${options.kind} (expected 5000-5999)`)
  }
  return Schema.decodeSync(JobRequestSchema)({
    kind: decodeKind(options.kind),
    inputs: options.inputs ?? [],
    output: options.output,
    params: options.params ?? [],
    bid: options.bid,
    relays: options.relays ?? [],
    serviceProviders: (options.serviceProviders ?? []).map(maybeDecodePublicKey),
    encrypted: options.encrypted ?? false,
    content: options.content ?? "",
  })
}

export const jobRequestToTags = (request: JobRequest): ReadonlyArray<typeof Tag.Type> => {
  const tags: Array<typeof Tag.Type> = []
  for (const input of request.inputs) {
    tags.push(inputToTag(input))
  }
  if (request.output !== undefined) {
    tags.push(decodeTag(["output", request.output]))
  }
  for (const param of request.params) {
    tags.push(paramToTag(param))
  }
  if (request.bid !== undefined) {
    tags.push(decodeTag(["bid", String(request.bid)]))
  }
  if (request.relays.length > 0) {
    tags.push(decodeTag(["relays", ...request.relays]))
  }
  for (const provider of request.serviceProviders) {
    tags.push(decodeTag(["p", provider]))
  }
  if (request.encrypted) {
    tags.push(decodeTag(["encrypted"]))
  }
  return tags
}

export const parseJobRequestEvent = (input: unknown): JobRequest => {
  const event = decodeNostrEvent(input)
  if (!isJobRequestKind(event.kind)) {
    throw protocolError("invalid_kind", `invalid kind: ${event.kind} (expected 5000-5999)`)
  }
  const output = findTags(event.tags, "output")[0]?.[1]
  const bid = findTags(event.tags, "bid")[0]?.[1]
  return makeJobRequest({
    kind: event.kind,
    inputs: findTags(event.tags, "i").map(inputFromTag),
    params: findTags(event.tags, "param").map(paramFromTag),
    relays: findTags(event.tags, "relays").flatMap((tag) => tag.slice(1)),
    serviceProviders: findTags(event.tags, "p").flatMap((tag) => tag[1] === undefined ? [] : [tag[1]]),
    encrypted: findTags(event.tags, "encrypted").length > 0,
    content: event.content,
    ...(output === undefined ? {} : { output }),
    ...(bid === undefined ? {} : { bid: parseNonNegativeInteger(bid, "bid") }),
  })
}

export interface JobResultOptions {
  readonly requestKind: number
  readonly requestId: string
  readonly customerPubkey: string
  readonly content: string
  readonly request?: string
  readonly requestRelay?: string
  readonly inputs?: readonly JobInput[]
  readonly amount?: number
  readonly bolt11?: string
  readonly encrypted?: boolean
}

export const makeJobResult = (options: JobResultOptions): JobResult => {
  const resultKind = getResultKind(options.requestKind)
  if (resultKind === undefined) {
    throw protocolError("invalid_kind", `invalid kind: ${options.requestKind} (expected 5000-5999)`)
  }
  return Schema.decodeSync(JobResultSchema)({
    kind: decodeKind(resultKind),
    content: options.content,
    request: options.request,
    requestId: options.requestId,
    requestRelay: options.requestRelay,
    inputs: options.inputs ?? [],
    customerPubkey: maybeDecodePublicKey(options.customerPubkey),
    amount: options.amount,
    bolt11: options.bolt11,
    encrypted: options.encrypted ?? false,
  })
}

export const jobResultToTags = (result: JobResult): ReadonlyArray<typeof Tag.Type> => {
  const tags: Array<typeof Tag.Type> = []
  if (result.request !== undefined) {
    tags.push(decodeTag(["request", result.request]))
  }
  tags.push(decodeTag(
    result.requestRelay === undefined ? ["e", result.requestId] : ["e", result.requestId, result.requestRelay]
  ))
  for (const input of result.inputs) {
    tags.push(inputToTag(input))
  }
  tags.push(decodeTag(["p", result.customerPubkey]))
  if (result.amount !== undefined) {
    tags.push(decodeTag(
      result.bolt11 === undefined
        ? ["amount", String(result.amount)]
        : ["amount", String(result.amount), result.bolt11]
    ))
  }
  tags.push(decodeTag(["status", "success"]))
  if (result.encrypted) {
    tags.push(decodeTag(["encrypted"]))
  }
  return tags
}

export const parseJobResultEvent = (input: unknown): JobResult => {
  const event = decodeNostrEvent(input)
  if (!isJobResultKind(event.kind)) {
    throw protocolError("invalid_kind", `invalid kind: ${event.kind} (expected 6000-6999)`)
  }
  const requestTag = findTags(event.tags, "e")[0]
  const customerTag = findTags(event.tags, "p")[0]
  if (requestTag?.[1] === undefined || requestTag[1] === "") {
    throw protocolError("missing_tag", "missing required tag: e (request event id)")
  }
  if (customerTag?.[1] === undefined || customerTag[1] === "") {
    throw protocolError("missing_tag", "missing required tag: p (customer pubkey)")
  }
  const amountTag = findTags(event.tags, "amount")[0]
  const bolt11Tag = findTags(event.tags, "bolt11")[0]
  return Schema.decodeSync(JobResultSchema)({
    kind: event.kind,
    content: event.content,
    request: findTags(event.tags, "request")[0]?.[1],
    requestId: requestTag[1],
    requestRelay: normalizeRelay(requestTag[2]),
    inputs: findTags(event.tags, "i").map(inputFromTag),
    customerPubkey: maybeDecodePublicKey(customerTag[1]),
    amount: amountTag?.[1] === undefined
      ? undefined
      : parseNonNegativeInteger(amountTag[1], "result"),
    bolt11: amountTag?.[2] ?? bolt11Tag?.[1],
    encrypted: findTags(event.tags, "encrypted").length > 0,
  })
}

export interface JobFeedbackOptions {
  readonly status: JobStatus
  readonly requestId: string
  readonly customerPubkey: string
  readonly statusExtra?: string
  readonly requestRelay?: string
  readonly content?: string
  readonly amount?: number
  readonly bolt11?: string
}

export const makeJobFeedback = (options: JobFeedbackOptions): JobFeedback =>
  Schema.decodeSync(JobFeedbackSchema)({
    status: options.status,
    statusExtra: options.statusExtra,
    requestId: options.requestId,
    requestRelay: options.requestRelay,
    customerPubkey: maybeDecodePublicKey(options.customerPubkey),
    content: options.content ?? "",
    amount: options.amount,
    bolt11: options.bolt11,
  })

export const jobFeedbackToTags = (feedback: JobFeedback): ReadonlyArray<typeof Tag.Type> => {
  const tags: Array<typeof Tag.Type> = []
  tags.push(decodeTag(
    feedback.statusExtra === undefined
      ? ["status", feedback.status]
      : ["status", feedback.status, feedback.statusExtra]
  ))
  tags.push(decodeTag(
    feedback.requestRelay === undefined
      ? ["e", feedback.requestId]
      : ["e", feedback.requestId, feedback.requestRelay]
  ))
  tags.push(decodeTag(["p", feedback.customerPubkey]))
  if (feedback.amount !== undefined) {
    tags.push(decodeTag(
      feedback.bolt11 === undefined
        ? ["amount", String(feedback.amount)]
        : ["amount", String(feedback.amount), feedback.bolt11]
    ))
  }
  return tags
}

export const parseJobFeedbackEvent = (input: unknown): JobFeedback => {
  const event = decodeNostrEvent(input)
  if (!isJobFeedbackKind(event.kind)) {
    throw protocolError("invalid_kind", `invalid kind: ${event.kind} (expected ${KIND_JOB_FEEDBACK})`)
  }
  const statusTag = findTags(event.tags, "status")[0]
  const requestTag = findTags(event.tags, "e")[0]
  const customerTag = findTags(event.tags, "p")[0]
  if (statusTag?.[1] === undefined || statusTag[1] === "") {
    throw protocolError("missing_tag", "missing required tag: status")
  }
  if (requestTag?.[1] === undefined || requestTag[1] === "") {
    throw protocolError("missing_tag", "missing required tag: e (request event id)")
  }
  if (customerTag?.[1] === undefined || customerTag[1] === "") {
    throw protocolError("missing_tag", "missing required tag: p (customer pubkey)")
  }
  const amountTag = findTags(event.tags, "amount")[0]
  const bolt11Tag = findTags(event.tags, "bolt11")[0]
  const requestRelay = normalizeRelay(requestTag[2])
  const bolt11 = amountTag?.[2] ?? bolt11Tag?.[1]
  return makeJobFeedback({
    status: parseJobStatus(statusTag[1]),
    requestId: requestTag[1],
    customerPubkey: customerTag[1],
    content: event.content,
    ...(statusTag[2] === undefined ? {} : { statusExtra: statusTag[2] }),
    ...(requestRelay === undefined ? {} : { requestRelay }),
    ...(amountTag?.[1] === undefined
      ? {}
      : { amount: parseNonNegativeInteger(amountTag[1], "feedback") }),
    ...(bolt11 === undefined ? {} : { bolt11 }),
  })
}

const nowSeconds = (): typeof UnixTimestamp.Type => decodeTimestamp(Math.floor(Date.now() / 1000))

export const createJobRequestEvent = (
  request: JobRequest,
  createdAt: typeof UnixTimestamp.Type = nowSeconds()
): UnsignedEvent => ({
  pubkey: decodePublicKey("0".repeat(64)),
  created_at: createdAt,
  kind: request.kind,
  tags: [...jobRequestToTags(request)],
  content: request.content,
})

export const createJobResultEvent = (
  result: JobResult,
  createdAt: typeof UnixTimestamp.Type = nowSeconds()
): UnsignedEvent => ({
  pubkey: decodePublicKey("0".repeat(64)),
  created_at: createdAt,
  kind: result.kind,
  tags: [...jobResultToTags(result)],
  content: result.content,
})

export const createJobFeedbackEvent = (
  feedback: JobFeedback,
  createdAt: typeof UnixTimestamp.Type = nowSeconds()
): UnsignedEvent => ({
  pubkey: decodePublicKey("0".repeat(64)),
  created_at: createdAt,
  kind: decodeKind(KIND_JOB_FEEDBACK),
  tags: [...jobFeedbackToTags(feedback)],
  content: feedback.content,
})

export const eventMatchesRequest = (event: NostrEvent, requestId: EventId | string): boolean =>
  event.tags.some((tag) => tag[0] === "e" && tag[1] === requestId)
