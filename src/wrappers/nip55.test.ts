/**
 * NIP-55: Android Signer wrapper tests
 */
import { describe, test, expect } from "bun:test"
import {
  buildBaseUri,
  buildPayloadUri,
  buildGetPublicKeyIntent,
  buildSignEventIntent,
  buildNip04EncryptIntent,
  buildNip04DecryptIntent,
  buildNip44EncryptIntent,
  buildNip44DecryptIntent,
  parseSignerResults,
} from "./nip55.js"

describe("NIP-55 Android Signer helpers", () => {
  test("buildBaseUri and buildPayloadUri", () => {
    expect(buildBaseUri()).toBe("nostrsigner:")
    expect(buildPayloadUri("{}")).toBe("nostrsigner:{}")
  })

  test("buildGetPublicKeyIntent with permissions", () => {
    const intent = buildGetPublicKeyIntent({ permissions: [{ type: "sign_event", kind: 22242 }, { type: "nip44_decrypt" }] })
    expect(intent.uri).toBe("nostrsigner:")
    expect(intent.extras.type).toBe("get_public_key")
    const perms = JSON.parse(intent.extras.permissions!)
    expect(perms.length).toBe(2)
    expect(perms[0].type).toBe("sign_event")
    expect(perms[0].kind).toBe(22242)
  })

  test("buildSignEventIntent carries event JSON and extras", () => {
    const eventJson = '{"kind":1,"content":"hi","tags":[]}'
    const intent = buildSignEventIntent({ eventJson, current_user: "pubkey", id: "123", package: "com.signer" })
    expect(intent.uri).toBe(`nostrsigner:${eventJson}`)
    expect(intent.extras.type).toBe("sign_event")
    expect(intent.extras.current_user).toBe("pubkey")
    expect(intent.extras.id).toBe("123")
    expect(intent.extras.package).toBe("com.signer")
  })

  test("encrypt/decrypt intent builders include pubkey and id/package when provided", () => {
    const enc = buildNip04EncryptIntent({ plaintext: "hello", pubkey: "aa", current_user: "me", id: "1", package: "com.s" })
    expect(enc.uri).toBe("nostrsigner:hello")
    expect(enc.extras.type).toBe("nip04_encrypt")
    expect(enc.extras.pubkey).toBe("aa")
    expect(enc.extras.id).toBe("1")
    expect(enc.extras.package).toBe("com.s")

    const dec = buildNip44DecryptIntent({ encryptedText: "cipher", pubkey: "bb", current_user: "me2" })
    expect(dec.uri).toBe("nostrsigner:cipher")
    expect(dec.extras.type).toBe("nip44_decrypt")
    expect(dec.extras.pubkey).toBe("bb")
    expect(dec.extras.current_user).toBe("me2")
    const dec04 = buildNip04DecryptIntent({ encryptedText: "cipher2", pubkey: "cc", current_user: "me3" })
    expect(dec04.extras.type).toBe("nip04_decrypt")
    const enc44 = buildNip44EncryptIntent({ plaintext: "hello2", pubkey: "dd", current_user: "me4" })
    expect(enc44.extras.type).toBe("nip44_encrypt")
  })

  test("parseSignerResults returns structured array", () => {
    const payload = [
      { package: "com.s", result: "deadbeef", id: "1" },
      { event: JSON.stringify({ kind: 1 }), id: "2" },
    ]
    const json = JSON.stringify(payload)
    const arr = parseSignerResults(json)
    expect(arr.length).toBe(2)
    expect(arr[0]?.package).toBe("com.s")
    expect(arr[0]?.result).toBe("deadbeef")
    expect(arr[1]?.event).toContain("\"kind\":1")
  })
})
