/**
 * Tests for OwnerAttestationService (NIP-OA: Owner Attestation)
 *
 * Test vectors are from the canonical NIP-OA spec.
 */
import { test, expect, describe } from "vite-plus/test"
import { Effect } from "effect"
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import {
  OwnerAttestationService,
  OwnerAttestationServiceLive,
  Nip0aError,
  authPreimage,
  authTagToArray,
  findAuthTag,
  parseAuthTag,
  parseConditions,
  serializeConditions,
  signAuthTag,
  verifyAuthTag,
  verifyAuthTagForEvent,
  type Conditions,
} from "./OwnerAttestationService.js"

// -----------------------------------------------------------------------------
// Canonical spec vector
// -----------------------------------------------------------------------------

const OWNER_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000001"
const OWNER_PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const AGENT_PUBKEY =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
const VECTOR_CONDITIONS = "kind=1&created_at<1713957000"
const VECTOR_PREIMAGE_SHA256 =
  "08cdecd55af4c28d3801fd69615dcf5cc04fab3bc134b38a840bf157197069a6"
const VECTOR_SIG =
  "8b7df2575caf0a108374f8471722b233c53f9ff827a8b0f91861966c3b9dd5cb2e189eae9f49d72187674c2f5bd244145e10ff86c9f257ffe65a1ee5f108b369"

const vectorTag: ReadonlyArray<string> = [
  "auth",
  OWNER_PUBKEY,
  VECTOR_CONDITIONS,
  VECTOR_SIG,
]

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Run an effect expected to fail, returning the typed error. */
const runFail = <A>(effect: Effect.Effect<A, Nip0aError>): Promise<Nip0aError> =>
  Effect.runPromise(Effect.flip(effect))

const utf8 = new TextEncoder()

describe("OwnerAttestationService", () => {
  // ---------------------------------------------------------------------------
  // Conditions parse / serialize
  // ---------------------------------------------------------------------------

  describe("conditions parse/serialize", () => {
    test("empty string parses to no clauses and round-trips", async () => {
      const clauses = await Effect.runPromise(parseConditions(""))
      expect(clauses).toEqual([])
      expect(serializeConditions([])).toBe("")
    })

    test("parses the vector conditions in order", async () => {
      const clauses = await Effect.runPromise(parseConditions(VECTOR_CONDITIONS))
      expect(clauses).toEqual([
        { _tag: "kind", value: 1 },
        { _tag: "created_at<", value: 1713957000 },
      ])
    })

    test("serialize is the exact inverse of parse (order preserved)", async () => {
      const raw = "created_at>1000&kind=30078&created_at<2000"
      const clauses = await Effect.runPromise(parseConditions(raw))
      expect(serializeConditions(clauses)).toBe(raw)
    })

    test("accepts boundary values kind=0 and created_at>0", async () => {
      const clauses = await Effect.runPromise(parseConditions("kind=0&created_at>0"))
      expect(clauses).toEqual([
        { _tag: "kind", value: 0 },
        { _tag: "created_at>", value: 0 },
      ])
    })

    test("accepts maximum bounded values", async () => {
      const clauses = await Effect.runPromise(
        parseConditions("kind=65535&created_at<4294967295")
      )
      expect(clauses).toEqual([
        { _tag: "kind", value: 65535 },
        { _tag: "created_at<", value: 4294967295 },
      ])
    })

    const rejects: ReadonlyArray<readonly [string, string]> = [
      ["trailing delimiter", "kind=1&"],
      ["leading delimiter", "&kind=1"],
      ["double delimiter", "kind=1&&kind=2"],
      ["leading zero", "kind=01"],
      ["whitespace", "kind=1 "],
      ["internal whitespace", "kind=1& created_at<2"],
      ["unsupported clause", "foo=1"],
      ["kind out of range", "kind=65536"],
      ["timestamp out of range", "created_at<4294967296"],
      ["missing value", "kind="],
      ["negative", "kind=-1"],
      ["non-decimal value", "kind=1a"],
      ["bare word", "kind"],
    ]

    for (const [name, input] of rejects) {
      test(`rejects ${name}: ${JSON.stringify(input)}`, async () => {
        const err = await runFail(parseConditions(input))
        expect(err).toBeInstanceOf(Nip0aError)
        expect(err.reason).toBe("malformed_tag")
      })
    }
  })

  // ---------------------------------------------------------------------------
  // Canonical spec vector
  // ---------------------------------------------------------------------------

  describe("spec vector", () => {
    test("owner secret derives the vector owner pubkey", () => {
      const derived = bytesToHex(
        schnorr.getPublicKey(
          Uint8Array.from(Buffer.from(OWNER_SECKEY, "hex"))
        )
      )
      expect(derived).toBe(OWNER_PUBKEY)
    })

    test("preimage uses the agent (target) key and matches the vector hash", () => {
      const preimage = authPreimage(AGENT_PUBKEY, VECTOR_CONDITIONS)
      expect(preimage).toBe(
        `nostr:agent-auth:${AGENT_PUBKEY}:${VECTOR_CONDITIONS}`
      )
      expect(bytesToHex(sha256(utf8.encode(preimage)))).toBe(
        VECTOR_PREIMAGE_SHA256
      )
    })

    test("the vector signature verifies for the agent key", async () => {
      const ok = await Effect.runPromise(verifyAuthTag(vectorTag, AGENT_PUBKEY))
      expect(ok).toBe(true)
    })

    test("the vector tag verifies against the vector event", async () => {
      const ok = await Effect.runPromise(
        verifyAuthTagForEvent(vectorTag, {
          pubkey: AGENT_PUBKEY,
          kind: 1,
          created_at: 1713956400,
        })
      )
      expect(ok).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Sign / verify round-trip
  // ---------------------------------------------------------------------------

  describe("sign/verify round-trip", () => {
    test("owner-signed tag verifies for the agent key", async () => {
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, VECTOR_CONDITIONS, OWNER_SECKEY)
      )
      expect(tag.ownerPubkey).toBe(OWNER_PUBKEY)
      expect(tag.conditions).toBe(VECTOR_CONDITIONS)
      const ok = await Effect.runPromise(
        verifyAuthTag(authTagToArray(tag), AGENT_PUBKEY)
      )
      expect(ok).toBe(true)
    })

    test("signs the exact conditions string without normalizing it", async () => {
      const raw = "created_at>1000&kind=1&created_at<2000"
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, raw, OWNER_SECKEY)
      )
      expect(tag.conditions).toBe(raw)
      const ok = await Effect.runPromise(
        verifyAuthTag(authTagToArray(tag), AGENT_PUBKEY)
      )
      expect(ok).toBe(true)
    })

    test("empty conditions round-trip", async () => {
      const tag = await Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, "", OWNER_SECKEY)
      )
      expect(tag.conditions).toBe("")
      const ok = await Effect.runPromise(
        verifyAuthTag(authTagToArray(tag), AGENT_PUBKEY)
      )
      expect(ok).toBe(true)
    })

    test("sign rejects malformed conditions", async () => {
      const err = await runFail(signAuthTag(AGENT_PUBKEY, "kind=01", OWNER_SECKEY))
      expect(err.reason).toBe("malformed_tag")
    })

    test("sign rejects self-attestation (owner key equals agent key)", async () => {
      const err = await runFail(signAuthTag(OWNER_PUBKEY, "kind=1", OWNER_SECKEY))
      expect(err.reason).toBe("malformed_tag")
    })
  })

  // ---------------------------------------------------------------------------
  // Tamper detection
  // ---------------------------------------------------------------------------

  describe("tamper detection", () => {
    test("a flipped signature byte does not verify", async () => {
      const flipped =
        (VECTOR_SIG[0] === "8" ? "9" : "8") + VECTOR_SIG.slice(1)
      const tag = ["auth", OWNER_PUBKEY, VECTOR_CONDITIONS, flipped]
      const ok = await Effect.runPromise(verifyAuthTag(tag, AGENT_PUBKEY))
      expect(ok).toBe(false)
    })

    test("tampered conditions (same sig) do not verify", async () => {
      const tag = ["auth", OWNER_PUBKEY, "kind=2&created_at<1713957000", VECTOR_SIG]
      const ok = await Effect.runPromise(verifyAuthTag(tag, AGENT_PUBKEY))
      expect(ok).toBe(false)
    })

    test("a different agent key does not verify (preimage mismatch)", async () => {
      // A structurally-valid but different agent key (derived from secret 3).
      const freshAgent = bytesToHex(
        schnorr.getPublicKey(
          Uint8Array.from(
            Buffer.from(
              "0000000000000000000000000000000000000000000000000000000000000003",
              "hex"
            )
          )
        )
      )
      expect(freshAgent).not.toBe(AGENT_PUBKEY)
      const ok = await Effect.runPromise(verifyAuthTag(vectorTag, freshAgent))
      expect(ok).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Malformed tag rejection
  // ---------------------------------------------------------------------------

  describe("malformed tag rejection", () => {
    const badTags: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
      ["too few elements", ["auth", OWNER_PUBKEY, VECTOR_CONDITIONS]],
      [
        "too many elements",
        ["auth", OWNER_PUBKEY, VECTOR_CONDITIONS, VECTOR_SIG, "extra"],
      ],
      ["wrong tag name", ["p", OWNER_PUBKEY, VECTOR_CONDITIONS, VECTOR_SIG]],
      ["short owner key", ["auth", "abc", VECTOR_CONDITIONS, VECTOR_SIG]],
      [
        "uppercase owner key",
        ["auth", OWNER_PUBKEY.toUpperCase(), VECTOR_CONDITIONS, VECTOR_SIG],
      ],
      ["short signature", ["auth", OWNER_PUBKEY, VECTOR_CONDITIONS, "deadbeef"]],
      [
        "malformed conditions",
        ["auth", OWNER_PUBKEY, "kind=1&", VECTOR_SIG],
      ],
    ]

    for (const [name, tag] of badTags) {
      test(`rejects ${name}`, async () => {
        const err = await runFail(parseAuthTag(tag))
        expect(err.reason).toBe("malformed_tag")
      })
    }

    test("verify fails malformed_tag for a self-attestation tag", async () => {
      const tag = ["auth", AGENT_PUBKEY, VECTOR_CONDITIONS, VECTOR_SIG]
      const err = await runFail(verifyAuthTag(tag, AGENT_PUBKEY))
      expect(err.reason).toBe("malformed_tag")
    })
  })

  // ---------------------------------------------------------------------------
  // Condition evaluation against an event (stale window / unsatisfied)
  // ---------------------------------------------------------------------------

  describe("condition evaluation", () => {
    const makeTag = (conditions: string) =>
      Effect.runPromise(
        signAuthTag(AGENT_PUBKEY, conditions, OWNER_SECKEY).pipe(
          Effect.map(authTagToArray)
        )
      )

    test("rejects an event past a created_at< window (stale)", async () => {
      const tag = await makeTag("created_at<1000")
      const err = await runFail(
        verifyAuthTagForEvent(tag, {
          pubkey: AGENT_PUBKEY,
          kind: 1,
          created_at: 1000, // not strictly < 1000
        })
      )
      expect(err.reason).toBe("stale_window")
    })

    test("rejects an event before a created_at> window (stale)", async () => {
      const tag = await makeTag("created_at>2000")
      const err = await runFail(
        verifyAuthTagForEvent(tag, {
          pubkey: AGENT_PUBKEY,
          kind: 1,
          created_at: 2000, // not strictly > 2000
        })
      )
      expect(err.reason).toBe("stale_window")
    })

    test("accepts an event inside the created_at window", async () => {
      const tag = await makeTag("created_at>1000&created_at<2000")
      const ok = await Effect.runPromise(
        verifyAuthTagForEvent(tag, {
          pubkey: AGENT_PUBKEY,
          kind: 1,
          created_at: 1500,
        })
      )
      expect(ok).toBe(true)
    })

    test("rejects a kind mismatch as unsatisfied_condition", async () => {
      const tag = await makeTag("kind=1")
      const err = await runFail(
        verifyAuthTagForEvent(tag, {
          pubkey: AGENT_PUBKEY,
          kind: 7,
          created_at: 1500,
        })
      )
      expect(err.reason).toBe("unsatisfied_condition")
    })

    test("fails bad_signature when the owner signature does not verify", async () => {
      const tag = ["auth", OWNER_PUBKEY, "kind=1", VECTOR_SIG]
      const err = await runFail(
        verifyAuthTagForEvent(tag, {
          pubkey: AGENT_PUBKEY,
          kind: 1,
          created_at: 1500,
        })
      )
      expect(err.reason).toBe("bad_signature")
    })
  })

  // ---------------------------------------------------------------------------
  // findAuthTag
  // ---------------------------------------------------------------------------

  describe("findAuthTag", () => {
    test("returns the single auth tag", async () => {
      const parsed = await Effect.runPromise(
        findAuthTag([["p", OWNER_PUBKEY], vectorTag])
      )
      expect(parsed.ownerPubkey).toBe(OWNER_PUBKEY)
    })

    test("rejects an event with no auth tag", async () => {
      const err = await runFail(findAuthTag([["p", OWNER_PUBKEY]]))
      expect(err.reason).toBe("malformed_tag")
    })

    test("rejects an event with more than one auth tag", async () => {
      const err = await runFail(findAuthTag([vectorTag, vectorTag]))
      expect(err.reason).toBe("malformed_tag")
    })
  })

  // ---------------------------------------------------------------------------
  // Service layer
  // ---------------------------------------------------------------------------

  describe("service layer", () => {
    test("sign and verify through the Context.Service", async () => {
      const program = Effect.gen(function* () {
        const oa = yield* OwnerAttestationService
        const tag = yield* oa.sign(AGENT_PUBKEY, VECTOR_CONDITIONS, OWNER_SECKEY)
        return yield* oa.verify(authTagToArray(tag), AGENT_PUBKEY)
      })
      const ok = await Effect.runPromise(
        program.pipe(Effect.provide(OwnerAttestationServiceLive))
      )
      expect(ok).toBe(true)
    })

    test("verifyForEvent and findTag through the Context.Service", async () => {
      const program = Effect.gen(function* () {
        const oa = yield* OwnerAttestationService
        const tag = yield* oa.findTag([["p", OWNER_PUBKEY], vectorTag])
        return yield* oa.verifyForEvent(authTagToArray(tag), {
          pubkey: AGENT_PUBKEY,
          kind: 1,
          created_at: 1713956400,
        })
      })
      const ok = await Effect.runPromise(
        program.pipe(Effect.provide(OwnerAttestationServiceLive))
      )
      expect(ok).toBe(true)
    })
  })

  // Type-only reference to keep the exported Conditions type used.
  const _conditionsType: Conditions = []
  void _conditionsType
})
