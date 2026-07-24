import { describe, expect, test } from "vite-plus/test"
import type { NostrEvent } from "./Schema.js"
import {
  KIND_JOB_FEEDBACK,
  KIND_JOB_TEXT_GENERATION,
  KIND_DATASET_ACCESS_REQUEST,
  KIND_DATASET_LISTING,
  KIND_DATASET_OFFER,
  KIND_JOB_LABOR_CODE_TASK,
  KIND_JOB_LABOR_REVIEW,
  KIND_RESULT_RLM_SUBQUERY,
  Nip90ProtocolError,
  PROVIDER_COMPLIANT_USAGE_LABOR_POLICY_REF,
  canonicalDatasetManifest,
  createJobFeedbackEvent,
  createJobRequestEvent,
  createJobResultEvent,
  datasetAccessRequestToTags,
  datasetAccessResultToTags,
  datasetAddress,
  datasetOfferAddress,
  datasetListingToTags,
  datasetOfferToTags,
  eventMatchesRequest,
  getRequestKind,
  getResultKind,
  inputFromTag,
  inputToTag,
  isDvmKind,
  isJobFeedbackKind,
  isJobRequestKind,
  isJobResultKind,
  isLaborJobKind,
  jobFeedbackToTags,
  jobInput,
  jobParam,
  jobRequestToTags,
  jobResultToTags,
  laborJobKindForType,
  laborJobRequestToTags,
  laborJobResultToTags,
  laborJobTypeForKind,
  makeDatasetAccessRequest,
  makeDatasetAccessResult,
  makeDatasetListing,
  makeDatasetOffer,
  makeJobFeedback,
  makeJobRequest,
  makeJobResult,
  makeLaborJobRequest,
  makeLaborJobResult,
  paramFromTag,
  paramToTag,
  parseDatasetListingEvent,
  parseDatasetOfferEvent,
  parseInputType,
  parseJobFeedbackEvent,
  parseJobRequestEvent,
  parseJobResultEvent,
  parseJobStatus,
  parseLaborJobRequestEvent,
  parseLaborJobResultEvent,
  sha256Hex,
  verifyDatasetDeliveryDescriptorDigest,
  verifyDatasetDigest,
} from "./Nip90.js"

const pubkey = "11".repeat(32)
const providerPubkey = "22".repeat(32)
const sig = "33".repeat(64)

const event = (
  kind: number,
  tags: ReadonlyArray<readonly string[]>,
  content = "",
  id = "aa".repeat(32)
): NostrEvent => ({
  id: id as NostrEvent["id"],
  pubkey: pubkey as NostrEvent["pubkey"],
  created_at: 1_762_000_000 as NostrEvent["created_at"],
  kind: kind as NostrEvent["kind"],
  tags: tags as NostrEvent["tags"],
  content,
  sig: sig as NostrEvent["sig"],
})

const plainTag = (tag: readonly string[]): string[] => [...tag]
const plainTags = (tags: ReadonlyArray<readonly string[]>): string[][] => tags.map(plainTag)

describe("Nip90 protocol", () => {
  test("classifies DVM kinds and maps request/result kinds", () => {
    expect(isJobRequestKind(5000)).toBe(true)
    expect(isJobRequestKind(5999)).toBe(true)
    expect(isJobRequestKind(6000)).toBe(false)
    expect(isJobResultKind(6000)).toBe(true)
    expect(isJobResultKind(6999)).toBe(true)
    expect(isJobResultKind(7000)).toBe(false)
    expect(isJobFeedbackKind(7000)).toBe(true)
    expect(isDvmKind(5050)).toBe(true)
    expect(isDvmKind(6050)).toBe(true)
    expect(isDvmKind(7000)).toBe(true)
    expect(isDvmKind(1)).toBe(false)
    expect(getResultKind(5050)).toBe(6050)
    expect(getRequestKind(6050)).toBe(5050)
    expect(getResultKind(6000)).toBeUndefined()
    expect(getRequestKind(5000)).toBeUndefined()
    expect(KIND_RESULT_RLM_SUBQUERY).toBe(6940)
    expect(isLaborJobKind(KIND_JOB_LABOR_CODE_TASK)).toBe(true)
    expect(laborJobKindForType("review")).toBe(KIND_JOB_LABOR_REVIEW)
    expect(laborJobTypeForKind(KIND_JOB_LABOR_CODE_TASK)).toBe("code_task")
  })

  test("parses input type and status aliases", () => {
    expect(parseInputType("url")).toBe("url")
    expect(parseInputType("Prompt")).toBe("text")
    expect(parseJobStatus("payment-required")).toBe("payment-required")
    expect(parseJobStatus("partial")).toBe("partial")
    expect(() => parseInputType("bad")).toThrow(Nip90ProtocolError)
    expect(() => parseJobStatus("bad")).toThrow(Nip90ProtocolError)
  })

  test("round-trips i and param tags", () => {
    expect(plainTag(inputToTag(jobInput.text("Hello")))).toEqual(["i", "Hello", "text"])
    expect(plainTag(inputToTag(jobInput.withMarker(jobInput.url("https://example.com"), "audio")))).toEqual([
      "i",
      "https://example.com",
      "url",
      "",
      "audio",
    ])
    expect(plainTag(inputToTag(jobInput.event("abc123", "wss://relay.com")))).toEqual([
      "i",
      "abc123",
      "event",
      "wss://relay.com",
    ])
    expect(inputFromTag(["i", "Hello", "prompt"]).inputType).toBe("text")
    expect(inputFromTag(["i", "abc123", "event", "wss://relay.com", "source"])).toEqual({
      data: "abc123",
      inputType: "event",
      relay: "wss://relay.com",
      marker: "source",
    })
    expect(plainTag(paramToTag(jobParam("temperature", "0.7")))).toEqual([
      "param",
      "temperature",
      "0.7",
    ])
    expect(paramFromTag(["param", "max_tokens", "512"])).toEqual({
      key: "max_tokens",
      value: "512",
    })
  })

  test("round-trips job request tags and event parsing", () => {
    const request = makeJobRequest({
      kind: KIND_JOB_TEXT_GENERATION,
      inputs: [jobInput.text("What is the capital of France?")],
      output: "text/plain",
      params: [jobParam("model", "gpt-4"), jobParam("temperature", "0.7")],
      bid: 1000,
      relays: ["wss://relay.example.com"],
      serviceProviders: [providerPubkey],
    })

    expect(request.kind as number).toBe(5050)
    expect(request.inputs).toHaveLength(1)
    expect(request.params).toHaveLength(2)
    expect(plainTags(jobRequestToTags(request))).toEqual([
      ["i", "What is the capital of France?", "text"],
      ["output", "text/plain"],
      ["param", "model", "gpt-4"],
      ["param", "temperature", "0.7"],
      ["bid", "1000"],
      ["relays", "wss://relay.example.com"],
      ["p", providerPubkey],
    ])

    const parsed = parseJobRequestEvent(event(5050, jobRequestToTags(request), request.content))
    expect(parsed).toEqual(request)
    expect(createJobRequestEvent(request, 1_762_000_001 as never).kind as number).toBe(5050)
  })

  test("accepts prompt alias from request events", () => {
    const parsed = parseJobRequestEvent(event(5050, [
      ["i", "hello world", "prompt"],
      ["param", "top-k", "20"],
      ["bid", "1000"],
    ]))
    expect(parsed.inputs[0]?.inputType).toBe("text")
    expect(parsed.inputs[0]?.data).toBe("hello world")
    expect(parsed.params[0]).toEqual({ key: "top-k", value: "20" })
  })

  test("round-trips job result with amount and bolt11", () => {
    const result = makeJobResult({
      requestKind: 5001,
      requestId: "req123",
      requestRelay: "wss://relay.com",
      customerPubkey: pubkey,
      content: "The capital is Paris.",
      request: '{"kind":5001}',
      inputs: [jobInput.text("Original input")],
      amount: 1000,
      bolt11: "lnbc1000n1...",
    })

    expect(result.kind as number).toBe(6001)
    expect(plainTags(jobResultToTags(result))).toEqual([
      ["request", '{"kind":5001}'],
      ["e", "req123", "wss://relay.com"],
      ["i", "Original input", "text"],
      ["p", pubkey],
      ["amount", "1000", "lnbc1000n1..."],
      ["status", "success"],
    ])

    const parsed = parseJobResultEvent(event(6001, jobResultToTags(result), result.content))
    expect(parsed).toEqual(result)
    expect(createJobResultEvent(result, 1_762_000_001 as never).kind as number).toBe(6001)
    expect(eventMatchesRequest(event(6001, jobResultToTags(result)), "req123")).toBe(true)
  })

  test("round-trips job feedback with payment-required status", () => {
    const feedback = makeJobFeedback({
      status: "payment-required",
      statusExtra: "pay to continue",
      requestId: "request123",
      requestRelay: "wss://relay.com",
      customerPubkey: pubkey,
      content: "preview available",
      amount: 1500,
      bolt11: "lnbc1500n1...",
    })

    expect(plainTags(jobFeedbackToTags(feedback))).toEqual([
      ["status", "payment-required", "pay to continue"],
      ["e", "request123", "wss://relay.com"],
      ["p", pubkey],
      ["amount", "1500", "lnbc1500n1..."],
    ])

    const parsed = parseJobFeedbackEvent(event(KIND_JOB_FEEDBACK, jobFeedbackToTags(feedback), feedback.content))
    expect(parsed).toEqual(feedback)
    expect(createJobFeedbackEvent(feedback, 1_762_000_001 as never).kind as number).toBe(7000)
  })

  test("rejects malformed kind and tag combinations with typed errors", () => {
    expect(() => makeJobRequest({ kind: 6000 })).toThrow(Nip90ProtocolError)
    expect(() => parseJobRequestEvent(event(6000, []))).toThrow(Nip90ProtocolError)
    expect(() => parseJobResultEvent(event(6001, [["p", pubkey]]))).toThrow(Nip90ProtocolError)
    expect(() => parseJobResultEvent(event(6001, [["e", "req"], ["p", "bad"]]))).toThrow(
      Nip90ProtocolError
    )
    expect(() => parseJobFeedbackEvent(event(7000, [["e", "req"], ["p", pubkey]]))).toThrow(
      Nip90ProtocolError
    )
    expect(() => parseJobFeedbackEvent(event(7000, [
      ["status", "payment-required"],
      ["e", "req"],
      ["p", pubkey],
      ["amount", "-1"],
    ]))).toThrow(Nip90ProtocolError)
  })

  test("round-trips labor job requests with policy, input refs, and acceptance criteria", () => {
    const request = makeLaborJobRequest({
      jobType: "code_task",
      inputRefs: ["work-order.public.issue-123", "repo.public.openagents"],
      acceptanceCriteria: [
        "tests pass",
        "artifact refs are public-safe",
      ],
      expectedArtifacts: [
        {
          ref: "artifact.expected.patch",
          artifactType: "patch",
          mime: "text/x-diff",
        },
      ],
      bid: 25_000,
      relays: ["wss://relay.example.com"],
      serviceProviders: [providerPubkey],
      content: "Fix the scoped issue and return public artifact refs only.",
    })

    expect(request.kind as number).toBe(KIND_JOB_LABOR_CODE_TASK)
    expect(request.policyRef).toBe(PROVIDER_COMPLIANT_USAGE_LABOR_POLICY_REF)
    expect(plainTags(laborJobRequestToTags(request))).toEqual([
      ["i", "work-order.public.issue-123", "text", "", "input_ref"],
      ["i", "repo.public.openagents", "text", "", "input_ref"],
      ["output", "application/json"],
      ["param", "labor_job_type", "code_task"],
      ["param", "policy_ref", PROVIDER_COMPLIANT_USAGE_LABOR_POLICY_REF],
      ["param", "acceptance", "tests pass"],
      ["param", "acceptance", "artifact refs are public-safe"],
      [
        "param",
        "expected_artifact",
        '{"ref":"artifact.expected.patch","artifactType":"patch","mime":"text/x-diff"}',
      ],
      ["bid", "25000"],
      ["relays", "wss://relay.example.com"],
      ["p", providerPubkey],
    ])

    const parsed = parseLaborJobRequestEvent(event(
      KIND_JOB_LABOR_CODE_TASK,
      laborJobRequestToTags(request),
      request.request.content
    ))
    expect(parsed).toEqual(request)
    expect(() => makeLaborJobRequest({
      jobType: "review",
      inputRefs: [],
      acceptanceCriteria: ["review posted"],
    })).toThrow(Nip90ProtocolError)
    expect(() => parseLaborJobRequestEvent(event(KIND_JOB_TEXT_GENERATION, [
      ["i", "not labor", "text"],
    ]))).toThrow(Nip90ProtocolError)
  })

  test("round-trips labor job results with artifact refs and amount", () => {
    const result = makeLaborJobResult({
      jobType: "review",
      requestId: "bb".repeat(32),
      requestRelay: "wss://relay.example.com",
      customerPubkey: pubkey,
      artifactRefs: ["artifact.public.review-123", "receipt.public.acceptance-123"],
      content: '{"summary":"public-safe review complete"}',
      amount: 25_000,
      bolt11: "lnbc250n1...",
    })

    expect(result.result.kind as number).toBe(6935)
    expect(plainTags(laborJobResultToTags(result))).toEqual([
      ["e", "bb".repeat(32), "wss://relay.example.com"],
      ["p", pubkey],
      ["amount", "25000", "lnbc250n1..."],
      ["status", "success"],
      ["labor_job_type", "review"],
      ["policy_ref", PROVIDER_COMPLIANT_USAGE_LABOR_POLICY_REF],
      ["artifact", "artifact.public.review-123"],
      ["artifact", "receipt.public.acceptance-123"],
    ])

    const parsed = parseLaborJobResultEvent(event(
      6935,
      laborJobResultToTags(result),
      result.result.content
    ))
    expect(parsed).toEqual(result)
    expect(() => makeLaborJobResult({
      jobType: "review",
      requestId: "bb".repeat(32),
      customerPubkey: pubkey,
      artifactRefs: [],
      content: "{}",
    })).toThrow(Nip90ProtocolError)
  })

  test("round-trips NIP-DS listing tags and validates required fields", () => {
    const payload = "redacted conversation bundle\n"
    const digest = sha256Hex(payload)
    const listing = makeDatasetListing({
      d: "redacted-conversation-bundle",
      title: "Redacted Conversation Bundle",
      x: digest,
      publishedAt: 1_781_000_000,
      content: "Redacted public-safe transcript bundle.",
      summary: "Public-safe metadata and redacted turns.",
      datasetKind: "conversation_bundle",
      mime: "application/json",
      size: payload.length,
      records: 12,
      license: "seller-license-v1",
      access: "paid",
      delivery: ["nip90", "download"],
      topics: ["dataset", "conversation"],
    })

    expect(plainTags(datasetListingToTags(listing))).toContainEqual(["x", digest])
    expect(verifyDatasetDigest(payload, listing.x)).toBe(true)
    expect(verifyDatasetDigest("different", listing.x)).toBe(false)

    const parsed = parseDatasetListingEvent(event(
      KIND_DATASET_LISTING,
      datasetListingToTags(listing),
      listing.content
    ))
    expect(parsed).toEqual(listing)
    expect(() => parseDatasetListingEvent(event(KIND_DATASET_LISTING, [
      ["d", "missing-digest"],
      ["title", "Missing Digest"],
      ["published_at", "1781000000"],
    ]))).toThrow(Nip90ProtocolError)
    expect(() => makeDatasetListing({
      d: "bad",
      title: "Bad",
      x: "not-a-digest",
      publishedAt: 1,
    })).toThrow(Nip90ProtocolError)
  })

  test("round-trips NIP-DS offers and rejects malformed offers", () => {
    const listingAddress = datasetAddress(pubkey, "redacted-conversation-bundle")
    const buyer = "44".repeat(32)
    const offer = makeDatasetOffer({
      d: "small-sats-offer",
      listing: listingAddress,
      status: "active",
      delivery: ["nip90"],
      content: "Small sats NIP-90 delivery offer.",
      policy: "targeted_request",
      price: ["50", "SAT"],
      payments: [["ln"], ["cashu", "https://mint.example"]],
      buyers: [buyer],
      license: "seller-license-v1",
      topics: ["dataset"],
    })

    expect(plainTags(datasetOfferToTags(offer))).toContainEqual(["a", listingAddress])
    expect(plainTags(datasetOfferToTags(offer))).toContainEqual(["delivery", "nip90"])

    const parsed = parseDatasetOfferEvent(event(
      KIND_DATASET_OFFER,
      datasetOfferToTags(offer),
      offer.content
    ))
    expect(parsed).toEqual(offer)
    expect(() => parseDatasetOfferEvent(event(KIND_DATASET_OFFER, [
      ["d", "bad"],
      ["a", listingAddress],
      ["status", "active"],
    ]))).toThrow(Nip90ProtocolError)
    expect(() => makeDatasetOffer({
      d: "bad",
      listing: "not-an-address",
      status: "active",
      delivery: ["nip90"],
    })).toThrow(Nip90ProtocolError)
  })

  test("builds NIP-DS DVM request/result tags and verifies delivery digest", () => {
    const payload = JSON.stringify({ redacted: true, records: [1, 2, 3] })
    const digest = sha256Hex(payload)
    const listing = datasetAddress(providerPubkey, "redacted-conversation-bundle")
    const offer = datasetOfferAddress(providerPubkey, "small-sats-offer")
    const request = makeDatasetAccessRequest({
      listing,
      offer,
      sellerPubkey: providerPubkey,
      bid: 50_000,
      delivery: "download",
      preview: "metadata_only",
      licenseAck: "seller-license-v1",
      relays: ["wss://relay.example.com"],
    })
    const descriptor = {
      dataset: listing,
      offer,
      delivery: "download" as const,
      ref: "https://download.example/receipt/public-redacted",
      mime: "application/json",
      x: digest,
      license: "seller-license-v1",
    }
    const result = makeDatasetAccessResult({
      requestId: "aa".repeat(32),
      customerPubkey: pubkey,
      listing,
      offer,
      descriptor,
    })

    expect(request.kind as number).toBe(KIND_DATASET_ACCESS_REQUEST)
    expect(plainTags(datasetAccessRequestToTags(request, { listing, offer }))).toContainEqual([
      "a",
      listing,
    ])
    expect(result.kind as number).toBe(6960)
    expect(plainTags(datasetAccessResultToTags(result, { listing, offer, descriptor }))).toContainEqual([
      "x",
      digest,
    ])
    expect(verifyDatasetDeliveryDescriptorDigest(descriptor, payload)).toBe(true)
  })

  test("canonicalizes multi-file dataset manifests deterministically", () => {
    const left = canonicalDatasetManifest([
      { path: "b.json", size: 2, mime: "application/json", x: sha256Hex("b") },
      { path: "a.json", size: 1, mime: "application/json", x: sha256Hex("a") },
    ])
    const right = canonicalDatasetManifest([
      { path: "a.json", size: 1, mime: "application/json", x: sha256Hex("a") },
      { path: "b.json", size: 2, mime: "application/json", x: sha256Hex("b") },
    ])

    expect(left).toBe(right)
    expect(sha256Hex(left)).toMatch(/^[a-f0-9]{64}$/)
  })
})
