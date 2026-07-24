/**
 * NIP-29 owned-relay group policy tests (SARAH-CW-01).
 */
import { describe, test, expect } from "vite-plus/test"
import {
  GroupPolicyEngine,
  admitClosedWrite,
  revokeMembershipWithCapabilities,
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_ROLES_KIND,
  GROUP_PUT_USER_KIND,
  GROUP_REMOVE_USER_KIND,
  GROUP_CREATE_GROUP_KIND,
  GROUP_JOIN_REQUEST_KIND,
  GROUP_LEAVE_REQUEST_KIND,
  getHTag,
} from "./Nip29GroupPolicy.js"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "../wrappers/pure.js"

const skRelay = generateSecretKey()
const relayPk = getPublicKey(skRelay)
const skOwner = generateSecretKey()
const ownerPk = getPublicKey(skOwner)
const skMember = generateSecretKey()
const memberPk = getPublicKey(skMember)
const skStranger = generateSecretKey()
const strangerPk = getPublicKey(skStranger)

describe("Nip29GroupPolicy", () => {
  describe("admitClosedWrite helper", () => {
    test("rejects unknown group", () => {
      expect(
        admitClosedWrite({
          groupExists: false,
          isRestricted: true,
          isMember: false,
        })
      ).toEqual({ admit: false, reason: "restricted: group not found" })
    })

    test("rejects non-member on restricted group", () => {
      expect(
        admitClosedWrite({
          groupExists: true,
          isRestricted: true,
          isMember: false,
        }).admit
      ).toBe(false)
    })

    test("admits member on restricted group", () => {
      expect(
        admitClosedWrite({
          groupExists: true,
          isRestricted: true,
          isMember: true,
        })
      ).toEqual({ admit: true })
    })
  })

  describe("createGroup + closed write", () => {
    test("admits closed restricted group and enforces membership on write", () => {
      const engine = new GroupPolicyEngine({
        relayPubkey: relayPk,
        defaultClosed: true,
        defaultRestricted: true,
      })

      const created = engine.createGroup({
        id: "community",
        creatorPubkey: ownerPk,
        roomClass: "community",
        name: "OpenAgents Community",
        isClosed: true,
        isRestricted: true,
      })
      expect(created).toEqual({ admit: true })
      expect(engine.isMember("community", ownerPk)).toBe(true)

      // Owner write with h-tag OK
      const ownerWrite = engine.admitEvent({
        pubkey: ownerPk,
        kind: 1,
        tags: [["h", "community"]],
        content: "hello room",
      })
      expect(ownerWrite).toEqual({ admit: true })

      // Stranger write rejected
      const strangerWrite = engine.admitEvent({
        pubkey: strangerPk,
        kind: 1,
        tags: [["h", "community"]],
        content: "spam",
      })
      expect(strangerWrite.admit).toBe(false)
      if (!strangerWrite.admit) {
        expect(strangerWrite.reason).toContain("membership required")
      }

      // Unknown group rejected
      const unknown = engine.admitEvent({
        pubkey: ownerPk,
        kind: 1,
        tags: [["h", "no-such-group"]],
        content: "x",
      })
      expect(unknown.admit).toBe(false)
    })

    test("events without h-tag are not gated", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({ id: "g", creatorPubkey: ownerPk })
      expect(
        engine.admitEvent({
          pubkey: strangerPk,
          kind: 1,
          tags: [],
          content: "public note",
        })
      ).toEqual({ admit: true })
    })
  })

  describe("membership put/remove + capability revocation", () => {
    test("removeUser clears membership and capability grants in one action", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({ id: "community", creatorPubkey: ownerPk })

      const grantId = "cap:task:42"
      expect(
        engine.putUser({
          groupId: "community",
          pubkey: memberPk,
          roles: ["member"],
          capabilityGrants: [grantId],
        })
      ).toEqual({ admit: true })

      expect(engine.isMember("community", memberPk)).toBe(true)
      expect(engine.hasCapabilityGrant(grantId)).toBe(true)
      expect(engine.capabilityGrantsOf("community", memberPk)).toEqual([
        grantId,
      ])

      // Member can write
      expect(
        engine.admitEvent({
          pubkey: memberPk,
          kind: 1,
          tags: [["h", "community"]],
          content: "ok",
        })
      ).toEqual({ admit: true })

      const rev = engine.removeUser({
        groupId: "community",
        pubkey: memberPk,
      })
      expect(rev.wasMember).toBe(true)
      expect(rev.revokedCapabilityGrants).toEqual([grantId])
      expect(engine.isMember("community", memberPk)).toBe(false)
      expect(engine.hasCapabilityGrant(grantId)).toBe(false)
      expect(engine.capabilityGrantsOf("community", memberPk)).toEqual([])

      // Write ends immediately
      const after = engine.admitEvent({
        pubkey: memberPk,
        kind: 1,
        tags: [["h", "community"]],
        content: "still?",
      })
      expect(after.admit).toBe(false)

      // Pure helper mirrors the same semantics
      const pure = revokeMembershipWithCapabilities({
        pubkey: memberPk,
        roles: ["member"],
        capabilityGrants: [grantId],
      })
      expect(pure.revokedCapabilityGrants).toEqual([grantId])
      expect(pure.remainingGrants).toEqual([])
    })

    test("apply remove-user moderation event revokes immediately", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({ id: "g", creatorPubkey: ownerPk })
      engine.putUser({
        groupId: "g",
        pubkey: memberPk,
        capabilityGrants: ["c1", "c2"],
      })

      const mod = {
        pubkey: ownerPk,
        kind: GROUP_REMOVE_USER_KIND,
        tags: [
          ["h", "g"],
          ["p", memberPk],
        ],
        content: "bye",
      }
      expect(engine.admitEvent(mod)).toEqual({ admit: true })
      const applied = engine.applyEvent(mod)
      expect(applied.applied).toBe(true)
      expect(applied.revocation?.revokedCapabilityGrants).toEqual(["c1", "c2"])
      expect(engine.isMember("g", memberPk)).toBe(false)
      expect(engine.hasCapabilityGrant("c1")).toBe(false)
    })
  })

  describe("relay-signed membership state", () => {
    test("projections are signed by the relay and verify", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({
        id: "community",
        creatorPubkey: ownerPk,
        name: "Community",
        isClosed: true,
        isRestricted: true,
      })
      engine.putUser({
        groupId: "community",
        pubkey: memberPk,
        roles: ["member"],
      })

      const proj = engine.buildRelaySignedProjections("community", 1_700_000_000)
      expect(proj.ok).toBe(true)
      if (!proj.ok) return

      expect(proj.metadata.kind).toBe(GROUP_METADATA_KIND)
      expect(proj.admins.kind).toBe(GROUP_ADMINS_KIND)
      expect(proj.members.kind).toBe(GROUP_MEMBERS_KIND)
      expect(proj.roles.kind).toBe(GROUP_ROLES_KIND)

      const meta = finalizeEvent(proj.metadata, skRelay)
      const admins = finalizeEvent(proj.admins, skRelay)
      const members = finalizeEvent(proj.members, skRelay)

      expect(verifyEvent(meta)).toBe(true)
      expect(verifyEvent(admins)).toBe(true)
      expect(verifyEvent(members)).toBe(true)
      expect(meta.pubkey).toBe(relayPk)
      expect(members.tags.some((t) => t[0] === "p" && t[1] === memberPk)).toBe(
        true
      )
      expect(meta.tags.some((t) => t[0] === "closed")).toBe(true)
      expect(meta.tags.some((t) => t[0] === "restricted")).toBe(true)

      // Client-side check: non-relay author rejected
      const fake = engine.admitEvent({
        pubkey: ownerPk,
        kind: GROUP_MEMBERS_KIND,
        tags: [["d", "community"], ["p", strangerPk]],
        content: "",
      })
      expect(fake.admit).toBe(false)
      if (!fake.admit) {
        expect(fake.reason).toContain("signed by the relay")
      }

      // Relay-signed members accepted
      expect(
        engine.admitEvent({
          pubkey: relayPk,
          kind: GROUP_MEMBERS_KIND,
          tags: members.tags,
          content: "",
        })
      ).toEqual({ admit: true })
    })
  })

  describe("scoped discovery", () => {
    test("never returns a global group directory by default", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({ id: "a", creatorPubkey: ownerPk, name: "A" })
      engine.createGroup({ id: "b", creatorPubkey: ownerPk, name: "B" })

      expect(engine.listDiscoverableGroupIds()).toEqual([])
      expect(
        engine.listDiscoverableGroupIds({ explicitGroupIds: ["a"] })
      ).toEqual(["a"])
    })

    test("hidden groups are omitted for non-members", () => {
      const engine = new GroupPolicyEngine({
        relayPubkey: relayPk,
        scopedDiscovery: false,
      })
      engine.createGroup({
        id: "secret",
        creatorPubkey: ownerPk,
        isHidden: true,
      })
      expect(
        engine.listDiscoverableGroupIds({ viewerPubkey: strangerPk })
      ).toEqual([])
      expect(
        engine.listDiscoverableGroupIds({ viewerPubkey: ownerPk })
      ).toEqual(["secret"])
    })
  })

  describe("two-room isolation (community vs owner-private)", () => {
    test("shared membership is detected and rejected by assertRoomIsolation", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({
        id: "community",
        creatorPubkey: ownerPk,
        roomClass: "community",
      })
      engine.createGroup({
        id: "sarah-private",
        creatorPubkey: ownerPk,
        roomClass: "owner-private",
        isPrivate: true,
        isHidden: true,
      })

      // Owner is creator of both — isolation flags the overlap.
      const isolation = engine.assertRoomIsolation(
        "community",
        "sarah-private"
      )
      expect(isolation.admit).toBe(false)
      if (!isolation.admit) {
        expect(isolation.reason).toContain("must not share membership")
      }

      // Separate membership: remove owner from community, keep private
      engine.removeUser({ groupId: "community", pubkey: ownerPk })
      engine.putUser({
        groupId: "community",
        pubkey: memberPk,
        roles: ["member", "admin"],
      })
      expect(
        engine.assertRoomIsolation("community", "sarah-private")
      ).toEqual({ admit: true })

      // Histories are separate: h-tags differ; no shared group id.
      expect(getHTag({ pubkey: memberPk, kind: 1, tags: [["h", "community"]] })).toBe(
        "community"
      )
      expect(
        getHTag({
          pubkey: ownerPk,
          kind: 1,
          tags: [["h", "sarah-private"]],
        })
      ).toBe("sarah-private")
      expect(engine.isMember("community", ownerPk)).toBe(false)
      expect(engine.isMember("sarah-private", memberPk)).toBe(false)
    })
  })

  describe("join / leave / moderation permissions", () => {
    test("closed group join requires invite code", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({
        id: "g",
        creatorPubkey: ownerPk,
        isClosed: true,
      })
      engine.createInvite("g", "invite-1")

      const bare = {
        pubkey: memberPk,
        kind: GROUP_JOIN_REQUEST_KIND,
        tags: [["h", "g"]],
        content: "",
      }
      expect(engine.admitEvent(bare).admit).toBe(false)

      const withCode = {
        pubkey: memberPk,
        kind: GROUP_JOIN_REQUEST_KIND,
        tags: [
          ["h", "g"],
          ["code", "invite-1"],
        ],
        content: "",
      }
      expect(engine.admitEvent(withCode)).toEqual({ admit: true })
      expect(engine.applyEvent(withCode).applied).toBe(true)
      expect(engine.isMember("g", memberPk)).toBe(true)
      // Invite is single-use
      expect(
        engine.admitEvent({
          pubkey: strangerPk,
          kind: GROUP_JOIN_REQUEST_KIND,
          tags: [
            ["h", "g"],
            ["code", "invite-1"],
          ],
          content: "",
        }).admit
      ).toBe(false)
    })

    test("leave request removes member and grants", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({ id: "g", creatorPubkey: ownerPk })
      engine.putUser({
        groupId: "g",
        pubkey: memberPk,
        capabilityGrants: ["g1"],
      })
      const leave = {
        pubkey: memberPk,
        kind: GROUP_LEAVE_REQUEST_KIND,
        tags: [["h", "g"]],
        content: "",
      }
      expect(engine.admitEvent(leave)).toEqual({ admit: true })
      const applied = engine.applyEvent(leave)
      expect(applied.revocation?.revokedCapabilityGrants).toEqual(["g1"])
      expect(engine.isMember("g", memberPk)).toBe(false)
    })

    test("non-admin cannot put-user", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({ id: "g", creatorPubkey: ownerPk })
      engine.putUser({
        groupId: "g",
        pubkey: memberPk,
        roles: ["member"],
      })
      const mod = {
        pubkey: memberPk,
        kind: GROUP_PUT_USER_KIND,
        tags: [
          ["h", "g"],
          ["p", strangerPk, "member"],
        ],
        content: "",
      }
      expect(engine.admitEvent(mod).admit).toBe(false)
    })

    test("admin put-user is admitted and applied", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      engine.createGroup({ id: "g", creatorPubkey: ownerPk })
      const mod = {
        pubkey: ownerPk,
        kind: GROUP_PUT_USER_KIND,
        tags: [
          ["h", "g"],
          ["p", memberPk, "member"],
        ],
        content: "",
      }
      expect(engine.admitEvent(mod)).toEqual({ admit: true })
      expect(engine.applyEvent(mod).applied).toBe(true)
      expect(engine.isMember("g", memberPk)).toBe(true)
    })

    test("create-group via moderation event", () => {
      const engine = new GroupPolicyEngine({ relayPubkey: relayPk })
      const create = {
        pubkey: relayPk,
        kind: GROUP_CREATE_GROUP_KIND,
        tags: [["h", "new-group"]],
        content: "",
      }
      expect(engine.admitEvent(create)).toEqual({ admit: true })
      expect(engine.applyEvent(create).applied).toBe(true)
      expect(engine.getGroup("new-group")?.deleted).toBe(false)
    })
  })
})
