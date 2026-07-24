/**
 * NIP-29 module + owned-relay group policy integration tests (SARAH-CW-01).
 */
import { describe, test, expect } from "vite-plus/test"
import { Effect } from "effect"
import {
  Nip29Module,
  createNip29GroupPolicyModule,
} from "./Nip29Module.js"
import { NipRegistry, NipRegistryLive } from "../NipRegistry.js"
import { DefaultModules } from "./index.js"
import {
  Accept,
  type PolicyDecision,
  type PolicyContext,
} from "../../policy/Policy.js"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "../../../../wrappers/pure.js"
import type { NipModule } from "../NipModule.js"

const skRelay = generateSecretKey()
const relayPk = getPublicKey(skRelay)
const skOwner = generateSecretKey()
const ownerPk = getPublicKey(skOwner)
const skMember = generateSecretKey()
const memberPk = getPublicKey(skMember)
const skStranger = generateSecretKey()
const strangerPk = getPublicKey(skStranger)

const asEvent = (partial: {
  pubkey: string
  kind: number
  tags: string[][]
  content?: string
}): PolicyContext["event"] =>
  ({
    id: "0".repeat(64),
    sig: "0".repeat(128),
    created_at: 1_700_000_000,
    content: partial.content ?? "",
    ...partial,
  }) as unknown as PolicyContext["event"]

const runPolicy = async (
  mod: NipModule,
  event: PolicyContext["event"]
): Promise<PolicyDecision> => {
  const policy = mod.policies[0]
  if (!policy) return Accept
  return Effect.runPromise(
    policy({ event, connectionId: "c1", remoteAddress: undefined }) as Effect.Effect<PolicyDecision>
  )
}

describe("Nip29Module", () => {
  test("default module advertises NIP-29 kinds including leave 9022", () => {
    expect(Nip29Module.id).toBe("nip-29")
    expect(Nip29Module.nips).toContain(29)
    expect(Nip29Module.kinds).toContain(39000)
    expect(Nip29Module.kinds).toContain(9021)
    expect(Nip29Module.kinds).toContain(9022)
    expect(Nip29Module.policies).toEqual([])
  })

  test("DefaultModules includes Nip29Module", () => {
    expect(DefaultModules.some((m) => m.id === "nip-29")).toBe(true)
  })
})

describe("createNip29GroupPolicyModule", () => {
  test("seed group + membership write enforcement via policy", async () => {
    const { module, controller } = createNip29GroupPolicyModule({
      relayPubkey: relayPk,
      seedGroups: [
        {
          id: "openagents-community",
          creatorPubkey: ownerPk,
          roomClass: "community",
          name: "OpenAgents Community",
          isClosed: true,
          isRestricted: true,
        },
      ],
    })

    expect(module.id).toBe("nip-29-group-policy")
    expect(module.nips).toContain(29)
    expect(module.kinds).toEqual([]) // all events

    // Owner (seeded) can write
    const ownerOk = await runPolicy(
      module,
      asEvent({
        pubkey: ownerPk,
        kind: 1,
        tags: [["h", "openagents-community"]],
        content: "hi",
      })
    )
    expect(ownerOk).toEqual({ _tag: "Accept" })

    // Stranger cannot write
    const stranger = await runPolicy(
      module,
      asEvent({
        pubkey: strangerPk,
        kind: 1,
        tags: [["h", "openagents-community"]],
        content: "nope",
      })
    )
    expect(stranger._tag).toBe("Reject")
    if (stranger._tag === "Reject") {
      expect(stranger.reason).toContain("membership required")
    }

    // Add member via controller, then write OK
    controller.putUser({
      groupId: "openagents-community",
      pubkey: memberPk,
      roles: ["member"],
      capabilityGrants: ["grant:1"],
    })
    const memberOk = await runPolicy(
      module,
      asEvent({
        pubkey: memberPk,
        kind: 1,
        tags: [["h", "openagents-community"]],
        content: "joined",
      })
    )
    expect(memberOk).toEqual({ _tag: "Accept" })

    // Immediate revocation
    const rev = controller.removeUser({
      groupId: "openagents-community",
      pubkey: memberPk,
    })
    expect(rev.revokedCapabilityGrants).toEqual(["grant:1"])
    expect(controller.hasCapabilityGrant("grant:1")).toBe(false)
    expect(controller.isMember("openagents-community", memberPk)).toBe(false)

    const after = await runPolicy(
      module,
      asEvent({
        pubkey: memberPk,
        kind: 1,
        tags: [["h", "openagents-community"]],
        content: "still?",
      })
    )
    expect(after._tag).toBe("Reject")
  })

  test("preStoreHook applies put-user and remove-user", async () => {
    const { module, controller } = createNip29GroupPolicyModule({
      relayPubkey: relayPk,
      seedGroups: [
        {
          id: "g",
          creatorPubkey: ownerPk,
        },
      ],
    })

    const put = asEvent({
      pubkey: ownerPk,
      kind: 9000,
      tags: [
        ["h", "g"],
        ["p", memberPk, "member"],
      ],
    })
    const putResult = await Effect.runPromise(module.preStoreHook!(put))
    expect(putResult.action).toBe("store")
    expect(controller.isMember("g", memberPk)).toBe(true)

    // Bind a grant, then remove via moderation event
    controller.putUser({
      groupId: "g",
      pubkey: memberPk,
      capabilityGrants: ["cap:x"],
    })
    const remove = asEvent({
      pubkey: ownerPk,
      kind: 9001,
      tags: [
        ["h", "g"],
        ["p", memberPk],
      ],
    })
    const removeResult = await Effect.runPromise(module.preStoreHook!(remove))
    expect(removeResult.action).toBe("store")
    expect(controller.isMember("g", memberPk)).toBe(false)
    const drained = controller.drainLastRevocation()
    expect(drained?.revokedCapabilityGrants).toContain("cap:x")
  })

  test("relay-signed membership projections verify for clients", () => {
    const { controller } = createNip29GroupPolicyModule({
      relayPubkey: relayPk,
      seedGroups: [
        {
          id: "community",
          creatorPubkey: ownerPk,
          name: "Community",
          isClosed: true,
          isRestricted: true,
        },
      ],
    })
    controller.putUser({
      groupId: "community",
      pubkey: memberPk,
      roles: ["member"],
    })

    const proj = controller.buildRelaySignedProjections("community")
    expect(proj.ok).toBe(true)
    if (!proj.ok) return

    const members = finalizeEvent(proj.members, skRelay)
    const metadata = finalizeEvent(proj.metadata, skRelay)
    expect(verifyEvent(members)).toBe(true)
    expect(verifyEvent(metadata)).toBe(true)
    expect(members.pubkey).toBe(relayPk)
    expect(members.tags.some((t) => t[0] === "p" && t[1] === memberPk)).toBe(
      true
    )
  })

  test("rejects client-signed group state", async () => {
    const { module } = createNip29GroupPolicyModule({
      relayPubkey: relayPk,
      seedGroups: [{ id: "g", creatorPubkey: ownerPk }],
    })
    const decision = await runPolicy(
      module,
      asEvent({
        pubkey: ownerPk,
        kind: 39002,
        tags: [["d", "g"], ["p", strangerPk]],
      })
    )
    expect(decision._tag).toBe("Reject")
  })

  test("scoped discovery never lists a global directory", () => {
    const { controller } = createNip29GroupPolicyModule({
      relayPubkey: relayPk,
      seedGroups: [
        { id: "a", creatorPubkey: ownerPk },
        { id: "b", creatorPubkey: ownerPk },
      ],
    })
    expect(controller.listDiscoverableGroupIds()).toEqual([])
    expect(
      controller.listDiscoverableGroupIds({ explicitGroupIds: ["a"] })
    ).toEqual(["a"])
  })

  test("community and owner-private rooms stay isolated", () => {
    const { controller } = createNip29GroupPolicyModule({
      relayPubkey: relayPk,
      seedGroups: [
        {
          id: "community",
          creatorPubkey: ownerPk,
          roomClass: "community",
        },
        {
          id: "sarah-private",
          creatorPubkey: memberPk,
          roomClass: "owner-private",
          isPrivate: true,
          isHidden: true,
        },
      ],
    })
    // Distinct creators → no shared membership
    expect(
      controller.assertRoomIsolation("community", "sarah-private")
    ).toEqual({ admit: true })
    expect(controller.isMember("community", memberPk)).toBe(false)
    expect(controller.isMember("sarah-private", ownerPk)).toBe(false)
  })

  test("registry can load policy module", async () => {
    const { module } = createNip29GroupPolicyModule({
      relayPubkey: relayPk,
    })
    await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* NipRegistry
        expect(reg.hasModule("nip-29-group-policy")).toBe(true)
        expect(reg.supportedNips).toContain(29)
      }).pipe(
        Effect.provide(
          NipRegistryLive([
            ...DefaultModules.filter((m) => m.id !== "nip-29"),
            module,
          ])
        )
      )
    )
  })
})
