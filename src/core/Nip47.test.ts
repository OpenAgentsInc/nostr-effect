/**
 * NIP-47: Nostr Wallet Connect Tests
 */
import { describe, test, expect } from "bun:test"
import {
  parseConnectionString,
  makeNwcRequestEvent,
  makeNwcRequest,
  NWC_REQUEST_KIND,
  NWC_METHODS,
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

      // Verify the encrypted content structure
      expect(event.content).toContain("?iv=")
    })

    test("should create event with correct pubkey from secretKey", () => {
      const pubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")
      const invoice = "lnbc1..."

      const event = makeNwcRequestEvent(pubkey, secretKey, invoice)
      const expectedPubkey = bytesToHex(schnorr.getPublicKey(secretKey))

      expect(event.pubkey as string).toBe(expectedPubkey)
    })
  })

  describe("makeNwcRequest", () => {
    test("should create a get_balance request", () => {
      const pubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")

      const event = makeNwcRequest(pubkey, secretKey, NWC_METHODS.GET_BALANCE)

      expect(event.kind).toBe(NWC_REQUEST_KIND)
      expect(event.tags).toContainEqual(["p", pubkey])
    })

    test("should create a make_invoice request with params", () => {
      const pubkey = "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4"
      const secretKey = hexToBytes("71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c")

      const event = makeNwcRequest(pubkey, secretKey, NWC_METHODS.MAKE_INVOICE, {
        amount: 1000,
        description: "test invoice",
      })

      expect(event.kind).toBe(NWC_REQUEST_KIND)
      expect(event.content).toContain("?iv=")
    })
  })
})
