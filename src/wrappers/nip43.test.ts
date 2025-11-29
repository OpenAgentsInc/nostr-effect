/**
 * Tests for NIP-43 Relay Access Metadata and Requests
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { RelayService, makeRelayService } from "../client/RelayService.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { buildMembershipList, buildAddMember, buildRemoveMember, buildJoinRequest, buildLeaveRequest, MembershipListKind, AddMemberKind, RemoveMemberKind, JoinRequestKind, LeaveRequestKind } from "./nip43.js"
import { Schema } from "@effect/schema"
import { EventKind, Tag } from "../core/Schema.js"

describe("NIP-43 Relay Access", () => {
  let relay: RelayHandle
  let port: number

  beforeAll(async () => {
    port = 34000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({ url: `ws://localhost:${port}`, reconnect: false })
    const ServiceLayer = Layer.merge(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
    )
    return Layer.merge(RelayLayer, ServiceLayer)
  }

  test("relay membership/admin events verify and publish", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const relaySk = yield* crypto.generatePrivateKey()
      const events = yield* EventService
      const member1 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())
      const member2 = yield* crypto.getPublicKey(yield* crypto.generatePrivateKey())

      // membership list
      const decodeKind = Schema.decodeSync(EventKind)
      const decodeTag = Schema.decodeSync(Tag)
      const K_MEMBERS = decodeKind(MembershipListKind as any)
      const K_ADD = decodeKind(AddMemberKind as any)
      const K_REM = decodeKind(RemoveMemberKind as any)
      const mlTmpl = buildMembershipList({ members: [member1, member2] })
      const ml = yield* events.createEvent({ kind: K_MEMBERS as any, content: mlTmpl.content, tags: mlTmpl.tags.map((t) => decodeTag(t)) }, relaySk)
      expect(ml.kind).toBe(K_MEMBERS)
      const rml = yield* relayService.publish(ml)
      expect(rml.accepted).toBe(false)
      expect(rml.message.includes("auth-required")).toBe(true)

      // add member
      const addTmpl = buildAddMember({ pubkey: member1, content: "welcome" })
      const add = yield* events.createEvent({ kind: K_ADD as any, content: addTmpl.content, tags: addTmpl.tags.map((t) => decodeTag(t)) }, relaySk)
      expect(add.kind).toBe(K_ADD)
      const ra = yield* relayService.publish(add)
      expect(ra.accepted).toBe(false)
      expect(ra.message.includes("auth-required")).toBe(true)

      // remove member
      const remTmpl = buildRemoveMember({ pubkey: member2 })
      const rem = yield* events.createEvent({ kind: K_REM as any, content: remTmpl.content, tags: remTmpl.tags.map((t) => decodeTag(t)) }, relaySk)
      expect(rem.kind).toBe(K_REM)
      const rr = yield* relayService.publish(rem)
      expect(rr.accepted).toBe(false)
      expect(rr.message.includes("auth-required")).toBe(true)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })

  test("client join/leave requests publish and return OK", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService
      const crypto = yield* CryptoService
      yield* relayService.connect()

      const userSk = yield* crypto.generatePrivateKey()
      const events = yield* EventService

      const decodeKind = Schema.decodeSync(EventKind)
      const decodeTag = Schema.decodeSync(Tag)
      const K_JOIN = decodeKind(JoinRequestKind as any)
      const K_LEAVE = decodeKind(LeaveRequestKind as any)
      const joinTmpl = buildJoinRequest({ claim: "INVITE-XYZ" })
      const join = yield* events.createEvent({ kind: K_JOIN as any, content: joinTmpl.content, tags: joinTmpl.tags.map((t) => decodeTag(t)) }, userSk)
      expect(join.kind).toBe(K_JOIN)
      const r1 = yield* relayService.publish(join)
      expect(r1.accepted).toBe(false)
      expect(r1.message.includes("auth-required")).toBe(true)

      const leaveTmpl = buildLeaveRequest({})
      const leave = yield* events.createEvent({ kind: K_LEAVE as any, content: leaveTmpl.content, tags: leaveTmpl.tags.map((t) => decodeTag(t)) }, userSk)
      expect(leave.kind).toBe(K_LEAVE)
      const r2 = yield* relayService.publish(leave)
      expect(r2.accepted).toBe(false)
      expect(r2.message.includes("auth-required")).toBe(true)

      yield* relayService.disconnect()
    })

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())))
  })
})
