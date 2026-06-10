import { describe, expect, test } from "bun:test"
import type { NostrEvent } from "./Schema.js"
import {
  KIND_JOB_FEEDBACK,
  KIND_JOB_TEXT_GENERATION,
  KIND_RESULT_RLM_SUBQUERY,
  Nip90ProtocolError,
  createJobFeedbackEvent,
  createJobRequestEvent,
  createJobResultEvent,
  eventMatchesRequest,
  getRequestKind,
  getResultKind,
  inputFromTag,
  inputToTag,
  isDvmKind,
  isJobFeedbackKind,
  isJobRequestKind,
  isJobResultKind,
  jobFeedbackToTags,
  jobInput,
  jobParam,
  jobRequestToTags,
  jobResultToTags,
  makeJobFeedback,
  makeJobRequest,
  makeJobResult,
  paramFromTag,
  paramToTag,
  parseInputType,
  parseJobFeedbackEvent,
  parseJobRequestEvent,
  parseJobResultEvent,
  parseJobStatus,
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
})
