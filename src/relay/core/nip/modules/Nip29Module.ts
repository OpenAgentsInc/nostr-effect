/**
 * NIP-29 Module
 *
 * Advertises relay-based groups support via NIP-11, and optionally enforces
 * owned-relay group policy (closed write, explicit membership, relay-signed
 * state, immediate revocation) via `createNip29GroupPolicyModule`.
 *
 * The default `Nip29Module` only declares kinds (open policy). The owned
 * OpenAgents workroom relay must install the policy factory.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/29.md
 * @see src/core/Nip29GroupPolicy.ts
 */
import { Effect } from "effect"
import { createModule, type NipModule, type PreStoreHook } from "../NipModule.js"
import {
  type Policy,
  Accept,
  Reject,
} from "../../policy/Policy.js"
import {
  GroupPolicyEngine,
  type GroupPolicyConfig,
  type GroupPolicyEvent,
  type RoomClass,
  type RevocationResult,
  type EventTemplate,
} from "../../../../core/Nip29GroupPolicy.js"

// =============================================================================
// Default advertisement module (no enforcement)
// =============================================================================

/**
 * NIP-29 kinds advertisement only. Moderation authorization is relay-policy
 * specific — use `createNip29GroupPolicyModule` for the owned closed workroom.
 */
export const Nip29Module: NipModule = createModule({
  id: "nip-29",
  nips: [29],
  description:
    "Relay-based groups: metadata 39000–39005, moderation 9000–9010, join 9021, leave 9022, LiveKit well-known endpoints",
  kinds: [
    9000, 9001, 9002, 9005, 9007, 9008, 9009, 9010, 9021, 9022,
    39000, 39001, 39002, 39003, 39004, 39005,
  ],
})

// =============================================================================
// Owned-relay group policy module
// =============================================================================

export interface Nip29GroupPolicyModuleConfig extends GroupPolicyConfig {
  /**
   * Seed groups created before the relay accepts traffic. Useful for the
   * community workroom and the separate owner-private Sarah room.
   */
  readonly seedGroups?: readonly {
    readonly id: string
    readonly creatorPubkey: string
    readonly roomClass?: RoomClass
    readonly name?: string
    readonly about?: string
    readonly isPrivate?: boolean
    readonly isClosed?: boolean
    readonly isRestricted?: boolean
    readonly isHidden?: boolean
    readonly creatorRoles?: readonly string[]
    readonly creatorCapabilityGrants?: readonly string[]
    readonly supportedKinds?: readonly number[]
    readonly pinnedReferences?: readonly (readonly ["e" | "a", string])[]
  }[]
}

/**
 * Host-facing controller for membership mutations and relay-signed
 * projections. The NIP module holds the same engine instance.
 */
export interface Nip29GroupPolicyController {
  readonly engine: GroupPolicyEngine

  /** Create a closed group (bootstrap). */
  createGroup: GroupPolicyEngine["createGroup"]

  /** Put / update member with optional capability grants. */
  putUser: GroupPolicyEngine["putUser"]

  /**
   * Remove a member and revoke all capability grants in the same action.
   */
  removeUser: GroupPolicyEngine["removeUser"]

  /** True when pubkey is an active member. */
  isMember: (groupId: string, pubkey: string) => boolean

  /** Capability grants still bound to the member. */
  capabilityGrantsOf: (groupId: string, pubkey: string) => readonly string[]

  /** Whether a grant id is still live. */
  hasCapabilityGrant: (grantId: string) => boolean

  /**
   * Build unsigned 39000/39001/39002/39003/39005 templates for the host to sign
   * with the relay key. Clients verify against NIP-11 `self`.
   */
  buildRelaySignedProjections: (
    groupId: string,
    createdAt?: number
  ) =>
    | {
        readonly ok: true
        readonly metadata: EventTemplate
        readonly admins: EventTemplate
        readonly members: EventTemplate
        readonly roles: EventTemplate
        readonly pinned: EventTemplate
      }
    | { readonly ok: false; readonly reason: string }

  /**
   * Scoped discovery helper. Never returns a global directory unless
   * `scopedDiscovery: false` was configured.
   */
  listDiscoverableGroupIds: GroupPolicyEngine["listDiscoverableGroupIds"]

  /**
   * Two-room rule check: community vs owner-private must not share members.
   */
  assertRoomIsolation: GroupPolicyEngine["assertRoomIsolation"]

  /**
   * Last revocation produced by the module's preStoreHook (for hosts that
   * mirror capability grant cleanup into another store).
   */
  drainLastRevocation: () => RevocationResult | undefined
}

export interface Nip29GroupPolicyModuleBundle {
  readonly module: NipModule
  readonly controller: Nip29GroupPolicyController
  readonly engine: GroupPolicyEngine
}

const toPolicyEvent = (event: {
  readonly pubkey: string
  readonly kind: number
  readonly tags: readonly (readonly string[])[]
  readonly content?: string
  readonly id?: string
  readonly created_at?: number
  readonly sig?: string
}): GroupPolicyEvent => event

/**
 * Create an owned-relay NIP-29 group policy module.
 *
 * - Enforces membership on write for restricted groups (`h` tag).
 * - Accepts group state (39000–39005) only from `relayPubkey` when set.
 * - Applies moderation / join / leave to in-memory membership on pre-store.
 * - Immediate revocation: remove-user clears capability grants.
 * - Discovery stays scoped via `controller.listDiscoverableGroupIds`.
 *
 * Replace the default `Nip29Module` in the relay module list with
 * `bundle.module`, or install both (policy module id is `nip-29-group-policy`).
 *
 * @example
 * ```ts
 * import { createNip29GroupPolicyModule, DefaultModules } from "nostr-effect/relay"
 * import { finalizeEvent } from "nostr-effect/pure"
 *
 * const { module, controller } = createNip29GroupPolicyModule({
 *   relayPubkey: relayPk,
 *   seedGroups: [{
 *     id: "openagents-community",
 *     creatorPubkey: ownerPk,
 *     roomClass: "community",
 *     name: "OpenAgents Community",
 *     isClosed: true,
 *     isRestricted: true,
 *   }],
 * })
 *
 * const modules = [...DefaultModules.filter(m => m.id !== "nip-29"), module]
 * // after putUser / removeUser, sign and store projections:
 * const proj = controller.buildRelaySignedProjections("openagents-community")
 * if (proj.ok) {
 *   const membersEv = finalizeEvent(proj.members, relaySecret)
 *   // store membersEv …
 * }
 * ```
 */
export const createNip29GroupPolicyModule = (
  config: Nip29GroupPolicyModuleConfig = {}
): Nip29GroupPolicyModuleBundle => {
  const engine = new GroupPolicyEngine(config)
  let lastRevocation: RevocationResult | undefined

  for (const seed of config.seedGroups ?? []) {
    const decision = engine.createGroup(seed)
    if (!decision.admit) {
      // Seed failure is a programmer error; surface loudly in tests.
      throw new Error(
        `NIP-29 seed group ${seed.id} failed: ${decision.reason}`
      )
    }
  }

  const groupPolicy: Policy<never> = (ctx) => {
    const decision = engine.admitEvent(toPolicyEvent(ctx.event))
    if (decision.admit) return Effect.succeed(Accept)
    return Effect.succeed(Reject(decision.reason))
  }

  const preStoreHook: PreStoreHook = (event) =>
    Effect.sync(() => {
      const decision = engine.admitEvent(toPolicyEvent(event))
      if (!decision.admit) {
        return { action: "reject" as const, reason: decision.reason }
      }
      const applied = engine.applyEvent(toPolicyEvent(event))
      if (applied.revocation) {
        lastRevocation = applied.revocation
      }
      // applyEvent may return applied:false for non-state events — still store.
      if (
        applied.applied === false &&
        applied.reason &&
        applied.reason !== "not a state-changing group event"
      ) {
        return { action: "reject" as const, reason: applied.reason }
      }
      return { action: "store" as const, event }
    })

  const module = createModule({
    id: "nip-29-group-policy",
    nips: [29],
    description:
      "Owned-relay NIP-29 group policy: closed write, explicit membership, relay-signed state, immediate revocation",
    // Empty kinds → policies apply to every EVENT (h-tag membership gate).
    kinds: [],
    policies: [groupPolicy],
    preStoreHook,
    relayInfo: {
      // Hint for clients that this relay enforces closed groups.
      // Custom extension; does not affect supported_nips.
    },
    limitations: {},
  })

  const controller: Nip29GroupPolicyController = {
    engine,
    createGroup: (params) => engine.createGroup(params),
    putUser: (params) => engine.putUser(params),
    removeUser: (params) => engine.removeUser(params),
    isMember: (groupId, pubkey) => engine.isMember(groupId, pubkey),
    capabilityGrantsOf: (groupId, pubkey) =>
      engine.capabilityGrantsOf(groupId, pubkey),
    hasCapabilityGrant: (grantId) => engine.hasCapabilityGrant(grantId),
    buildRelaySignedProjections: (groupId, createdAt) =>
      engine.buildRelaySignedProjections(groupId, createdAt),
    listDiscoverableGroupIds: (options) =>
      engine.listDiscoverableGroupIds(options),
    assertRoomIsolation: (a, b) => engine.assertRoomIsolation(a, b),
    drainLastRevocation: () => {
      const r = lastRevocation
      lastRevocation = undefined
      return r
    },
  }

  return { module, controller, engine }
}

export {
  GroupPolicyEngine,
  type GroupPolicyConfig,
  type GroupPolicyEvent,
  type RoomClass,
  type RevocationResult,
  type AdmitDecision,
  type GroupRecord,
  type GroupMemberRecord,
  type EventTemplate,
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_ROLES_KIND,
  GROUP_PUT_USER_KIND,
  GROUP_REMOVE_USER_KIND,
  GROUP_JOIN_REQUEST_KIND,
  GROUP_LEAVE_REQUEST_KIND,
  DEFAULT_ROLE_PERMISSIONS,
  RELAY_SIGNED_GROUP_KINDS,
  admitClosedWrite,
  revokeMembershipWithCapabilities,
} from "../../../../core/Nip29GroupPolicy.js"
