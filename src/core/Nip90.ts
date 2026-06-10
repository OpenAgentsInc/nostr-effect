/**
 * NIP-90: Data Vending Machines
 *
 * Protocol-only helpers for job request, result, and feedback events.
 */
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
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
export const KIND_DATASET_LISTING = 30404
export const KIND_DATASET_OFFER = 30406
export const KIND_DATASET_ACCESS_REQUEST = 5960
export const KIND_DATASET_ACCESS_RESULT = 6960
export const KIND_RESULT_RLM_SUBQUERY = 6940

export const isJobRequestKind = (kind: number): boolean =>
  Number.isInteger(kind) && kind >= JOB_REQUEST_KIND_MIN && kind <= JOB_REQUEST_KIND_MAX

export const isJobResultKind = (kind: number): boolean =>
  Number.isInteger(kind) && kind >= JOB_RESULT_KIND_MIN && kind <= JOB_RESULT_KIND_MAX

export const isJobFeedbackKind = (kind: number): boolean => kind === KIND_JOB_FEEDBACK

export const isDvmKind = (kind: number): boolean =>
  isJobRequestKind(kind) || isJobResultKind(kind) || isJobFeedbackKind(kind)

export const isDatasetListingKind = (kind: number): boolean => kind === KIND_DATASET_LISTING

export const isDatasetOfferKind = (kind: number): boolean => kind === KIND_DATASET_OFFER

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

export const DatasetListingEventSchema = NostrEvent.pipe(
  Schema.check(Schema.makeFilter((event) => event.kind === KIND_DATASET_LISTING))
)
export const DatasetOfferEventSchema = NostrEvent.pipe(
  Schema.check(Schema.makeFilter((event) => event.kind === KIND_DATASET_OFFER))
)

export const DatasetDigest = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  Schema.brand("DatasetDigest")
)
export type DatasetDigest = typeof DatasetDigest.Type

export const DatasetAddress = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^30404:[a-f0-9]{64}:.+$/)),
  Schema.brand("DatasetAddress")
)
export type DatasetAddress = typeof DatasetAddress.Type

export const DatasetOfferAddress = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^30406:[a-f0-9]{64}:.+$/)),
  Schema.brand("DatasetOfferAddress")
)
export type DatasetOfferAddress = typeof DatasetOfferAddress.Type

export const DatasetKindSchema = Schema.Literals([
  "table",
  "corpus",
  "image_collection",
  "audio_corpus",
  "video_corpus",
  "conversation_bundle",
  "embedding_set",
  "eval_bundle",
  "mixed",
])
export type DatasetKind = typeof DatasetKindSchema.Type

export const DatasetAccessSchema = Schema.Literals([
  "open",
  "paid",
  "quote",
  "targeted",
  "subscription",
  "negotiated",
])
export type DatasetAccess = typeof DatasetAccessSchema.Type

export const DatasetDeliveryModeSchema = Schema.Literals([
  "download",
  "nip90",
  "nip94",
  "blossom",
  "giftwrap",
  "dm",
  "torrent",
  "manual",
])
export type DatasetDeliveryMode = typeof DatasetDeliveryModeSchema.Type

export const DatasetOfferStatusSchema = Schema.Literals([
  "active",
  "inactive",
  "revoked",
  "expired",
])
export type DatasetOfferStatus = typeof DatasetOfferStatusSchema.Type

export const DatasetPaymentRailSchema = Schema.Literals([
  "zap",
  "ln",
  "cashu",
  "fedimint",
  "manual",
])
export type DatasetPaymentRail = typeof DatasetPaymentRailSchema.Type

export const DatasetManifestMemberSchema = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  size: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  mime: Schema.String,
  x: DatasetDigest,
})
export type DatasetManifestMember = typeof DatasetManifestMemberSchema.Type

export const DatasetListingSchema = Schema.Struct({
  d: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  x: DatasetDigest,
  publishedAt: UnixTimestamp,
  content: Schema.String,
  summary: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  datasetKind: Schema.optional(DatasetKindSchema),
  mime: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  records: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  license: Schema.optional(Schema.String),
  access: Schema.optional(DatasetAccessSchema),
  delivery: Schema.Array(DatasetDeliveryModeSchema),
  topics: Schema.Array(Schema.String),
  refs: Schema.Array(Tag),
})
export type DatasetListing = typeof DatasetListingSchema.Type

export const DatasetOfferSchema = Schema.Struct({
  d: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  listing: DatasetAddress,
  status: DatasetOfferStatusSchema,
  delivery: Schema.Array(DatasetDeliveryModeSchema).pipe(Schema.check(Schema.isMinLength(1))),
  content: Schema.String,
  policy: Schema.optional(Schema.String),
  price: Schema.optional(Schema.Tuple([Schema.String, Schema.String])),
  payments: Schema.Array(Schema.TupleWithRest(Schema.Tuple([DatasetPaymentRailSchema]), [Schema.String])),
  buyers: Schema.Array(PublicKey),
  expiration: Schema.optional(Schema.String),
  license: Schema.optional(Schema.String),
  topics: Schema.Array(Schema.String),
})
export type DatasetOffer = typeof DatasetOfferSchema.Type

export const DatasetDeliveryDescriptorSchema = Schema.Struct({
  dataset: DatasetAddress,
  delivery: DatasetDeliveryModeSchema,
  ref: Schema.String,
  mime: Schema.optional(Schema.String),
  x: DatasetDigest,
  offer: Schema.optional(DatasetOfferAddress),
  expires_at: Schema.optional(UnixTimestamp),
  license: Schema.optional(Schema.String),
})
export type DatasetDeliveryDescriptor = typeof DatasetDeliveryDescriptorSchema.Type

export type Nip90ErrorReason =
  | "invalid_kind"
  | "invalid_address"
  | "invalid_digest"
  | "missing_tag"
  | "invalid_input_type"
  | "invalid_status"
  | "invalid_delivery"
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

const textEncoder = new TextEncoder()

const parseDatasetDigest = (value: string): DatasetDigest => {
  try {
    return Schema.decodeSync(DatasetDigest)(value)
  } catch {
    throw protocolError("invalid_digest", `invalid dataset digest: ${value}`)
  }
}

const parseDatasetAddress = (value: string): DatasetAddress => {
  try {
    return Schema.decodeSync(DatasetAddress)(value)
  } catch {
    throw protocolError("invalid_address", `invalid dataset address: ${value}`)
  }
}

const parseDatasetOfferAddress = (value: string): DatasetOfferAddress => {
  try {
    return Schema.decodeSync(DatasetOfferAddress)(value)
  } catch {
    throw protocolError("invalid_address", `invalid dataset offer address: ${value}`)
  }
}

const parseDeliveryMode = (value: string): DatasetDeliveryMode => {
  if (
    value === "download" ||
    value === "nip90" ||
    value === "nip94" ||
    value === "blossom" ||
    value === "giftwrap" ||
    value === "dm" ||
    value === "torrent" ||
    value === "manual"
  ) {
    return value
  }
  throw protocolError("invalid_delivery", `invalid dataset delivery mode: ${value}`)
}

const parseOfferStatus = (value: string): DatasetOfferStatus => {
  if (
    value === "active" ||
    value === "inactive" ||
    value === "revoked" ||
    value === "expired"
  ) {
    return value
  }
  throw protocolError("invalid_status", `invalid dataset offer status: ${value}`)
}

const parsePaymentRail = (value: string): DatasetPaymentRail => {
  if (
    value === "zap" ||
    value === "ln" ||
    value === "cashu" ||
    value === "fedimint" ||
    value === "manual"
  ) {
    return value
  }
  throw protocolError("invalid_event", `invalid dataset payment rail: ${value}`)
}

const parseOptionalIntegerTag = (
  tag: readonly string[] | undefined,
  tagName: string
): number | undefined =>
  tag?.[1] === undefined ? undefined : parseNonNegativeInteger(tag[1], tagName)

const firstTagValue = (
  tags: ReadonlyArray<readonly string[]>,
  tagName: string
): string | undefined => findTags(tags, tagName)[0]?.[1]

export const datasetAddress = (sellerPubkey: string, d: string): DatasetAddress =>
  parseDatasetAddress(`${maybeDecodePublicKey(sellerPubkey)}:${d}`.replace(/^/, "30404:"))

export const datasetOfferAddress = (sellerPubkey: string, d: string): DatasetOfferAddress =>
  parseDatasetOfferAddress(`${maybeDecodePublicKey(sellerPubkey)}:${d}`.replace(/^/, "30406:"))

export const datasetScopeId = (
  sellerPubkey: string,
  d: string,
  digest: string
): string => `${datasetAddress(sellerPubkey, d)}:${parseDatasetDigest(digest)}`

export const sha256Hex = (input: string | Uint8Array): DatasetDigest =>
  parseDatasetDigest(
    bytesToHex(sha256(typeof input === "string" ? textEncoder.encode(input) : input))
  )

export const canonicalDatasetManifest = (
  members: ReadonlyArray<DatasetManifestMember>
): string => {
  const parsedMembers = Schema.decodeSync(Schema.Array(DatasetManifestMemberSchema))(
    members.map((member) => ({
      path: member.path,
      size: member.size,
      mime: member.mime,
      x: member.x,
    }))
  )
  const sortedMembers = [...parsedMembers].sort((left, right) =>
    left.path.localeCompare(right.path)
  )

  return JSON.stringify({ members: sortedMembers })
}

export const verifyDatasetDigest = (
  payload: string | Uint8Array,
  expectedDigest: string
): boolean => sha256Hex(payload) === parseDatasetDigest(expectedDigest)

export const verifyDatasetDeliveryDescriptorDigest = (
  descriptor: DatasetDeliveryDescriptor,
  payload: string | Uint8Array
): boolean => verifyDatasetDigest(payload, descriptor.x)

export interface DatasetListingOptions {
  readonly d: string
  readonly title: string
  readonly x: string
  readonly publishedAt: number
  readonly content?: string
  readonly summary?: string
  readonly version?: string
  readonly datasetKind?: DatasetKind
  readonly mime?: string
  readonly size?: number
  readonly records?: number
  readonly license?: string
  readonly access?: DatasetAccess
  readonly delivery?: readonly DatasetDeliveryMode[]
  readonly topics?: readonly string[]
  readonly refs?: readonly (typeof Tag.Type)[]
}

export const makeDatasetListing = (options: DatasetListingOptions): DatasetListing => {
  try {
    return Schema.decodeSync(DatasetListingSchema)({
      d: options.d,
      title: options.title,
      x: parseDatasetDigest(options.x),
      publishedAt: decodeTimestamp(options.publishedAt),
      content: options.content ?? "",
      ...(options.summary === undefined ? {} : { summary: options.summary }),
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.datasetKind === undefined ? {} : { datasetKind: options.datasetKind }),
      ...(options.mime === undefined ? {} : { mime: options.mime }),
      ...(options.size === undefined ? {} : { size: options.size }),
      ...(options.records === undefined ? {} : { records: options.records }),
      ...(options.license === undefined ? {} : { license: options.license }),
      ...(options.access === undefined ? {} : { access: options.access }),
      delivery: options.delivery ?? [],
      topics: options.topics ?? ["dataset"],
      refs: options.refs ?? [],
    })
  } catch (error) {
    if (error instanceof Nip90ProtocolError) throw error
    throw protocolError("invalid_event", "invalid dataset listing")
  }
}

export const datasetListingToTags = (listing: DatasetListing): ReadonlyArray<typeof Tag.Type> => {
  const tags: Array<typeof Tag.Type> = [
    decodeTag(["d", listing.d]),
    decodeTag(["title", listing.title]),
    decodeTag(["x", listing.x]),
    decodeTag(["published_at", String(listing.publishedAt)]),
  ]
  if (listing.summary !== undefined) tags.push(decodeTag(["summary", listing.summary]))
  if (listing.version !== undefined) tags.push(decodeTag(["version", listing.version]))
  if (listing.datasetKind !== undefined) tags.push(decodeTag(["dataset_kind", listing.datasetKind]))
  if (listing.mime !== undefined) tags.push(decodeTag(["m", listing.mime]))
  if (listing.size !== undefined) tags.push(decodeTag(["size", String(listing.size)]))
  if (listing.records !== undefined) tags.push(decodeTag(["records", String(listing.records)]))
  if (listing.license !== undefined) tags.push(decodeTag(["license", listing.license]))
  if (listing.access !== undefined) tags.push(decodeTag(["access", listing.access]))
  for (const delivery of listing.delivery) tags.push(decodeTag(["delivery", delivery]))
  for (const topic of listing.topics) tags.push(decodeTag(["t", topic]))
  tags.push(...listing.refs)
  return tags
}

export const parseDatasetListingEvent = (input: unknown): DatasetListing => {
  const event = decodeNostrEvent(input)
  if (!isDatasetListingKind(event.kind)) {
    throw protocolError("invalid_kind", `invalid kind: ${event.kind} (expected ${KIND_DATASET_LISTING})`)
  }
  const d = firstTagValue(event.tags, "d")
  const title = firstTagValue(event.tags, "title")
  const digest = firstTagValue(event.tags, "x")
  const publishedAt = firstTagValue(event.tags, "published_at")
  if (d === undefined || d === "") throw protocolError("missing_tag", "missing required tag: d")
  if (title === undefined || title === "") throw protocolError("missing_tag", "missing required tag: title")
  if (digest === undefined || digest === "") throw protocolError("missing_tag", "missing required tag: x")
  if (publishedAt === undefined || publishedAt === "") {
    throw protocolError("missing_tag", "missing required tag: published_at")
  }

  const listingOptions: DatasetListingOptions = {
    d,
    title,
    x: digest,
    publishedAt: parseNonNegativeInteger(publishedAt, "published_at"),
    content: event.content,
    delivery: findTags(event.tags, "delivery").map((tag) => parseDeliveryMode(tag[1] ?? "")),
    topics: findTags(event.tags, "t").flatMap((tag) => tag[1] === undefined ? [] : [tag[1]]),
    refs: event.tags.filter((tag) => tag[0] === "e" || tag[0] === "a"),
  }
  const summary = firstTagValue(event.tags, "summary")
  const version = firstTagValue(event.tags, "version")
  const datasetKind = firstTagValue(event.tags, "dataset_kind")
  const mime = firstTagValue(event.tags, "m")
  const size = parseOptionalIntegerTag(findTags(event.tags, "size")[0], "size")
  const records = parseOptionalIntegerTag(findTags(event.tags, "records")[0], "records")
  const license = firstTagValue(event.tags, "license")
  const access = firstTagValue(event.tags, "access")

  return makeDatasetListing({
    ...listingOptions,
    ...(summary === undefined ? {} : { summary }),
    ...(version === undefined ? {} : { version }),
    ...(datasetKind === undefined ? {} : { datasetKind: datasetKind as DatasetKind }),
    ...(mime === undefined ? {} : { mime }),
    ...(size === undefined ? {} : { size }),
    ...(records === undefined ? {} : { records }),
    ...(license === undefined ? {} : { license }),
    ...(access === undefined ? {} : { access: access as DatasetAccess }),
  })
}

export interface DatasetOfferOptions {
  readonly d: string
  readonly listing: string
  readonly status: DatasetOfferStatus
  readonly delivery: readonly DatasetDeliveryMode[]
  readonly content?: string
  readonly policy?: string
  readonly price?: readonly [string, string]
  readonly payments?: readonly (readonly [DatasetPaymentRail, ...string[]])[]
  readonly buyers?: readonly string[]
  readonly expiration?: string
  readonly license?: string
  readonly topics?: readonly string[]
}

export const makeDatasetOffer = (options: DatasetOfferOptions): DatasetOffer => {
  try {
    return Schema.decodeSync(DatasetOfferSchema)({
      d: options.d,
      listing: parseDatasetAddress(options.listing),
      status: options.status,
      delivery: options.delivery,
      content: options.content ?? "",
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.price === undefined ? {} : { price: options.price }),
      payments: options.payments ?? [],
      buyers: (options.buyers ?? []).map(maybeDecodePublicKey),
      ...(options.expiration === undefined ? {} : { expiration: options.expiration }),
      ...(options.license === undefined ? {} : { license: options.license }),
      topics: options.topics ?? ["dataset"],
    })
  } catch (error) {
    if (error instanceof Nip90ProtocolError) throw error
    throw protocolError("invalid_event", "invalid dataset offer")
  }
}

export const datasetOfferToTags = (offer: DatasetOffer): ReadonlyArray<typeof Tag.Type> => {
  const tags: Array<typeof Tag.Type> = [
    decodeTag(["d", offer.d]),
    decodeTag(["a", offer.listing]),
    decodeTag(["status", offer.status]),
  ]
  if (offer.policy !== undefined) tags.push(decodeTag(["policy", offer.policy]))
  if (offer.price !== undefined) tags.push(decodeTag(["price", offer.price[0], offer.price[1]]))
  for (const payment of offer.payments) tags.push(decodeTag(["payment", ...payment]))
  for (const delivery of offer.delivery) tags.push(decodeTag(["delivery", delivery]))
  for (const buyer of offer.buyers) tags.push(decodeTag(["p", buyer]))
  if (offer.expiration !== undefined) tags.push(decodeTag(["expiration", offer.expiration]))
  if (offer.license !== undefined) tags.push(decodeTag(["license", offer.license]))
  for (const topic of offer.topics) tags.push(decodeTag(["t", topic]))
  return tags
}

export const parseDatasetOfferEvent = (input: unknown): DatasetOffer => {
  const event = decodeNostrEvent(input)
  if (!isDatasetOfferKind(event.kind)) {
    throw protocolError("invalid_kind", `invalid kind: ${event.kind} (expected ${KIND_DATASET_OFFER})`)
  }
  const d = firstTagValue(event.tags, "d")
  const listing = firstTagValue(event.tags, "a")
  const status = firstTagValue(event.tags, "status")
  const delivery = findTags(event.tags, "delivery").map((tag) => parseDeliveryMode(tag[1] ?? ""))
  if (d === undefined || d === "") throw protocolError("missing_tag", "missing required tag: d")
  if (listing === undefined || listing === "") throw protocolError("missing_tag", "missing required tag: a")
  if (status === undefined || status === "") throw protocolError("missing_tag", "missing required tag: status")
  if (delivery.length === 0) throw protocolError("missing_tag", "missing required tag: delivery")
  const priceTag = findTags(event.tags, "price")[0]
  const policy = firstTagValue(event.tags, "policy")
  const expiration = firstTagValue(event.tags, "expiration")
  const license = firstTagValue(event.tags, "license")

  return makeDatasetOffer({
    d,
    listing,
    status: parseOfferStatus(status),
    delivery,
    content: event.content,
    ...(policy === undefined ? {} : { policy }),
    ...(priceTag?.[1] === undefined || priceTag[2] === undefined
      ? {}
      : { price: [priceTag[1], priceTag[2]] }),
    payments: findTags(event.tags, "payment").map((tag) => [
      parsePaymentRail(tag[1] ?? "manual"),
      ...tag.slice(2),
    ]),
    buyers: findTags(event.tags, "p").flatMap((tag) => tag[1] === undefined ? [] : [tag[1]]),
    ...(expiration === undefined ? {} : { expiration }),
    ...(license === undefined ? {} : { license }),
    topics: findTags(event.tags, "t").flatMap((tag) => tag[1] === undefined ? [] : [tag[1]]),
  })
}

export interface DatasetAccessRequestOptions {
  readonly listing: string
  readonly offer?: string
  readonly sellerPubkey?: string
  readonly bid?: number
  readonly relays?: readonly string[]
  readonly delivery?: DatasetDeliveryMode
  readonly preview?: string
  readonly licenseAck?: string
  readonly output?: string
  readonly content?: string
}

export const makeDatasetAccessRequest = (
  options: DatasetAccessRequestOptions
): JobRequest =>
  makeJobRequest({
    kind: KIND_DATASET_ACCESS_REQUEST,
    output: options.output ?? "application/json",
    ...(options.bid === undefined ? {} : { bid: options.bid }),
    ...(options.relays === undefined ? {} : { relays: options.relays }),
    serviceProviders: options.sellerPubkey === undefined ? [] : [options.sellerPubkey],
    params: [
      ...(options.delivery === undefined ? [] : [jobParam("delivery", options.delivery)]),
      ...(options.preview === undefined ? [] : [jobParam("preview", options.preview)]),
      ...(options.licenseAck === undefined ? [] : [jobParam("license_ack", options.licenseAck)]),
    ],
    content: options.content ?? "",
  })

export const datasetAccessRequestToTags = (
  request: JobRequest,
  options: Pick<DatasetAccessRequestOptions, "listing" | "offer">
): ReadonlyArray<typeof Tag.Type> => [
  decodeTag(["a", parseDatasetAddress(options.listing)]),
  ...(options.offer === undefined ? [] : [decodeTag(["a", parseDatasetOfferAddress(options.offer)])]),
  ...jobRequestToTags(request),
]

export interface DatasetAccessResultOptions {
  readonly requestId: string
  readonly customerPubkey: string
  readonly listing: string
  readonly descriptor: DatasetDeliveryDescriptor
  readonly offer?: string
  readonly request?: string
  readonly requestRelay?: string
  readonly amount?: number
  readonly bolt11?: string
}

export const makeDatasetAccessResult = (
  options: DatasetAccessResultOptions
): JobResult =>
  makeJobResult({
    requestKind: KIND_DATASET_ACCESS_REQUEST,
    requestId: options.requestId,
    customerPubkey: options.customerPubkey,
    content: JSON.stringify(Schema.decodeSync(DatasetDeliveryDescriptorSchema)(options.descriptor)),
    ...(options.request === undefined ? {} : { request: options.request }),
    ...(options.requestRelay === undefined ? {} : { requestRelay: options.requestRelay }),
    ...(options.amount === undefined ? {} : { amount: options.amount }),
    ...(options.bolt11 === undefined ? {} : { bolt11: options.bolt11 }),
  })

export const datasetAccessResultToTags = (
  result: JobResult,
  options: Pick<DatasetAccessResultOptions, "listing" | "offer" | "descriptor">
): ReadonlyArray<typeof Tag.Type> => [
  ...jobResultToTags(result),
  decodeTag(["a", parseDatasetAddress(options.listing)]),
  ...(options.offer === undefined ? [] : [decodeTag(["a", parseDatasetOfferAddress(options.offer)])]),
  decodeTag(["x", options.descriptor.x]),
]

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
