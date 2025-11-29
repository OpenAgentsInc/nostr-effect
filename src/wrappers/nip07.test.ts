/**
 * Minimal runtime test exercising NIP-07 type shape via a mock provider
 */
import { describe, test, expect } from "bun:test"
import { type WindowNostr } from "./nip07.js"
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "./pure.js"

describe("NIP-07 window.nostr types", () => {
  test("mock provider implements getPublicKey/signEvent/nip44", async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)

    const provider: WindowNostr = {
      async getPublicKey() {
        return pk
      },
      async signEvent(template) {
        return finalizeEvent(template, sk)
      },
      nip44: {
        async encrypt(_pubkey, plaintext) {
          return `enc:${plaintext}`
        },
        async decrypt(_pubkey, ciphertext) {
          return ciphertext.replace(/^enc:/, "")
        },
      },
    }

    const gotPk = await provider.getPublicKey()
    expect(gotPk).toBe(pk)

    const evt = await provider.signEvent({ kind: 1, tags: [], content: "hi", created_at: Math.floor(Date.now() / 1000) })
    expect(evt.pubkey).toBe(pk)
    expect(verifyEvent(evt)).toBe(true)

    const cipher = await provider.nip44!.encrypt(pk, "secret")
    const plain = await provider.nip44!.decrypt(pk, cipher)
    expect(plain).toBe("secret")
  })
})

