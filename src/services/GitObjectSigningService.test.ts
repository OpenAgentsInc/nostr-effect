/**
 * Tests for GitObjectSigningService (NIP-GS: Git Object Signing)
 *
 * Test vectors are from the canonical NIP-GS spec.
 */
import { test, expect, describe } from "vite-plus/test"
import { Effect } from "effect"
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import {
  GitObjectSigningService,
  GitObjectSigningServiceLive,
  NipGsError,
  ZERO_AUX_RAND,
  GIT_SIGN_DOMAIN,
  ARMOR_BEGIN,
  ARMOR_END,
  signingHash,
  signingPreimage,
  serializeEnvelope,
  parseEnvelopeJson,
  encodeArmoredSignature,
  parseArmoredSignature,
  armorDecode,
  signGitObject,
  signGitObjectArmored,
  verifyGitObject,
  formatSignStatus,
  formatGoodSigStatus,
  formatBadSigStatus,
  formatErrSigStatus,
  formatUtcDate,
  resolveTrustLevel,
  verifyOwnerAttestation,
  type GitSignatureEnvelope,
} from "./GitObjectSigningService.js"

// -----------------------------------------------------------------------------
// Canonical spec vectors
// -----------------------------------------------------------------------------

const AGENT_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000003"
const AGENT_PUBKEY =
  "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
const OWNER_PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"

const T = 1_700_000_000

const PAYLOAD_HEX = `
7472656520346238323564633634326362366562396130363065353462663839
396436396637636234363130310a617574686f7220546573742055736572
203c74657374406578616d706c652e636f6d3e2031373030303030303030202b
303030300a636f6d6d697474657220546573742055736572203c7465737440
6578616d706c652e636f6d3e2031373030303030303030202b303030300a0a
496e697469616c20636f6d6d6974
`.replace(/\s+/g, "")

const PAYLOAD = hexToBytes(PAYLOAD_HEX)

const EXPECTED_HASH =
  "a11a32173aa35125aaefaad8854f2eda5a144268a4a355905c841f79ff44aa18"

const EXPECTED_SIG =
  "c35062148d95b820068c18ab9cf69a8dd2322c606890366d084df7617570b96b7a1aca0a8fcabb2eb4032ebbdf5b43e6bf8633e0d85bcecce28a9e08705b875f"

const EXPECTED_JSON =
  '{"v":1,"pk":"f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9","sig":"c35062148d95b820068c18ab9cf69a8dd2322c606890366d084df7617570b96b7a1aca0a8fcabb2eb4032ebbdf5b43e6bf8633e0d85bcecce28a9e08705b875f","t":1700000000}'

const EXPECTED_BASE64 =
  "eyJ2IjoxLCJwayI6ImY5MzA4YTAxOTI1OGMzMTA0OTM0NGY4NWY4OWQ1MjI5YjUzMWM4NDU4MzZmOTliMDg2MDFmMTEzYmNlMDM2ZjkiLCJzaWciOiJjMzUwNjIxNDhkOTViODIwMDY4YzE4YWI5Y2Y2OWE4ZGQyMzIyYzYwNjg5MDM2NmQwODRkZjc2MTc1NzBiOTZiN2ExYWNhMGE4ZmNhYmIyZWI0MDMyZWJiZGY1YjQzZTZiZjg2MzNlMGQ4NWJjZWNjZTI4YTllMDg3MDViODc1ZiIsInQiOjE3MDAwMDAwMDB9"

const EXPECTED_ARMOR =
  `-----BEGIN SIGNED MESSAGE-----\n${EXPECTED_BASE64}\n-----END SIGNED MESSAGE-----\n`

// Owner attestation vector
const OA_PREIMAGE_HASH =
  "05113b24677b87bedf6498a3addad720003e6af36820e859a26814f149f5a837"
const OA_SIG =
  "54b97dfd2b7d61c1bc1b5facab9d12a991fe0ac3dcb9044b3176f63bebb6f67340eb0ad866f2d5568b78b58ba234ee9f490f8c41e64a949c200315801520ed25"
const OA_GS_HASH =
  "b61f1658836a4f63a2d2f5d621014a064435dde0765dd9c1dc79c9530fe879f0"
const OA_GS_SIG =
  "15592857980b8656ff50303d86acaffcbda397b9c0bb40aebd2fb87a723e466fdb1a74404d39f9eb7ac220b4f2e061f27523f1af24cbdf991cf42ff9b47034c0"
const OA_JSON =
  '{"v":1,"pk":"f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9","sig":"15592857980b8656ff50303d86acaffcbda397b9c0bb40aebd2fb87a723e466fdb1a74404d39f9eb7ac220b4f2e061f27523f1af24cbdf991cf42ff9b47034c0","t":1700000000,"oa":["79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798","","54b97dfd2b7d61c1bc1b5facab9d12a991fe0ac3dcb9044b3176f63bebb6f67340eb0ad866f2d5568b78b58ba234ee9f490f8c41e64a949c200315801520ed25"]}'

const utf8 = new TextEncoder()

const runFail = <A>(
  effect: Effect.Effect<A, NipGsError>
): Promise<NipGsError> => Effect.runPromise(Effect.flip(effect))

// -----------------------------------------------------------------------------
// Spec vectors
// -----------------------------------------------------------------------------

describe("GitObjectSigningService", () => {
  describe("spec key / payload", () => {
    test("agent secret derives the vector pubkey", () => {
      const derived = bytesToHex(schnorr.getPublicKey(hexToBytes(AGENT_SECKEY)))
      expect(derived).toBe(AGENT_PUBKEY)
    })

    test("payload is 170 bytes and matches the human-readable commit", () => {
      expect(PAYLOAD.length).toBe(170)
      expect(new TextDecoder().decode(PAYLOAD)).toBe(
        "tree 4b825dc642cb6eb9a060e54bf899d69f7cb46101\n" +
          "author Test User <test@example.com> 1700000000 +0000\n" +
          "committer Test User <test@example.com> 1700000000 +0000\n" +
          "\n" +
          "Initial commit"
      )
    })
  })

  describe("signing hash (no oa)", () => {
    test("domain separator is 13 UTF-8 bytes", () => {
      expect(utf8.encode(GIT_SIGN_DOMAIN).length).toBe(13)
      expect(bytesToHex(utf8.encode(GIT_SIGN_DOMAIN))).toBe(
        "6e6f7374723a6769743a76313a"
      )
    })

    test("preimage length is 194 bytes", () => {
      const pre = signingPreimage(PAYLOAD, T)
      expect(pre.length).toBe(194)
    })

    test("matches the vector SHA-256", () => {
      expect(bytesToHex(signingHash(PAYLOAD, T))).toBe(EXPECTED_HASH)
    })
  })

  describe("deterministic signature vector", () => {
    test("sign with zero aux rand matches the vector sig", async () => {
      const envelope = await Effect.runPromise(
        signGitObject(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
          auxRand: ZERO_AUX_RAND,
        })
      )
      expect(envelope.pk).toBe(AGENT_PUBKEY)
      expect(envelope.sig).toBe(EXPECTED_SIG)
      expect(envelope.t).toBe(T)
      expect(envelope.v).toBe(1)
      expect(envelope.oa).toBeUndefined()
    })

    test("canonical JSON matches the vector", async () => {
      const envelope = await Effect.runPromise(
        signGitObject(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
          auxRand: ZERO_AUX_RAND,
        })
      )
      expect(serializeEnvelope(envelope)).toBe(EXPECTED_JSON)
    })

    test("armored output matches the vector", async () => {
      const armored = await Effect.runPromise(
        signGitObjectArmored(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
          auxRand: ZERO_AUX_RAND,
        })
      )
      expect(armored).toBe(EXPECTED_ARMOR)
    })

    test("vector signature verifies", async () => {
      const result = await Effect.runPromise(
        verifyGitObject(PAYLOAD, EXPECTED_ARMOR, {
          signingKey: AGENT_PUBKEY,
        })
      )
      expect(result.valid).toBe(true)
      expect(result.trust).toBe("FULLY")
      expect(result.envelope.sig).toBe(EXPECTED_SIG)
      expect(result.ownerAttestation).toBeUndefined()
    })

    test("trust is UNDEFINED when signingKey does not match", async () => {
      const result = await Effect.runPromise(
        verifyGitObject(PAYLOAD, EXPECTED_ARMOR, {
          signingKey: OWNER_PUBKEY,
        })
      )
      expect(result.valid).toBe(true)
      expect(result.trust).toBe("UNDEFINED")
    })

    test("signing status lines match the vector", async () => {
      const envelope = await Effect.runPromise(
        signGitObject(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
          auxRand: ZERO_AUX_RAND,
        })
      )
      expect(formatSignStatus(envelope)).toBe(
        `[GNUPG:] BEGIN_SIGNING\n[GNUPG:] SIG_CREATED D 8 1 00 ${T} ${AGENT_PUBKEY}\n`
      )
    })

    test("goodsig status lines match the vector (TRUST_FULLY)", () => {
      const envelope: GitSignatureEnvelope = {
        v: 1,
        pk: AGENT_PUBKEY,
        sig: EXPECTED_SIG,
        t: T,
      }
      expect(formatUtcDate(T)).toBe("2023-11-14")
      expect(formatGoodSigStatus(envelope, "FULLY")).toBe(
        `[GNUPG:] NEWSIG\n` +
          `[GNUPG:] GOODSIG ${AGENT_PUBKEY} ${AGENT_PUBKEY}\n` +
          `[GNUPG:] VALIDSIG ${AGENT_PUBKEY} 2023-11-14 ${T} 0 - - - - - ${AGENT_PUBKEY}\n` +
          `[GNUPG:] TRUST_FULLY 0 shell\n`
      )
    })

    test("goodsig status lines with TRUST_UNDEFINED", () => {
      const envelope: GitSignatureEnvelope = {
        v: 1,
        pk: AGENT_PUBKEY,
        sig: EXPECTED_SIG,
        t: T,
      }
      expect(formatGoodSigStatus(envelope, "UNDEFINED")).toContain(
        "TRUST_UNDEFINED 0 shell"
      )
    })
  })

  describe("owner attestation vector", () => {
    const oa = {
      ownerPubkey: OWNER_PUBKEY,
      conditions: "",
      sig: OA_SIG,
    }

    test("NIP-OA preimage hash matches", () => {
      const preimage = `nostr:agent-auth:${AGENT_PUBKEY}:`
      expect(bytesToHex(sha256(utf8.encode(preimage)))).toBe(OA_PREIMAGE_HASH)
    })

    test("owner signature verifies for the agent key", async () => {
      const ok = await Effect.runPromise(
        verifyOwnerAttestation(oa, AGENT_PUBKEY)
      )
      expect(ok).toBe(true)
    })

    test("NIP-GS hash with oa binding matches", () => {
      expect(bytesToHex(signingHash(PAYLOAD, T, oa))).toBe(OA_GS_HASH)
    })

    test("deterministic sign with oa matches the vector", async () => {
      const envelope = await Effect.runPromise(
        signGitObject(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
          auxRand: ZERO_AUX_RAND,
          oa,
        })
      )
      expect(envelope.sig).toBe(OA_GS_SIG)
      expect(serializeEnvelope(envelope)).toBe(OA_JSON)
      expect(envelope.oa).toEqual(oa)
    })

    test("vector with oa verifies end-to-end with valid owner attestation", async () => {
      const armored = encodeArmoredSignature({
        v: 1,
        pk: AGENT_PUBKEY,
        sig: OA_GS_SIG,
        t: T,
        oa,
      })
      const result = await Effect.runPromise(
        verifyGitObject(PAYLOAD, armored, { signingKey: AGENT_PUBKEY })
      )
      expect(result.valid).toBe(true)
      expect(result.ownerAttestation?.present).toBe(true)
      expect(result.ownerAttestation?.valid).toBe(true)
      expect(result.ownerAttestation?.ownerPubkey).toBe(OWNER_PUBKEY)
    })

    test("stripping oa invalidates the NIP-GS signature", async () => {
      // Re-serialize without oa using the oa-bound sig — hash no longer matches
      const stripped: GitSignatureEnvelope = {
        v: 1,
        pk: AGENT_PUBKEY,
        sig: OA_GS_SIG,
        t: T,
      }
      const err = await runFail(verifyGitObject(PAYLOAD, stripped))
      expect(err.reason).toBe("bad_signature")
    })

    test("accepts oa from a 4-element auth tag", async () => {
      const envelope = await Effect.runPromise(
        signGitObject(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
          auxRand: ZERO_AUX_RAND,
          oa: ["auth", OWNER_PUBKEY, "", OA_SIG],
        })
      )
      expect(envelope.sig).toBe(OA_GS_SIG)
    })
  })

  describe("round-trip (random aux)", () => {
    test("sign then verify without oa", async () => {
      const envelope = await Effect.runPromise(
        signGitObject(PAYLOAD, AGENT_SECKEY, { createdAt: T })
      )
      // Non-deterministic: sig should still verify, but not equal the vector
      const result = await Effect.runPromise(
        verifyGitObject(PAYLOAD, encodeArmoredSignature(envelope))
      )
      expect(result.valid).toBe(true)
      expect(result.envelope.pk).toBe(AGENT_PUBKEY)
    })

    test("service layer sign/verify", async () => {
      const program = Effect.gen(function* () {
        const gs = yield* GitObjectSigningService
        const armored = yield* gs.signArmored(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
        })
        return yield* gs.verify(PAYLOAD, armored, {
          signingKey: AGENT_PUBKEY,
        })
      })
      const result = await Effect.runPromise(
        program.pipe(Effect.provide(GitObjectSigningServiceLive))
      )
      expect(result.valid).toBe(true)
      expect(result.trust).toBe("FULLY")
    })
  })

  describe("armor parse", () => {
    test("accepts trailing extra LF after end marker", async () => {
      const withExtra = EXPECTED_ARMOR + "\n"
      const envelope = await Effect.runPromise(parseArmoredSignature(withExtra))
      expect(envelope.sig).toBe(EXPECTED_SIG)
    })

    test("accepts missing final LF", async () => {
      const noFinal = EXPECTED_ARMOR.replace(/\n$/, "")
      const envelope = await Effect.runPromise(parseArmoredSignature(noFinal))
      expect(envelope.sig).toBe(EXPECTED_SIG)
    })

    test("rejects line-wrapped base64", async () => {
      const wrapped =
        `${ARMOR_BEGIN}\n` +
        EXPECTED_BASE64.slice(0, 40) +
        "\n" +
        EXPECTED_BASE64.slice(40) +
        `\n${ARMOR_END}\n`
      const err = await runFail(armorDecode(wrapped))
      expect(err.reason).toBe("malformed_envelope")
    })

    test("rejects missing begin marker", async () => {
      const err = await runFail(
        armorDecode(`NOT-BEGIN\n${EXPECTED_BASE64}\n${ARMOR_END}\n`)
      )
      expect(err.reason).toBe("malformed_envelope")
    })
  })

  describe("envelope malleability / invalid cases", () => {
    test("rejects JSON with spaces", async () => {
      const spaced = EXPECTED_JSON.replace(/:/g, ": ").replace(/,/g, ", ")
      const err = await runFail(parseEnvelopeJson(spaced))
      expect(err.reason).toBe("malformed_envelope")
    })

    test("rejects unknown keys", async () => {
      const withExtra =
        EXPECTED_JSON.slice(0, -1) + ',"x":1}'
      // This also fails canonical form / unknown key
      const err = await runFail(parseEnvelopeJson(withExtra))
      expect(err.reason).toBe("malformed_envelope")
    })

    test("rejects wrong field order", async () => {
      const reordered = `{"pk":"${AGENT_PUBKEY}","v":1,"sig":"${EXPECTED_SIG}","t":${T}}`
      const err = await runFail(parseEnvelopeJson(reordered))
      expect(err.reason).toBe("malformed_envelope")
    })

    test("rejects uppercase hex in pk", async () => {
      const upper = EXPECTED_JSON.replace(AGENT_PUBKEY, AGENT_PUBKEY.toUpperCase())
      const err = await runFail(parseEnvelopeJson(upper))
      expect(err.reason).toBe("malformed_envelope")
    })

    test("rejects v != 1", async () => {
      const v2 = EXPECTED_JSON.replace('"v":1', '"v":2')
      const err = await runFail(parseEnvelopeJson(v2))
      expect(err.reason).toBe("malformed_envelope")
    })

    test("rejects self-attestation oa", async () => {
      const selfOa = {
        ownerPubkey: AGENT_PUBKEY,
        conditions: "",
        sig: OA_SIG,
      }
      const err = await runFail(
        signGitObject(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
          auxRand: ZERO_AUX_RAND,
          oa: selfOa,
        })
      )
      expect(err.reason).toBe("malformed_envelope")
    })

    test("rejects tampered payload (bad signature)", async () => {
      const tampered = new Uint8Array(PAYLOAD)
      tampered[0] = tampered[0]! ^ 0xff
      const err = await runFail(verifyGitObject(tampered, EXPECTED_ARMOR))
      expect(err.reason).toBe("bad_signature")
    })

    test("badsig status helper", () => {
      expect(formatBadSigStatus(AGENT_PUBKEY)).toBe(
        `[GNUPG:] NEWSIG\n[GNUPG:] BADSIG ${AGENT_PUBKEY} ${AGENT_PUBKEY}\n`
      )
    })

    test("errsig status helper with unknown key", () => {
      expect(formatErrSigStatus()).toBe(
        "[GNUPG:] ERRSIG 0000000000000000 0 0 00 0 9\n"
      )
    })

    test("errsig status helper with parseable pk", () => {
      expect(formatErrSigStatus(AGENT_PUBKEY)).toBe(
        `[GNUPG:] ERRSIG ${AGENT_PUBKEY} 0 0 00 0 9\n`
      )
    })
  })

  describe("resolveTrustLevel", () => {
    test("hex match is case-insensitive FULLY", () => {
      expect(resolveTrustLevel(AGENT_PUBKEY, AGENT_PUBKEY.toUpperCase())).toBe(
        "FULLY"
      )
    })

    test("missing key is UNDEFINED", () => {
      expect(resolveTrustLevel(AGENT_PUBKEY)).toBe("UNDEFINED")
    })

    test("mismatched hex is UNDEFINED", () => {
      expect(resolveTrustLevel(AGENT_PUBKEY, OWNER_PUBKEY)).toBe("UNDEFINED")
    })
  })

  describe("owner attestation soft-fail", () => {
    test("valid GS sig with invalid oa owner crypto reports valid:false for oa", async () => {
      // Craft an envelope signed with a structurally valid but wrong owner sig.
      // We must re-sign so the GS hash binds the bad oa.
      const badOa = {
        ownerPubkey: OWNER_PUBKEY,
        conditions: "",
        // flip last nibble of a valid-looking sig (still 128 hex)
        sig: OA_SIG.slice(0, -1) + (OA_SIG.endsWith("5") ? "4" : "5"),
      }
      const envelope = await Effect.runPromise(
        signGitObject(PAYLOAD, AGENT_SECKEY, {
          createdAt: T,
          auxRand: ZERO_AUX_RAND,
          oa: badOa,
        })
      )
      const result = await Effect.runPromise(
        verifyGitObject(PAYLOAD, encodeArmoredSignature(envelope))
      )
      expect(result.valid).toBe(true)
      expect(result.ownerAttestation?.valid).toBe(false)
    })
  })
})
