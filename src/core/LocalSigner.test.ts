/**
 * LocalKeySigner / LocalSignerPort tests (OpenAgents #9092 Phase B)
 */
import { describe, test, expect } from "vite-plus/test"
import { LocalKeySigner } from "./LocalSigner.js"
import { privateKeyFromSeedWords } from "./Nip06.js"
import { getPublicKey, verifyEvent } from "../wrappers/pure.js"
import { unpackEventFromToken, verifyHttpAuthEvent } from "./Nip98.js"

const FIXTURE_MNEMONIC = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"

describe("LocalKeySigner", () => {
  const sk = privateKeyFromSeedWords(FIXTURE_MNEMONIC, "", 0)

  test("fromPrivateKey exposes public identity only via manifest", async () => {
    const signer = LocalKeySigner.fromPrivateKey(sk, {
      accountPath: "m/44'/1237'/0'/0/0",
      profileId: "test",
    })
    expect(await signer.getPublicKey()).toBe(getPublicKey(sk))
    expect(signer.npub.startsWith("npub1")).toBe(true)
    const m = signer.toPublicManifest()
    expect(m.pubkey).toBe(signer.publicKey)
    expect(m.npub).toBe(signer.npub)
    expect(m.accountPath).toBe("m/44'/1237'/0'/0/0")
    expect(JSON.stringify(signer)).toContain("npub")
    expect(JSON.stringify(signer)).not.toContain("c26cf31d") // no private hex
  })

  test("signEvent produces verifiable event", async () => {
    const signer = LocalKeySigner.fromPrivateKey(sk)
    const event = await signer.signEvent({
      kind: 1,
      content: "hello identity",
      tags: [],
    })
    expect(event.pubkey).toBe(await signer.getPublicKey())
    expect(verifyEvent(event)).toBe(true)
  })

  test("nip44 roundtrip between two signers", async () => {
    const a = LocalKeySigner.fromPrivateKey(privateKeyFromSeedWords(FIXTURE_MNEMONIC, "", 0))
    const b = LocalKeySigner.fromPrivateKey(privateKeyFromSeedWords(FIXTURE_MNEMONIC, "", 1))
    const ciphertext = await a.nip44Encrypt(await b.getPublicKey(), "secret message")
    const plain = await b.nip44Decrypt(await a.getPublicKey(), ciphertext)
    expect(plain).toBe("secret message")
  })

  test("createHttpAuthToken is verifiable", async () => {
    const signer = LocalKeySigner.fromPrivateKey(sk)
    const token = await signer.createHttpAuthToken("https://local.test/v1", "GET", {
      includeAuthorizationScheme: true,
    })
    expect(token.startsWith("Nostr ")).toBe(true)
    const event = await unpackEventFromToken(token)
    expect(verifyHttpAuthEvent(event)).toBe(true)
    expect(event.pubkey as string).toBe(await signer.getPublicKey())
  })

  test("dispose zeros key and blocks further use", async () => {
    const signer = LocalKeySigner.fromPrivateKey(sk)
    signer.dispose()
    await expect(signer.getPublicKey()).rejects.toThrow(/disposed/)
    await expect(
      signer.signEvent({ kind: 1, content: "x", tags: [] })
    ).rejects.toThrow(/disposed/)
  })

  test("toString does not leak secret key hex", () => {
    const signer = LocalKeySigner.fromPrivateKey(sk)
    const s = String(signer)
    expect(s).toContain("npub1")
    expect(s).not.toContain("c26cf31d8ba425b555ca27d00ca71b5008004f2f662470f8c8131822ec129fe2")
  })

  test("rejects wrong key length", () => {
    expect(() => LocalKeySigner.fromPrivateKey(new Uint8Array(16))).toThrow(/32-byte/)
  })
})
