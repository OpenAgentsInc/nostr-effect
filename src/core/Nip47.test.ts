/**
 * NIP-47: Nostr Wallet Connect Tests
 */
import { describe, test, expect } from "vite-plus/test"
import {
  parseConnectionString,
  makeNwcRequestEvent,
  makeNwcRequest,
  NWC_REQUEST_KIND,
  NWC_METHODS,
  encryptNwcPayload,
  decryptNwcPayload,
  parseNwcEncryptedContent,
  makeHoldInvoiceRequest,
  makeCancelHoldInvoiceRequest,
  makeSettleHoldInvoiceRequest,
  getNwcEncryptionFromTags,
} from "./Nip47.js"
import { hexToBytes, bytesToHex } from "@noble/hashes/utils"
import { schnorr } from "@noble/curves/secp256k1"

describe("NIP-47: Nostr Wallet Connect", () => {
  describe("parseConnectionString", () => {
    test("should parse connection string with double slash", () => {
      const connectionString =
        "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c"

      const connection = parseConnectionString(connectionString)

      expect(connection.pubkey).toBe("b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4")
      expect(connection.relay).toBe("wss://relay.damus.io")
      expect(connection.secret).toBe("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")
    })

    test("should parse connection string with single colon", () => {
      const connectionString =
        "nostr+walletconnect:b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c"

      const connection = parseConnectionString(connectionString)

      expect(connection.pubkey).toBe("b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4")
      expect(connection.relay).toBe("wss://relay.damus.io")
      expect(connection.secret).toBe("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")
    })

    test("should parse connection string with lud16", () => {
      const connectionString =
        "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c&lud16=user%40example.com"

      const connection = parseConnectionString(connectionString)

      expect(connection.lud16).toBe("user@example.com")
    })

    test("should throw on missing relay", () => {
      const connectionString =
        "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c"

      expect(() => parseConnectionString(connectionString)).toThrow("missing relay")
    })

    test("should throw on missing secret", () => {
      const connectionString =
        "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io"

      expect(() => parseConnectionString(connectionString)).toThrow("missing secret")
    })
  })

  describe("makeNwcRequestEvent", () => {
    test("should create a valid NWC request event", () => {
      const pubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")
      const invoice = "lnbc1..."

      const event = makeNwcRequestEvent(pubkey, secretKey, invoice)

      expect(event.kind).toBe(NWC_REQUEST_KIND)
      expect(event.tags).toContainEqual(["p", pubkey])
      expect(event.id).toBeDefined()
      expect(event.sig).toBeDefined()
      expect(event.id.length).toBe(64)
      expect(event.sig.length).toBe(128)

      // Default encryption is NIP-44 v2
      expect(event.content).not.toContain("?iv=")
      expect(event.tags).toContainEqual(["encryption", "nip44_v2"])
    })

    test("should create event with correct pubkey from secretKey", () => {
      const pubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")
      const invoice = "lnbc1..."

      const event = makeNwcRequestEvent(pubkey, secretKey, invoice)
      const expectedPubkey = bytesToHex(schnorr.getPublicKey(secretKey))

      expect(event.pubkey as string).toBe(expectedPubkey)
    })

    test("legacy nip04 encryption when requested", () => {
      const pubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")
      const event = makeNwcRequestEvent(pubkey, secretKey, "lnbc1...", { encryption: "nip04" })
      expect(event.content).toContain("?iv=")
      expect(event.tags.find((t) => t[0] === "encryption")).toBeUndefined()
    })
  })

  describe("makeNwcRequest", () => {
    test("should create a get_balance request", () => {
      const pubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")

      const event = makeNwcRequest(pubkey, secretKey, NWC_METHODS.GET_BALANCE)

      expect(event.kind).toBe(NWC_REQUEST_KIND)
      expect(event.tags).toContainEqual(["p", pubkey])
      expect(event.tags).toContainEqual(["encryption", "nip44_v2"])
    })

    test("should create a make_invoice request with params", () => {
      const pubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")

      const event = makeNwcRequest(pubkey, secretKey, NWC_METHODS.MAKE_INVOICE, {
        amount: 1000,
        description: "test invoice",
      })

      expect(event.kind).toBe(NWC_REQUEST_KIND)
      expect(event.content.length).toBeGreaterThan(0)
      expect(event.content).not.toContain("?iv=")
    })

    test("nip44 encrypt/decrypt roundtrip for request payload", () => {
      const walletPubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")
      const event = makeNwcRequest(walletPubkey, secretKey, NWC_METHODS.GET_BALANCE, {})
      const plaintext = decryptNwcPayload(
        secretKey,
        walletPubkey,
        event.content,
        getNwcEncryptionFromTags(event.tags)
      )
      const parsed = JSON.parse(plaintext)
      expect(parsed.method).toBe("get_balance")
      expect(parsed.params).toEqual({})
    })

    test("parseNwcEncryptedContent roundtrip", () => {
      const walletPubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")
      // Response-shaped: encrypted for wallet pubkey using client secret; client decrypts same way
      const payload = { result_type: "get_balance", result: { balance: 42 } }
      const ciphertext = encryptNwcPayload(secretKey, walletPubkey, JSON.stringify(payload), "nip44_v2")
      const responseEvent = {
        content: ciphertext,
        tags: [["p", bytesToHex(schnorr.getPublicKey(secretKey))], ["encryption", "nip44_v2"]],
        pubkey: walletPubkey,
      }
      const decoded = parseNwcEncryptedContent(responseEvent, secretKey)
      expect(decoded.result_type).toBe("get_balance")
      expect((decoded as any).result.balance).toBe(42)
    })
  })

  describe("hold invoice methods", () => {
    const walletPubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
    const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")

    test("make_hold_invoice request", () => {
      const paymentHash = "a".repeat(64)
      const event = makeHoldInvoiceRequest(walletPubkey, secretKey, {
        amount: 1000,
        description: "hold me",
        payment_hash: paymentHash,
      })
      expect(event.kind).toBe(NWC_REQUEST_KIND)
      const plain = decryptNwcPayload(
        secretKey,
        walletPubkey,
        event.content,
        getNwcEncryptionFromTags(event.tags)
      )
      const body = JSON.parse(plain)
      expect(body.method).toBe("make_hold_invoice")
      expect(body.params.payment_hash).toBe(paymentHash)
      expect(body.params.amount).toBe(1000)
    })

    test("cancel_hold_invoice and settle_hold_invoice", () => {
      const cancel = makeCancelHoldInvoiceRequest(walletPubkey, secretKey, "b".repeat(64))
      const settle = makeSettleHoldInvoiceRequest(walletPubkey, secretKey, "c".repeat(64))
      expect(JSON.parse(decryptNwcPayload(secretKey, walletPubkey, cancel.content, "nip44_v2")).method).toBe(
        "cancel_hold_invoice"
      )
      expect(JSON.parse(decryptNwcPayload(secretKey, walletPubkey, settle.content, "nip44_v2")).method).toBe(
        "settle_hold_invoice"
      )
    })
  })
})
