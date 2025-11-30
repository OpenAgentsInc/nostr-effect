/**
 * Tests for Nip29Service (NIP-29 Relay-based Groups)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { startTestRelay, type RelayHandle } from "../relay/index.js"
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js"
import { EventService, EventServiceLive } from "../services/EventService.js"
import { RelayService, makeRelayService } from "./RelayService.js"
import { Schema } from "@effect/schema"
import { EventKind, Tag } from "../core/Schema.js"
import {
  Nip29Service,
  Nip29ServiceLive,
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  type GroupReference,
  GroupAdminPermission,
} from "./Nip29Service.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

describe("Nip29Service (NIP-29)", () => {
  let relay: RelayHandle
  let port: number

  const groupId = "group-abc"
  const host = () => `ws://localhost:${port}`
  const ref = (): GroupReference => ({ id: groupId, host: host() })

  beforeAll(async () => {
    port = 29000 + Math.floor(Math.random() * 10000)
    relay = await startTestRelay(port)
  })

  afterAll(async () => {
    await Effect.runPromise(relay.stop())
  })

  const baseLayers = Layer.merge(
    CryptoServiceLive,
    EventServiceLive.pipe(Layer.provide(CryptoServiceLive))
  )

  const makeClientLayer = () => makeRelayService({ url: host(), reconnect: false })

  const withNip29 = (inner: Layer.Layer<any>) =>
    Layer.merge(
      inner,
      Nip29ServiceLive
    )

  const publish = (kind: number, tags: string[][], content = "") =>
    Effect.gen(function* () {
      const relaySvc = yield* RelayService
      const crypto = yield* CryptoService
      const events = yield* EventService
      const sk = yield* crypto.generatePrivateKey()
      yield* relaySvc.connect()
      const ev = yield* events.createEvent(
        { kind: decodeKind(kind), content, tags: tags.map((t) => decodeTag(t)) },
        sk
      )
      const ok = yield* relaySvc.publish(ev)
      expect(ok.accepted).toBe(true)
      yield* relaySvc.disconnect()
      return ev
    })

  test("loadGroup reads metadata, admins, and members", async () => {
    const program = Effect.gen(function* () {
      // Publish group metadata
      yield* publish(
        GROUP_METADATA_KIND,
        [
          ["d", groupId],
          ["name", "Cool Group"],
          ["picture", "https://example/image.png"],
          ["about", "A great group"],
          ["public"],
          ["open"],
        ]
      )

      // Publish group admins
      yield* publish(
        GROUP_ADMINS_KIND,
        [
          ["d", groupId],
          ["p", "deadbeef".repeat(8).slice(0, 64), "owner", GroupAdminPermission.CreateGroup],
        ]
      )

      // Publish group members
      yield* publish(
        GROUP_MEMBERS_KIND,
        [
          ["d", groupId],
          ["p", "cafebab0".repeat(8).slice(0, 64), "member"],
        ]
      )

      const svc = yield* Nip29Service
      const group = yield* svc.loadGroup({ groupReference: ref() })

      expect(group.relay).toBe(host())
      expect(group.metadata.id).toBe(groupId)
      expect(group.metadata.name).toBe("Cool Group")
      expect(group.metadata.picture).toBe("https://example/image.png")
      expect(group.metadata.about).toBe("A great group")
      expect(group.metadata.isPublic).toBe(true)
      expect(group.metadata.isOpen).toBe(true)
      expect(group.admins && group.admins.length).toBeGreaterThan(0)
      expect(group.members && group.members.length).toBeGreaterThan(0)
    })

    await Effect.runPromise(
      program.pipe(Effect.provide(withNip29(Layer.merge(makeClientLayer(), baseLayers))))
    )
  })

  test("fetch individual events and parse helpers", async () => {
    const program = Effect.gen(function* () {
      // Ensure metadata exists
      yield* publish(
        GROUP_METADATA_KIND,
        [["d", groupId], ["name", "Solo"], ["public"]]
      )

      const svc = yield* Nip29Service
      const metadataEv = yield* svc.fetchGroupMetadataEvent(ref())
      expect(metadataEv?.kind as number).toBe(GROUP_METADATA_KIND)

      const meta = yield* Effect.succeed(svc.parseGroupMetadataEvent(metadataEv!))
      expect(meta.id).toBe(groupId)
      expect(meta.name).toBeDefined()
      expect(meta.isPublic).toBe(true)

      // Fetch admins/members may be null if not re-published; just assert non-throwing path
      const adminsEv = yield* svc.fetchGroupAdminsEvent(ref())
      if (adminsEv) {
        const admins = svc.parseGroupAdminsEvent(adminsEv)
        expect(Array.isArray(admins)).toBe(true)
      }

      const membersEv = yield* svc.fetchGroupMembersEvent(ref())
      if (membersEv) {
        const members = svc.parseGroupMembersEvent(membersEv)
        expect(Array.isArray(members)).toBe(true)
      }
    })

    await Effect.runPromise(
      program.pipe(Effect.provide(withNip29(Layer.merge(makeClientLayer(), baseLayers))))
    )
  })
})
