/**
 * Tests for NipIAService (NIP-IA: Identity Archival)
 *
 * Spec vectors from ~/work/projects/repos/buzz/docs/nips/NIP-IA.md
 */
import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { schnorr } from "@noble/curves/secp256k1"
import { bytesToHex } from "@noble/hashes/utils"
import {
  NipIAService,
  NipIAServiceLive,
  NipIaError,
  ARCHIVE_REQUEST_KIND,
  UNARCHIVE_REQUEST_KIND,
  ARCHIVED_IDENTITY_KIND,
  UNARCHIVED_IDENTITY_KIND,
  ARCHIVED_IDENTITIES_LIST_KIND,
  buildArchiveRequestTemplate,
  buildUnarchiveRequestTemplate,
  buildArchivedDeltaTemplate,
  buildUnarchivedDeltaTemplate,
  buildArchiveSnapshotTemplate,
  parseArchiveRequest,
  parseArchiveDelta,
  parseArchiveSnapshot,
  verifyRelayProjection,
  verifyRequestBorneOwnerAuth,
  inferConsentPath,
  hasNip70Tag,
} from "./NipIAService.js"
import {
  OwnerAttestationService,
  OwnerAttestationServiceLive,
  authTagToArray,
} from "../services/OwnerAttestationService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import type { NostrEvent, PrivateKey } from "../core/Schema.js"
import {
  ArchiveRequest,
  UnarchiveRequest,
  ArchivedIdentity,
  UnarchivedIdentity,
  ArchivedIdentitiesList,
} from "../wrappers/kinds.js"
import {
  buildArchiveRequest,
  buildUnarchiveRequest,
  buildArchivedIdentity,
  buildUnarchivedIdentity,
  buildArchivedIdentitiesList,
  ArchiveRequestKind,
} from "../wrappers/nipIA.js"

// -----------------------------------------------------------------------------
// Canonical NIP-IA test vectors
// -----------------------------------------------------------------------------

const OWNER_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000001" as PrivateKey
const OWNER_PUBKEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const AGENT_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000002" as PrivateKey
const AGENT_PUBKEY =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
const RELAY_SECKEY =
  "0000000000000000000000000000000000000000000000000000000000000003" as PrivateKey
const RELAY_PUBKEY =
  "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"

const VECTOR_CONDITIONS = "kind=1&created_at<1713957000"
const VECTOR_OA_SIG =
  "8b7df2575caf0a108374f8471722b233c53f9ff827a8b0f91861966c3b9dd5cb2e189eae9f49d72187674c2f5bd244145e10ff86c9f257ffe65a1ee5f108b369"

const VECTOR_AUTH_TAG: ReadonlyArray<string> = [
  "auth",
  OWNER_PUBKEY,
  VECTOR_CONDITIONS,
  VECTOR_OA_SIG,
]

const asEvent = (e: {
  id: string
  pubkey: string
  created_at: number
  kind: number
  content: string
  tags: string[][]
  sig: string
}): NostrEvent => e as unknown as NostrEvent

/** Vector 1 — kind:9035 owner-of-agent archive request */
const VECTOR_9035 = asEvent({
  id: "3eb98c5200ee3b0280471131c0e63b5a3a3b6049a3c51ee4f425e649a45389d8",
  pubkey: OWNER_PUBKEY,
  created_at: 1713956400,
  kind: 9035,
  content: "Archiving zombie agent after rebuild.",
  tags: [
    ["-"],
    ["p", AGENT_PUBKEY],
    ["reason", "bot-rebuilt"],
    ["auth", OWNER_PUBKEY, VECTOR_CONDITIONS, VECTOR_OA_SIG],
  ],
  sig: "28d567e61ecf34625b0fa204c7cc8a00fc11fd3cc21e1408d8493f38e37b08673322b44231b60c37750147ce4bc7589fc068201bdde3f5ada798ec6d2c9cd63b",
})

/** Vector 2 — kind:8002 archived-identity delta */
const VECTOR_8002 = asEvent({
  id: "cf4f9376861f90af3edcfabc8f6363e5e0894f0f1234592663352ec8977c4d86",
  pubkey: RELAY_PUBKEY,
  created_at: 1713956401,
  kind: 8002,
  content: "Archiving zombie agent after rebuild.",
  tags: [
    ["-"],
    ["p", AGENT_PUBKEY],
    ["consent", "owner", OWNER_PUBKEY],
    ["e", VECTOR_9035.id],
    ["reason", "bot-rebuilt"],
  ],
  sig: "109eebd8325285b46b18a0b457be038a360189ab70ff912c4fb0ab73a930c4e99e3bb161e12c4547d190b57a786e97e553f249ab19b24cb076d18361d01e2cf7",
})

/** Vector 3 — kind:13535 snapshot */
const VECTOR_13535 = asEvent({
  id: "263a4e89f569146af145adea1630194a1f35e1290ae08b776d51237012cba9a7",
  pubkey: RELAY_PUBKEY,
  created_at: 1713956402,
  kind: 13535,
  content: "",
  tags: [["-"], ["p", AGENT_PUBKEY]],
  sig: "0e68776627a39432891b75a13f146ba16e92e7864144cf983c01012ea04a4817ddecf57b5f96b10e9a64ba96f0abc544ff5074e360d3f99cf7692d2ac98338ec",
})

/** Vector 4 — kind:9036 self-unarchive */
const VECTOR_9036 = asEvent({
  id: "7415e4d62fa388b791b8cf787f4e5631be45634681d3056da973e0091ed8c05f",
  pubkey: AGENT_PUBKEY,
  created_at: 1713956500,
  kind: 9036,
  content: "I am active again.",
  tags: [["-"], ["p", AGENT_PUBKEY], ["reason", "returned"]],
  sig: "0c941d38a0cea6e8af3d500b3147e61d4f82ac40ce53cd43c2ba7f3b2f51c832bb8c4958f9a3caf673fef4c49d3782c34f83db236e1485c3aa25f159f342a33e",
})

/** Vector 5 — kind:8003 unarchived-identity delta */
const VECTOR_8003 = asEvent({
  id: "a261e4f574669b5097a3d4ac2b7e9ab3185639499206373e5a5420169b7201d2",
  pubkey: RELAY_PUBKEY,
  created_at: 1713956501,
  kind: 8003,
  content: "I am active again.",
  tags: [
    ["-"],
    ["p", AGENT_PUBKEY],
    ["consent", "self", AGENT_PUBKEY],
    ["e", VECTOR_9036.id],
    ["reason", "returned"],
  ],
  sig: "e97904fd39387ab41ff650da344d83b61626a6eaa97cf415648525fff2ae54054339b697f62780b37c8ab7e80f44a169ed23b4b33899510a614f619289fc84ee",
})

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(Effect.flip(effect))

const makeLayers = () => {
  const crypto = CryptoServiceLive
  const events = EventServiceLive.pipe(Layer.provide(crypto))
  const oa = OwnerAttestationServiceLive
  const ia = NipIAServiceLive.pipe(Layer.provide(oa), Layer.provide(events))
  return Layer.mergeAll(crypto, events, oa, ia)
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("NIP-IA kinds constants", () => {
  test("kind numbers match the spec", () => {
    expect(ArchiveRequest).toBe(9035)
    expect(UnarchiveRequest).toBe(9036)
    expect(ArchivedIdentity).toBe(8002)
    expect(UnarchivedIdentity).toBe(8003)
    expect(ArchivedIdentitiesList).toBe(13535)
    expect(ARCHIVE_REQUEST_KIND).toBe(9035)
    expect(UNARCHIVE_REQUEST_KIND).toBe(9036)
    expect(ARCHIVED_IDENTITY_KIND).toBe(8002)
    expect(UNARCHIVED_IDENTITY_KIND).toBe(8003)
    expect(ARCHIVED_IDENTITIES_LIST_KIND).toBe(13535)
    expect(ArchiveRequestKind).toBe(9035)
  })

  test("vector keys derive the advertised pubkeys", () => {
    expect(
      bytesToHex(
        schnorr.getPublicKey(
          Uint8Array.from(Buffer.from(OWNER_SECKEY, "hex"))
        )
      )
    ).toBe(OWNER_PUBKEY)
    expect(
      bytesToHex(
        schnorr.getPublicKey(
          Uint8Array.from(Buffer.from(AGENT_SECKEY, "hex"))
        )
      )
    ).toBe(AGENT_PUBKEY)
    expect(
      bytesToHex(
        schnorr.getPublicKey(
          Uint8Array.from(Buffer.from(RELAY_SECKEY, "hex"))
        )
      )
    ).toBe(RELAY_PUBKEY)
  })
})

describe("NIP-IA request builders", () => {
  test("buildArchiveRequestTemplate includes NIP-70, p, reason, replaced-by", async () => {
    const tmpl = await Effect.runPromise(
      buildArchiveRequestTemplate({
        target: AGENT_PUBKEY,
        content: "Rotated.",
        reason: "rotated",
        replacedBy: OWNER_PUBKEY,
        createdAt: 1713956400,
      })
    )
    expect(tmpl.kind).toBe(9035)
    expect(tmpl.content).toBe("Rotated.")
    expect(tmpl.created_at).toBe(1713956400)
    expect(hasNip70Tag(tmpl.tags)).toBe(true)
    expect(tmpl.tags).toContainEqual(["p", AGENT_PUBKEY])
    expect(tmpl.tags).toContainEqual(["reason", "rotated"])
    expect(tmpl.tags).toContainEqual(["replaced-by", OWNER_PUBKEY])
  })

  test("buildArchiveRequestTemplate attaches OA auth tag", async () => {
    const tmpl = await Effect.runPromise(
      buildArchiveRequestTemplate({
        target: AGENT_PUBKEY,
        reason: "bot-rebuilt",
        authTag: VECTOR_AUTH_TAG,
        createdAt: 1713956400,
      })
    )
    expect(tmpl.tags).toContainEqual([...VECTOR_AUTH_TAG])
  })

  test("rejects replaced-by equal to target", async () => {
    const err = await runFail(
      buildArchiveRequestTemplate({
        target: AGENT_PUBKEY,
        replacedBy: AGENT_PUBKEY,
      })
    )
    expect(err).toBeInstanceOf(NipIaError)
    expect(err.reason).toBe("malformed")
  })

  test("unarchive rejects replaced-by", async () => {
    const err = await runFail(
      buildUnarchiveRequestTemplate({
        target: AGENT_PUBKEY,
        replacedBy: OWNER_PUBKEY,
      })
    )
    expect(err).toBeInstanceOf(NipIaError)
    expect(err.reason).toBe("malformed")
  })

  test("buildUnarchiveRequestTemplate is self-shaped", async () => {
    const tmpl = await Effect.runPromise(
      buildUnarchiveRequestTemplate({
        target: AGENT_PUBKEY,
        content: "I am active again.",
        reason: "returned",
        createdAt: 1713956500,
      })
    )
    expect(tmpl.kind).toBe(9036)
    expect(tmpl.tags).toEqual([
      ["-"],
      ["p", AGENT_PUBKEY],
      ["reason", "returned"],
    ])
  })

  test("Promise wrapper buildArchiveRequest matches template tags", () => {
    const tmpl = buildArchiveRequest({
      target: AGENT_PUBKEY,
      reason: "retired",
      createdAt: 100,
    })
    expect(tmpl.kind).toBe(9035)
    expect(tmpl.tags[0]).toEqual(["-"])
    expect(tmpl.tags[1]).toEqual(["p", AGENT_PUBKEY])
  })
})

describe("NIP-IA delta / snapshot builders", () => {
  test("buildArchivedDeltaTemplate matches vector 2 tag shape", async () => {
    const tmpl = await Effect.runPromise(
      buildArchivedDeltaTemplate({
        target: AGENT_PUBKEY,
        consent: { path: "owner", actorPubkey: OWNER_PUBKEY },
        requestEventId: String(VECTOR_9035.id),
        content: "Archiving zombie agent after rebuild.",
        reason: "bot-rebuilt",
        createdAt: 1713956401,
      })
    )
    expect(tmpl.kind).toBe(8002)
    expect(JSON.stringify(tmpl.tags)).toBe(JSON.stringify(VECTOR_8002.tags))
    expect(tmpl.content).toBe(VECTOR_8002.content)
  })

  test("buildUnarchivedDeltaTemplate matches vector 5 tag shape", async () => {
    const tmpl = await Effect.runPromise(
      buildUnarchivedDeltaTemplate({
        target: AGENT_PUBKEY,
        consent: { path: "self", actorPubkey: AGENT_PUBKEY },
        requestEventId: String(VECTOR_9036.id),
        content: "I am active again.",
        reason: "returned",
        createdAt: 1713956501,
      })
    )
    expect(tmpl.kind).toBe(8003)
    expect(JSON.stringify(tmpl.tags)).toBe(JSON.stringify(VECTOR_8003.tags))
  })

  test("buildArchiveSnapshotTemplate matches vector 3 tag shape", async () => {
    const tmpl = await Effect.runPromise(
      buildArchiveSnapshotTemplate({
        archived: [AGENT_PUBKEY],
        createdAt: 1713956402,
      })
    )
    expect(tmpl.kind).toBe(13535)
    expect(JSON.stringify(tmpl.tags)).toBe(JSON.stringify(VECTOR_13535.tags))
    expect(tmpl.content).toBe("")
  })

  test("wrapper builders succeed for deltas and snapshot", () => {
    expect(
      buildArchivedIdentity({
        target: AGENT_PUBKEY,
        consent: { path: "admin", actorPubkey: OWNER_PUBKEY },
      }).kind
    ).toBe(8002)
    expect(
      buildUnarchivedIdentity({
        target: AGENT_PUBKEY,
        consent: { path: "self", actorPubkey: AGENT_PUBKEY },
      }).kind
    ).toBe(8003)
    expect(
      buildArchivedIdentitiesList({ archived: [AGENT_PUBKEY, OWNER_PUBKEY] })
        .kind
    ).toBe(13535)
    expect(buildUnarchiveRequest({ target: AGENT_PUBKEY }).kind).toBe(9036)
  })
})

describe("NIP-IA parsers (spec vectors)", () => {
  test("parse vector 1 archive request with OA auth", async () => {
    const parsed = await Effect.runPromise(parseArchiveRequest(VECTOR_9035))
    expect(parsed.kind).toBe(9035)
    expect(parsed.actor).toBe(OWNER_PUBKEY)
    expect(parsed.target).toBe(AGENT_PUBKEY)
    expect(parsed.reason).toBe("bot-rebuilt")
    expect(parsed.content).toBe("Archiving zombie agent after rebuild.")
    expect(parsed.authTag?.ownerPubkey).toBe(OWNER_PUBKEY)
    expect(parsed.authTag?.conditions).toBe(VECTOR_CONDITIONS)
    expect(parsed.authTag?.sig).toBe(VECTOR_OA_SIG)
  })

  test("parse vector 2 archive delta", async () => {
    const parsed = await Effect.runPromise(parseArchiveDelta(VECTOR_8002))
    expect(parsed.kind).toBe(8002)
    expect(parsed.relayPubkey).toBe(RELAY_PUBKEY)
    expect(parsed.target).toBe(AGENT_PUBKEY)
    expect(parsed.consent).toEqual({
      path: "owner",
      actorPubkey: OWNER_PUBKEY,
    })
    expect(parsed.requestEventId).toBe(VECTOR_9035.id)
    expect(parsed.reason).toBe("bot-rebuilt")
  })

  test("parse vector 3 snapshot", async () => {
    const parsed = await Effect.runPromise(parseArchiveSnapshot(VECTOR_13535))
    expect(parsed.kind).toBe(13535)
    expect(parsed.archived).toEqual([AGENT_PUBKEY])
    expect(parsed.relayPubkey).toBe(RELAY_PUBKEY)
  })

  test("parse vector 4 self-unarchive request", async () => {
    const parsed = await Effect.runPromise(parseArchiveRequest(VECTOR_9036))
    expect(parsed.kind).toBe(9036)
    expect(parsed.actor).toBe(AGENT_PUBKEY)
    expect(parsed.target).toBe(AGENT_PUBKEY)
    expect(parsed.reason).toBe("returned")
    expect(parsed.authTag).toBeUndefined()
  })

  test("parse vector 5 unarchive delta", async () => {
    const parsed = await Effect.runPromise(parseArchiveDelta(VECTOR_8003))
    expect(parsed.kind).toBe(8003)
    expect(parsed.consent).toEqual({
      path: "self",
      actorPubkey: AGENT_PUBKEY,
    })
    expect(parsed.requestEventId).toBe(VECTOR_9036.id)
  })

  test("rejects missing NIP-70", async () => {
    const bad = asEvent({
      ...VECTOR_9035,
      tags: [["p", AGENT_PUBKEY]],
    })
    const err = await runFail(parseArchiveRequest(bad))
    expect(err).toBeInstanceOf(NipIaError)
    expect(err.reason).toBe("unprotected")
  })

  test("rejects missing p tag", async () => {
    const bad = asEvent({
      ...VECTOR_9035,
      tags: [["-"]],
    })
    const err = await runFail(parseArchiveRequest(bad))
    expect(err.reason).toBe("malformed")
  })

  test("rejects multiple p tags", async () => {
    const bad = asEvent({
      ...VECTOR_9035,
      tags: [["-"], ["p", AGENT_PUBKEY], ["p", OWNER_PUBKEY]],
    })
    const err = await runFail(parseArchiveRequest(bad))
    expect(err.reason).toBe("malformed")
  })

  test("rejects delta without consent", async () => {
    const bad = asEvent({
      ...VECTOR_8002,
      tags: [["-"], ["p", AGENT_PUBKEY]],
    })
    const err = await runFail(parseArchiveDelta(bad))
    expect(err.reason).toBe("malformed")
  })
})

describe("NIP-IA verify relay projections", () => {
  test("accepts deltas and snapshot signed by relay identity", async () => {
    const d = await Effect.runPromise(
      verifyRelayProjection(VECTOR_8002, RELAY_PUBKEY)
    )
    expect(d).toMatchObject({ kind: 8002, target: AGENT_PUBKEY })

    const s = await Effect.runPromise(
      verifyRelayProjection(VECTOR_13535, RELAY_PUBKEY)
    )
    expect(s).toMatchObject({ kind: 13535, archived: [AGENT_PUBKEY] })

    const u = await Effect.runPromise(
      verifyRelayProjection(VECTOR_8003, RELAY_PUBKEY)
    )
    expect(u).toMatchObject({ kind: 8003 })
  })

  test("rejects projection not signed by relay identity", async () => {
    const err = await runFail(
      verifyRelayProjection(VECTOR_8002, OWNER_PUBKEY)
    )
    expect(err).toBeInstanceOf(NipIaError)
    expect(err.reason).toBe("wrong_signer")
  })

  test("rejects user request kinds as projections", async () => {
    const err = await runFail(
      verifyRelayProjection(VECTOR_9035, RELAY_PUBKEY)
    )
    expect(err.reason).toBe("wrong_signer")
  })
})

describe("NIP-IA owner-of-agent OA verification", () => {
  test("vector 1 request-borne OA verifies with target in preimage", async () => {
    const program = Effect.gen(function* () {
      const oa = yield* OwnerAttestationService
      // Signature verifies when agent = target (not the request actor).
      const ok = yield* oa.verify(VECTOR_AUTH_TAG, AGENT_PUBKEY)
      expect(ok).toBe(true)

      const auth = yield* verifyRequestBorneOwnerAuth(
        VECTOR_9035,
        AGENT_PUBKEY,
        oa
      )
      expect(auth.ownerPubkey).toBe(OWNER_PUBKEY)

      const consent = yield* inferConsentPath(VECTOR_9035, oa)
      expect(consent).toEqual({ path: "owner", actorPubkey: OWNER_PUBKEY })
    })
    await Effect.runPromise(
      program.pipe(Effect.provide(OwnerAttestationServiceLive))
    )
  })

  test("OA verify fails closed when preimage uses actor instead of target", async () => {
    const program = Effect.gen(function* () {
      const oa = yield* OwnerAttestationService
      // Wrong agent pubkey: either fails self-attestation (owner==agent) or
      // returns false for a non-matching preimage. Never succeeds.
      return yield* Effect.flip(oa.verify(VECTOR_AUTH_TAG, OWNER_PUBKEY))
    })
    const err = await Effect.runPromise(
      program.pipe(Effect.provide(OwnerAttestationServiceLive))
    )
    expect(err.reason).toBe("malformed_tag")
  })

  test("self-unarchive infers consent=self", async () => {
    const program = Effect.gen(function* () {
      const oa = yield* OwnerAttestationService
      const consent = yield* inferConsentPath(VECTOR_9036, oa)
      expect(consent).toEqual({ path: "self", actorPubkey: AGENT_PUBKEY })
    })
    await Effect.runPromise(
      program.pipe(Effect.provide(OwnerAttestationServiceLive))
    )
  })

  test("rejects owner mismatch on auth tag", async () => {
    const program = Effect.gen(function* () {
      const oa = yield* OwnerAttestationService
      const forged = asEvent({
        id: VECTOR_9035.id,
        pubkey: VECTOR_9035.pubkey,
        created_at: VECTOR_9035.created_at,
        kind: VECTOR_9035.kind,
        content: VECTOR_9035.content,
        sig: VECTOR_9035.sig,
        // actor is still OWNER, but auth names a different owner
        tags: [
          ["-"],
          ["p", AGENT_PUBKEY],
          ["auth", AGENT_PUBKEY, VECTOR_CONDITIONS, VECTOR_OA_SIG],
        ],
      })
      return yield* Effect.flip(
        verifyRequestBorneOwnerAuth(forged, AGENT_PUBKEY, oa)
      )
    })
    const err = await Effect.runPromise(
      program.pipe(Effect.provide(OwnerAttestationServiceLive))
    )
    expect(err).toBeInstanceOf(NipIaError)
    expect((err as NipIaError).reason).toBe("unauthorized")
  })
})

describe("NipIAService live", () => {
  test("createOwnerArchiveRequest attaches OA and is parseable", async () => {
    const program = Effect.gen(function* () {
      const ia = yield* NipIAService
      const event = yield* ia.createOwnerArchiveRequest({
        target: AGENT_PUBKEY,
        content: "Archiving zombie agent after rebuild.",
        reason: "bot-rebuilt",
        ownerSeckey: OWNER_SECKEY,
        // Empty conditions (or time-only) preferred for NIP-IA
        conditions: "",
        createdAt: 1713956400,
      })
      expect(Number(event.kind)).toBe(9035)
      expect(String(event.pubkey)).toBe(OWNER_PUBKEY)

      const parsed = yield* ia.parseArchiveRequest(event)
      expect(parsed.target).toBe(AGENT_PUBKEY)
      expect(parsed.authTag?.ownerPubkey).toBe(OWNER_PUBKEY)
      expect(hasNip70Tag(event.tags)).toBe(true)

      const consent = yield* ia.inferConsentPath(event)
      expect(consent.path).toBe("owner")

      // Full event signature verifies
      const events = yield* EventService
      const ok = yield* events.verifyEvent(event)
      expect(ok).toBe(true)
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("createOwnerArchiveRequest with vector auth tag", async () => {
    const program = Effect.gen(function* () {
      const ia = yield* NipIAService
      const event = yield* ia.createOwnerArchiveRequest({
        target: AGENT_PUBKEY,
        content: "Archiving zombie agent after rebuild.",
        reason: "bot-rebuilt",
        ownerSeckey: OWNER_SECKEY,
        authTag: VECTOR_AUTH_TAG,
        createdAt: 1713956400,
      })
      // tags/content/kind/pubkey/created_at match vector
      expect(Number(event.kind)).toBe(Number(VECTOR_9035.kind))
      expect(String(event.pubkey)).toBe(String(VECTOR_9035.pubkey))
      expect(Number(event.created_at)).toBe(Number(VECTOR_9035.created_at))
      expect(event.content).toBe(VECTOR_9035.content)
      expect([...event.tags]).toEqual([...VECTOR_9035.tags])

      const events = yield* EventService
      // Recompute id must match the vector id (serialization is deterministic)
      const id = yield* events.computeEventId(
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content
      )
      expect(String(id)).toBe(String(VECTOR_9035.id))
      expect(String(event.id)).toBe(String(VECTOR_9035.id))

      const consent = yield* ia.inferConsentPath(event)
      expect(consent).toEqual({ path: "owner", actorPubkey: OWNER_PUBKEY })
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("self archive + unarchive + relay delta/snapshot pipeline", async () => {
    const program = Effect.gen(function* () {
      const ia = yield* NipIAService
      const events = yield* EventService
      const crypto = yield* CryptoService

      const replacement = yield* crypto.getPublicKey(
        yield* crypto.generatePrivateKey()
      )

      const archiveReq = yield* ia.createArchiveRequest(
        {
          target: AGENT_PUBKEY,
          content: "Rotated to my new key.",
          reason: "rotated",
          replacedBy: String(replacement),
          createdAt: 1713956400,
        },
        AGENT_SECKEY
      )
      expect(String(archiveReq.pubkey)).toBe(AGENT_PUBKEY)
      const selfConsent = yield* ia.inferConsentPath(archiveReq)
      expect(selfConsent.path).toBe("self")

      const delta = yield* ia.createArchivedDelta(
        {
          target: AGENT_PUBKEY,
          consent: { path: "self", actorPubkey: AGENT_PUBKEY },
          requestEventId: String(archiveReq.id),
          content: archiveReq.content,
          reason: "rotated",
          replacedBy: String(replacement),
          createdAt: 1713956401,
        },
        RELAY_SECKEY
      )
      expect(String(delta.pubkey)).toBe(RELAY_PUBKEY)
      expect(yield* events.verifyEvent(delta)).toBe(true)

      const snap = yield* ia.createArchiveSnapshot(
        { archived: [AGENT_PUBKEY], createdAt: 1713956402 },
        RELAY_SECKEY
      )
      const verifiedSnap = yield* ia.verifyRelayProjection(
        snap,
        RELAY_PUBKEY
      )
      expect(verifiedSnap).toMatchObject({
        kind: 13535,
        archived: [AGENT_PUBKEY],
      })

      const unarchiveReq = yield* ia.createUnarchiveRequest(
        {
          target: AGENT_PUBKEY,
          content: "I am active again.",
          reason: "returned",
          createdAt: 1713956500,
        },
        AGENT_SECKEY
      )
      expect(Number(unarchiveReq.kind)).toBe(9036)

      // Match vector 4 tags exactly
      expect([...unarchiveReq.tags]).toEqual([...VECTOR_9036.tags])
      expect(String(unarchiveReq.id)).toBe(String(VECTOR_9036.id))

      const undelta = yield* ia.createUnarchivedDelta(
        {
          target: AGENT_PUBKEY,
          consent: { path: "self", actorPubkey: AGENT_PUBKEY },
          requestEventId: String(unarchiveReq.id),
          content: unarchiveReq.content,
          reason: "returned",
          createdAt: 1713956501,
        },
        RELAY_SECKEY
      )
      expect([...undelta.tags]).toEqual([...VECTOR_8003.tags])
      expect(String(undelta.id)).toBe(String(VECTOR_8003.id))

      const emptySnap = yield* ia.createArchiveSnapshot(
        { archived: [], createdAt: 1713956502 },
        RELAY_SECKEY
      )
      const parsedEmpty = yield* ia.parseArchiveSnapshot(emptySnap)
      expect(parsedEmpty.archived).toEqual([])
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })

  test("authTagToArray round-trips with OwnerAttestationService.sign", async () => {
    const program = Effect.gen(function* () {
      const oa = yield* OwnerAttestationService
      const ia = yield* NipIAService
      const auth = yield* oa.sign(AGENT_PUBKEY, "created_at<1713957000", OWNER_SECKEY)
      const event = yield* ia.createArchiveRequest(
        {
          target: AGENT_PUBKEY,
          authTag: auth,
          createdAt: 1713956390,
        },
        OWNER_SECKEY
      )
      expect(event.tags.some((t) => t[0] === "auth")).toBe(true)
      expect(authTagToArray(auth)).toEqual([
        "auth",
        auth.ownerPubkey,
        auth.conditions,
        auth.sig,
      ])
      const verified = yield* ia.verifyRequestBorneOwnerAuth(event, AGENT_PUBKEY)
      expect(verified.ownerPubkey).toBe(OWNER_PUBKEY)
    })
    await Effect.runPromise(program.pipe(Effect.provide(makeLayers())))
  })
})
