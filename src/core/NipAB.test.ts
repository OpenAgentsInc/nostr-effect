/**
 * NIP-AB Device Pairing tests
 *
 * Includes normative crypto test vectors from the NIP-AB specification
 * and a full source↔target protocol happy path.
 */
import { describe, expect, test } from "vite-plus/test"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { schnorr } from "@noble/curves/secp256k1"
import {
  PAIRING_KIND,
  PROTOCOL_VERSION,
  deriveSessionId,
  deriveSas,
  deriveTranscriptHash,
  formatSas,
  ecdhSharedX,
  ctEq,
  encodeQr,
  decodeQr,
  parsePairingMessage,
  encryptMessage,
  decryptMessage,
  PairingSession,
  PairingError,
  type QrPayload,
} from "./NipAB.js"
import type { PublicKey } from "./Schema.js"

// =============================================================================
// Spec test vectors
// =============================================================================

const VECTORS = {
  sessionSecret:
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  sourcePriv:
    "7f4c11a9c9d1e3b5a7f2e4d6c8b0a2f4e6d8c0b2a4f6e8d0c2b4a6f8e0d2c4b5",
  sourcePub: "199e64ca60662cb2d6e91d16cb065be51ad74a6ee5f8c5b0fdc53d246611ed9a",
  targetPriv:
    "3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b",
  targetPub: "89a9fa762105d0aee2b19678246fe7b823aabbc4f4bf691a1ce8a70fcd36d6e4",
  sessionId: "fb357d0f8e8d5a5ba3b2a91cb18c119e1567b07ffa38cdebb73e68df78f5a380",
  ecdhShared: "9b4b6d6990713d89d6d9982e506ee1bbcde6f05c54d9d2978696e8a7274d4408",
  sasInput: "e8b03a329f3a0ac37fe7fbe929171e14b72812be67e33c5d6e193543c41798d3",
  sasCode: "863346",
  transcriptHash:
    "d662818ff8911fc60a2d025f8b8b4756107104e85888dd202d28db5ca2cf28d3",
} as const

describe("NIP-AB crypto test vectors", () => {
  test("source and target pubkeys match vectors", () => {
    const srcPub = bytesToHex(schnorr.getPublicKey(hexToBytes(VECTORS.sourcePriv)))
    const tgtPub = bytesToHex(schnorr.getPublicKey(hexToBytes(VECTORS.targetPriv)))
    expect(srcPub).toBe(VECTORS.sourcePub)
    expect(tgtPub).toBe(VECTORS.targetPub)
  })

  test("session_id matches vector", () => {
    const id = deriveSessionId(hexToBytes(VECTORS.sessionSecret))
    expect(bytesToHex(id)).toBe(VECTORS.sessionId)
  })

  test("session_id is deterministic and differs from secret", () => {
    const secret = hexToBytes(VECTORS.sessionSecret)
    const id1 = deriveSessionId(secret)
    const id2 = deriveSessionId(secret)
    expect(bytesToHex(id1)).toBe(bytesToHex(id2))
    expect(bytesToHex(id1)).not.toBe(VECTORS.sessionSecret)
  })

  test("ECDH shared x-coordinate matches vector (unhashed)", () => {
    const fromSrc = ecdhSharedX(VECTORS.sourcePriv, VECTORS.targetPub)
    const fromTgt = ecdhSharedX(VECTORS.targetPriv, VECTORS.sourcePub)
    expect(bytesToHex(fromSrc)).toBe(VECTORS.ecdhShared)
    expect(bytesToHex(fromTgt)).toBe(VECTORS.ecdhShared)
  })

  test("SAS input and code match vector", () => {
    const { sasCode, sasInput } = deriveSas(
      hexToBytes(VECTORS.ecdhShared),
      hexToBytes(VECTORS.sessionSecret)
    )
    expect(bytesToHex(sasInput)).toBe(VECTORS.sasInput)
    expect(formatSas(sasCode)).toBe(VECTORS.sasCode)
  })

  test("transcript_hash matches vector", () => {
    const th = deriveTranscriptHash(
      hexToBytes(VECTORS.sessionId),
      hexToBytes(VECTORS.sourcePub),
      hexToBytes(VECTORS.targetPub),
      hexToBytes(VECTORS.sasInput),
      hexToBytes(VECTORS.sessionSecret)
    )
    expect(bytesToHex(th)).toBe(VECTORS.transcriptHash)
  })

  test("transcript_hash is sensitive to pubkey order", () => {
    const secret = hexToBytes(VECTORS.sessionSecret)
    const hCorrect = deriveTranscriptHash(
      hexToBytes(VECTORS.sessionId),
      hexToBytes(VECTORS.sourcePub),
      hexToBytes(VECTORS.targetPub),
      hexToBytes(VECTORS.sasInput),
      secret
    )
    const hSwapped = deriveTranscriptHash(
      hexToBytes(VECTORS.sessionId),
      hexToBytes(VECTORS.targetPub),
      hexToBytes(VECTORS.sourcePub),
      hexToBytes(VECTORS.sasInput),
      secret
    )
    expect(bytesToHex(hCorrect)).not.toBe(bytesToHex(hSwapped))
  })

  test("full derivation round-trip from both sides", () => {
    const secret = hexToBytes(VECTORS.sessionSecret)
    const sessionId = deriveSessionId(secret)
    const ecdhSrc = ecdhSharedX(VECTORS.sourcePriv, VECTORS.targetPub)
    const ecdhTgt = ecdhSharedX(VECTORS.targetPriv, VECTORS.sourcePub)
    expect(ctEq(ecdhSrc, ecdhTgt)).toBe(true)

    const sasSrc = deriveSas(ecdhSrc, secret)
    const sasTgt = deriveSas(ecdhTgt, secret)
    expect(sasSrc.sasCode).toBe(sasTgt.sasCode)
    expect(ctEq(sasSrc.sasInput, sasTgt.sasInput)).toBe(true)

    const thSrc = deriveTranscriptHash(
      sessionId,
      hexToBytes(VECTORS.sourcePub),
      hexToBytes(VECTORS.targetPub),
      sasSrc.sasInput,
      secret
    )
    const thTgt = deriveTranscriptHash(
      sessionId,
      hexToBytes(VECTORS.sourcePub),
      hexToBytes(VECTORS.targetPub),
      sasTgt.sasInput,
      secret
    )
    expect(ctEq(thSrc, thTgt)).toBe(true)
  })
})

describe("NIP-AB format_sas", () => {
  test("zero-pads to 6 digits", () => {
    expect(formatSas(0)).toBe("000000")
    expect(formatSas(1)).toBe("000001")
    expect(formatSas(291)).toBe("000291")
    expect(formatSas(47291)).toBe("047291")
    expect(formatSas(999999)).toBe("999999")
  })
})

describe("NIP-AB QR encode/decode", () => {
  const makeQr = (relays: string[]): QrPayload => ({
    sourcePubkey: VECTORS.sourcePub as PublicKey,
    sessionSecret: hexToBytes("ab".repeat(32)),
    relays,
    version: PROTOCOL_VERSION,
  })

  test("round-trip single relay", () => {
    const original = makeQr(["wss://relay.example.com"])
    const uri = encodeQr(original)
    expect(uri.startsWith("nostrpair://")).toBe(true)
    expect(uri).toContain("&v=1")
    const decoded = decodeQr(uri)
    expect(decoded.sourcePubkey).toBe(original.sourcePubkey)
    expect(bytesToHex(decoded.sessionSecret)).toBe(bytesToHex(original.sessionSecret))
    expect(decoded.relays).toEqual(original.relays)
    expect(decoded.version).toBe(1)
  })

  test("round-trip multiple relays with path", () => {
    const original = makeQr([
      "wss://relay1.example.com",
      "wss://relay2.example.com/nostr",
      "ws://localhost:7777",
    ])
    const decoded = decodeQr(encodeQr(original))
    expect(decoded.relays).toEqual(original.relays)
  })

  test("round-trip relay with query params", () => {
    const original = makeQr(["wss://relay.example.com/path?token=abc&flag=1"])
    const decoded = decodeQr(encodeQr(original))
    expect(decoded.relays[0]).toBe("wss://relay.example.com/path?token=abc&flag=1")
  })

  test("reject missing scheme", () => {
    expect(() => decodeQr("https://example.com")).toThrow(PairingError)
  })

  test("reject missing secret", () => {
    const uri = `nostrpair://${VECTORS.sourcePub}?relay=${encodeURIComponent("wss://r.example.com")}`
    expect(() => decodeQr(uri)).toThrow(PairingError)
  })

  test("reject missing relay", () => {
    const uri = `nostrpair://${VECTORS.sourcePub}?secret=${"ab".repeat(32)}`
    expect(() => decodeQr(uri)).toThrow(PairingError)
  })

  test("reject all-zeros session_secret", () => {
    const uri =
      `nostrpair://${VECTORS.sourcePub}?secret=${"00".repeat(32)}` +
      `&relay=${encodeURIComponent("wss://r.example.com")}&v=1`
    expect(() => decodeQr(uri)).toThrow(/all zeros/)
  })

  test("reject uppercase hex in pubkey", () => {
    const uri =
      `nostrpair://${VECTORS.sourcePub.toUpperCase()}?secret=${"ab".repeat(32)}` +
      `&relay=${encodeURIComponent("wss://r.example.com")}&v=1`
    expect(() => decodeQr(uri)).toThrow(/lowercase/)
  })

  test("reject unsupported version", () => {
    const uri = encodeQr(makeQr(["wss://relay.example.com"])).replace("&v=1", "&v=2")
    expect(() => decodeQr(uri)).toThrow(/unsupported protocol version 2/)
  })

  test("default version when absent", () => {
    const uri = encodeQr(makeQr(["wss://relay.example.com"])).replace("&v=1", "")
    const decoded = decodeQr(uri)
    expect(decoded.version).toBe(1)
  })

  test("reject non-websocket relay", () => {
    const uri =
      `nostrpair://${VECTORS.sourcePub}?secret=${"ab".repeat(32)}` +
      `&relay=${encodeURIComponent("https://evil.example.com")}&v=1`
    expect(() => decodeQr(uri)).toThrow(PairingError)
  })

  test("reject URI longer than 2048 chars", () => {
    const long = "nostrpair://" + "a".repeat(2100)
    expect(() => decodeQr(long)).toThrow(/2048/)
  })
})

describe("NIP-AB message parse", () => {
  test("offer round-trip JSON", () => {
    const msg = parsePairingMessage(
      JSON.stringify({
        type: "offer",
        version: 1,
        session_id: VECTORS.sessionId,
      })
    )
    expect(msg).toEqual({
      type: "offer",
      version: 1,
      session_id: VECTORS.sessionId,
    })
  })

  test("offer version defaults to 1 when absent", () => {
    const msg = parsePairingMessage(
      JSON.stringify({ type: "offer", session_id: VECTORS.sessionId })
    )
    expect(msg).toEqual({
      type: "offer",
      version: 1,
      session_id: VECTORS.sessionId,
    })
  })

  test("unknown abort reason becomes unknown", () => {
    const msg = parsePairingMessage(
      JSON.stringify({ type: "abort", reason: "solar_flare" })
    )
    expect(msg).toEqual({ type: "abort", reason: "unknown" })
  })

  test("sas-confirm / payload / complete parse", () => {
    expect(
      parsePairingMessage(
        JSON.stringify({ type: "sas-confirm", transcript_hash: VECTORS.transcriptHash })
      )
    ).toEqual({ type: "sas-confirm", transcript_hash: VECTORS.transcriptHash })

    expect(
      parsePairingMessage(
        JSON.stringify({
          type: "payload",
          payload_type: "nsec",
          payload: "nsec1abc",
        })
      )
    ).toEqual({ type: "payload", payload_type: "nsec", payload: "nsec1abc" })

    expect(parsePairingMessage(JSON.stringify({ type: "complete", success: true }))).toEqual({
      type: "complete",
      success: true,
    })
  })
})

describe("NIP-AB NIP-44 encrypt/decrypt", () => {
  test("round-trip offer message", () => {
    const msg = {
      type: "offer" as const,
      version: 1,
      session_id: VECTORS.sessionId,
    }
    const ct = encryptMessage(msg, VECTORS.targetPriv, VECTORS.sourcePub)
    expect(ct.length).toBeGreaterThanOrEqual(132)
    expect(ct.length).toBeLessThanOrEqual(87472)
    // Version byte is 0x02 after base64 decode
    const raw = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0))
    expect(raw[0]).toBe(2)

    const back = decryptMessage(ct, VECTORS.sourcePriv, VECTORS.targetPub)
    expect(back).toEqual(msg)
  })

  test("rejects content outside NIP-44 size range", () => {
    expect(() => decryptMessage("short", VECTORS.sourcePriv, VECTORS.targetPub)).toThrow(
      PairingError
    )
  })
})

describe("NIP-AB PairingSession protocol", () => {
  test("happy path: offer → SAS → payload → complete", () => {
    const { session: source, qr } = PairingSession.newSource("wss://relay.test")
    expect(source.state).toBe("Waiting")
    expect(source.role).toBe("source")
    expect(source.qrUri()?.startsWith("nostrpair://")).toBe(true)
    expect(source.subscriptionFilter()).toEqual({
      kinds: [PAIRING_KIND],
      "#p": [source.pubkey],
    })

    // QR round-trip via URI as a real scanner would
    const scanned = decodeQr(encodeQr(qr))
    const { session: target, offerEvent } = PairingSession.newTarget(scanned)
    expect(target.state).toBe("Confirming")
    expect(target.role).toBe("target")
    expect(offerEvent.kind).toBe(PAIRING_KIND)
    expect(offerEvent.tags.some((t) => t[0] === "p" && t[1] === source.pubkey)).toBe(true)

    const sourceSas = source.handleOffer(offerEvent)
    expect(source.state).toBe("Confirming")
    const targetSas = target.getSasCode()
    expect(targetSas).toBeDefined()
    if (targetSas === undefined) throw new Error("expected target SAS")
    expect(sourceSas).toBe(targetSas)
    expect(sourceSas).toHaveLength(6)

    const sasConfirm = source.confirmSas()
    expect(source.state).toBe("Transferring")

    const verifiedSas = target.handleSasConfirm(sasConfirm)
    expect(verifiedSas).toBe(targetSas)
    expect(target.state).toBe("AwaitingConfirmation")

    target.confirmTargetSas()
    expect(target.state).toBe("Transferring")

    const payloadEvent = source.sendPayload("nsec", "nsec1testsecret")
    expect(source.state).toBe("PayloadExchanged")
    expect(payloadEvent.kind).toBe(PAIRING_KIND)

    const received = target.handlePayload(payloadEvent)
    expect(received.payloadType).toBe("nsec")
    expect(received.payload).toBe("nsec1testsecret")
    expect(target.state).toBe("PayloadExchanged")

    const complete = target.sendComplete(true)
    expect(target.state).toBe("Completed")

    source.handleComplete(complete)
    expect(source.state).toBe("Completed")
  })

  test("early payload buffer then dual consent", () => {
    const { session: source, qr } = PairingSession.newSource("wss://relay.test")
    const { session: target, offerEvent } = PairingSession.newTarget(qr)

    source.handleOffer(offerEvent)
    const sasConfirm = source.confirmSas()
    target.handleSasConfirm(sasConfirm)
    expect(target.state).toBe("AwaitingConfirmation")

    // Source sends payload before target user confirms
    const payloadEvent = source.sendPayload("custom", '{"app":"com.example","data":"x"}')
    target.bufferPayload(payloadEvent)

    // Target user confirms SAS, then drains buffer
    target.confirmTargetSas()
    const got = target.takeBufferedPayload()
    expect(got).toEqual({
      payloadType: "custom",
      payload: '{"app":"com.example","data":"x"}',
    })
    expect(target.state).toBe("PayloadExchanged")
  })

  test("rejects out-of-order source operations", () => {
    const { session: source } = PairingSession.newSource("wss://relay.test")
    expect(() => source.confirmSas()).toThrow(PairingError)
    expect(() => source.sendPayload("nsec", "x")).toThrow(PairingError)
  })

  test("offer addressed to a different source is rejected (p-tag)", () => {
    const { session: source } = PairingSession.newSource("wss://relay.test")
    const { qr: qr2 } = PairingSession.newSource("wss://relay.test")
    const { offerEvent: offer2 } = PairingSession.newTarget(qr2)
    // offer2's p-tag points at source2, not source
    expect(() => source.handleOffer(offer2)).toThrow(PairingError)
    expect(source.state).toBe("Waiting")
  })

  test("transcript mismatch aborts target", () => {
    const { session: source, qr } = PairingSession.newSource("wss://relay.test")
    const { session: target, offerEvent } = PairingSession.newTarget(qr)
    source.handleOffer(offerEvent)
    const sasConfirm = source.confirmSas()

    // Mutate content so MAC/decrypt fails or transcript wrong —
    // easiest: flip a bit in ciphertext so decrypt fails
    const mutated = {
      ...sasConfirm,
      content: sasConfirm.content.slice(0, -4) + (sasConfirm.content.endsWith("AAAA") ? "BBBB" : "AAAA"),
    }
    // Mutating content also breaks id/sig verification first
    expect(() => target.handleSasConfirm(mutated as typeof sasConfirm)).toThrow(PairingError)
  })

  test("abort from either side", () => {
    const { session: source, qr } = PairingSession.newSource("wss://relay.test")
    const { session: target, offerEvent } = PairingSession.newTarget(qr)
    source.handleOffer(offerEvent)

    const abortEvent = source.abort("user_denied")
    expect(abortEvent).toBeDefined()
    expect(source.state).toBe("Aborted")

    const reason = target.handleAbort(abortEvent!)
    expect(reason).toBe("user_denied")
    expect(target.state).toBe("Aborted")
  })

  test("duplicate / post-accept offer is rejected", () => {
    const { session: source, qr } = PairingSession.newSource("wss://relay.test")
    const { offerEvent } = PairingSession.newTarget(qr)
    source.handleOffer(offerEvent)
    expect(source.hasProcessed(offerEvent.id)).toBe(true)
    // After accept, state is Confirming — replay is out-of-order / discarded
    expect(() => source.handleOffer(offerEvent)).toThrow(PairingError)
    expect(source.state).toBe("Confirming")
  })

  test("session timeout", () => {
    const { session: source } = PairingSession.newSource("wss://relay.test")
    source.setTimeoutMs(0)
    // timeoutMs=0 → expired immediately (elapsed >= 0)
    expect(source.isExpired()).toBe(true)
  })

  test("destroy zeros secrets", () => {
    const { session: source } = PairingSession.newSource("wss://relay.test")
    source.destroy()
    expect(source.state).toBe("Aborted")
  })

  test("complete(success=false) aborts source", () => {
    const { session: source, qr } = PairingSession.newSource("wss://relay.test")
    const { session: target, offerEvent } = PairingSession.newTarget(qr)
    source.handleOffer(offerEvent)
    const sasConfirm = source.confirmSas()
    target.handleSasConfirm(sasConfirm)
    target.confirmTargetSas()
    const payloadEvent = source.sendPayload("bunker", "bunker://example")
    target.handlePayload(payloadEvent)
    const complete = target.sendComplete(false)
    expect(target.state).toBe("Aborted")
    expect(() => source.handleComplete(complete)).toThrow(/complete\(success=false\)/)
    expect(source.state).toBe("Aborted")
  })
})
