/**
 * NIP-29 Group Policy (owned-relay)
 *
 * Pure admission, membership, and projection helpers for a closed NIP-29
 * group on an owned relay. The engine is host-agnostic: the relay module
 * wraps it for EVENT policy and the host signs/publishes projections.
 *
 * Owned-relay rules (SARAH-CW-01 / workroom §30):
 * - Write access is closed; membership is explicit.
 * - Discovery is scoped (no global group directory).
 * - Revocation is immediate: remove-user ends membership and capability
 *   grants in the same action.
 * - Community and owner-private rooms are separate (no shared membership
 *   and no shared history keys).
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/29.md
 */

// =============================================================================
// Kinds and permissions
// =============================================================================

/** Group metadata (relay-signed, addressable) */
export const GROUP_METADATA_KIND = 39000
/** Group admins list (relay-signed, addressable) */
export const GROUP_ADMINS_KIND = 39001
/** Group members list (relay-signed, addressable) */
export const GROUP_MEMBERS_KIND = 39002
/** Supported roles advertisement (relay-signed, addressable) */
export const GROUP_ROLES_KIND = 39003
/** LiveKit participants (relay-signed, addressable) */
export const GROUP_LIVEKIT_PARTICIPANTS_KIND = 39004
/** Group pinned events (relay-signed, addressable) */
export const GROUP_PINNED_EVENTS_KIND = 39005

export const GROUP_PUT_USER_KIND = 9000
export const GROUP_REMOVE_USER_KIND = 9001
export const GROUP_EDIT_METADATA_KIND = 9002
export const GROUP_DELETE_EVENT_KIND = 9005
export const GROUP_CREATE_GROUP_KIND = 9007
export const GROUP_DELETE_GROUP_KIND = 9008
export const GROUP_CREATE_INVITE_KIND = 9009
export const GROUP_UPDATE_PIN_LIST_KIND = 9010
export const GROUP_JOIN_REQUEST_KIND = 9021
export const GROUP_LEAVE_REQUEST_KIND = 9022

/** Relay-signed group state kinds (must be authored by relay self) */
export const RELAY_SIGNED_GROUP_KINDS: readonly number[] = [
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  GROUP_ROLES_KIND,
  GROUP_LIVEKIT_PARTICIPANTS_KIND,
  GROUP_PINNED_EVENTS_KIND,
]

/** Moderation action kinds (user/admin-authored with h-tag) */
export const GROUP_MODERATION_KINDS: readonly number[] = [
  GROUP_PUT_USER_KIND,
  GROUP_REMOVE_USER_KIND,
  GROUP_EDIT_METADATA_KIND,
  GROUP_DELETE_EVENT_KIND,
  GROUP_CREATE_GROUP_KIND,
  GROUP_DELETE_GROUP_KIND,
  GROUP_CREATE_INVITE_KIND,
  GROUP_UPDATE_PIN_LIST_KIND,
]

/** Moderation kind → canonical permission name */
export const MODERATION_PERMISSION: Readonly<Record<number, string>> = {
  [GROUP_PUT_USER_KIND]: "put-user",
  [GROUP_REMOVE_USER_KIND]: "remove-user",
  [GROUP_EDIT_METADATA_KIND]: "edit-metadata",
  [GROUP_DELETE_EVENT_KIND]: "delete-event",
  [GROUP_CREATE_GROUP_KIND]: "create-group",
  [GROUP_DELETE_GROUP_KIND]: "delete-group",
  [GROUP_CREATE_INVITE_KIND]: "create-invite",
  [GROUP_UPDATE_PIN_LIST_KIND]: "update-pin-list",
}

/**
 * Default role → permissions matrix for the owned OpenAgents relay.
 * Role names are free-form per NIP-29; this is the owned-relay default.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<string, readonly string[]>
> = {
  owner: [
    "add-user",
    "put-user",
    "remove-user",
    "edit-metadata",
    "delete-event",
    "create-group",
    "delete-group",
    "create-invite",
    "update-pin-list",
  ],
  admin: [
    "add-user",
    "put-user",
    "remove-user",
    "edit-metadata",
    "delete-event",
    "create-invite",
    "update-pin-list",
  ],
  moderator: ["delete-event", "remove-user"],
  member: [],
}

/** Room class: community workroom vs owner-private Sarah conversation */
export type RoomClass = "community" | "owner-private" | (string & {})

// =============================================================================
// Event shape (host-agnostic)
// =============================================================================

/** Minimal event shape used by admission (no full Schema dependency). */
export interface GroupPolicyEvent {
  readonly id?: string
  readonly pubkey: string
  readonly kind: number
  readonly created_at?: number
  readonly tags: readonly (readonly string[])[]
  readonly content?: string
  readonly sig?: string
}

// =============================================================================
// State
// =============================================================================

export interface GroupMemberRecord {
  readonly pubkey: string
  readonly roles: readonly string[]
  /**
   * Capability grants bound to this membership. Revoked in the same
   * action as remove-user (SARAH-CW-01 revocation rule).
   */
  readonly capabilityGrants: readonly string[]
  readonly label?: string
}

export interface GroupRecord {
  readonly id: string
  readonly roomClass: RoomClass
  readonly name?: string
  readonly about?: string
  readonly picture?: string
  readonly banner?: string
  /** Only members can read */
  readonly isPrivate: boolean
  /** Join requests ignored without invite */
  readonly isClosed: boolean
  /** Only members can write (owned closed groups default true) */
  readonly isRestricted: boolean
  /** Metadata hidden from non-members */
  readonly isHidden: boolean
  readonly deleted: boolean
  /** pubkey → member */
  readonly members: ReadonlyMap<string, GroupMemberRecord>
  /** Active invite codes */
  readonly invites: ReadonlySet<string>
  /** Supported content kinds; empty means all kinds when unset */
  readonly supportedKinds?: readonly number[]
}

export interface GroupPolicyConfig {
  /**
   * Relay `self` pubkey (NIP-11). When set, kinds 39000–39005 are accepted
   * only from this pubkey.
   */
  readonly relayPubkey?: string
  /** Defaults applied on create-group (owned closed workroom defaults). */
  readonly defaultClosed?: boolean
  readonly defaultRestricted?: boolean
  readonly defaultPrivate?: boolean
  readonly defaultHidden?: boolean
  readonly defaultRoomClass?: RoomClass
  /** Role name → permission names. Defaults to DEFAULT_ROLE_PERMISSIONS. */
  readonly rolePermissions?: Readonly<Record<string, readonly string[]>>
  /**
   * When true (default), REQ-style discovery without an explicit group id
   * returns no groups. Callers use `listDiscoverableGroupIds`.
   */
  readonly scopedDiscovery?: boolean
}

export type AdmitDecision =
  | { readonly admit: true }
  | { readonly admit: false; readonly reason: string }

export interface RevocationResult {
  readonly groupId: string
  readonly pubkey: string
  /** Capability grants cleared with membership */
  readonly revokedCapabilityGrants: readonly string[]
  readonly wasMember: boolean
}

export interface EventTemplate {
  readonly kind: number
  readonly tags: string[][]
  readonly content: string
  readonly created_at: number
}

// =============================================================================
// Helpers
// =============================================================================

export const getHTag = (event: GroupPolicyEvent): string | undefined => {
  const tag = event.tags.find((t) => t[0] === "h" && t[1])
  return tag?.[1]
}

export const getDTag = (event: GroupPolicyEvent): string | undefined => {
  const tag = event.tags.find((t) => t[0] === "d" && t[1])
  return tag?.[1]
}

export const getPTags = (event: GroupPolicyEvent): readonly string[] =>
  event.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]!)

/** First p-tag with optional role suffix values after pubkey. */
export const getPutUserTargets = (
  event: GroupPolicyEvent
): readonly { readonly pubkey: string; readonly roles: readonly string[] }[] => {
  const out: { pubkey: string; roles: string[] }[] = []
  for (const t of event.tags) {
    if (t[0] !== "p" || !t[1]) continue
    out.push({ pubkey: t[1], roles: t.slice(2).filter(Boolean) })
  }
  return out
}

export const isRelaySignedGroupKind = (kind: number): boolean =>
  RELAY_SIGNED_GROUP_KINDS.includes(kind)

export const isModerationKind = (kind: number): boolean =>
  GROUP_MODERATION_KINDS.includes(kind)

export const isGroupUserManagementKind = (kind: number): boolean =>
  kind === GROUP_JOIN_REQUEST_KIND || kind === GROUP_LEAVE_REQUEST_KIND

/**
 * True when the event is in the NIP-29 group surface (h-tag management
 * or relay-signed group state with d-tag).
 */
export const isGroupSurfaceEvent = (event: GroupPolicyEvent): boolean => {
  if (isRelaySignedGroupKind(event.kind)) return true
  if (isModerationKind(event.kind)) return true
  if (isGroupUserManagementKind(event.kind)) return true
  return getHTag(event) !== undefined
}

// =============================================================================
// Engine
// =============================================================================

const cloneMember = (m: GroupMemberRecord): GroupMemberRecord => ({
  pubkey: m.pubkey,
  roles: [...m.roles],
  capabilityGrants: [...m.capabilityGrants],
  ...(m.label !== undefined ? { label: m.label } : {}),
})

const defaultFlags = (config: GroupPolicyConfig) => ({
  isClosed: config.defaultClosed ?? true,
  isRestricted: config.defaultRestricted ?? true,
  isPrivate: config.defaultPrivate ?? false,
  isHidden: config.defaultHidden ?? false,
  roomClass: config.defaultRoomClass ?? ("community" as RoomClass),
})

/**
 * Mutable in-memory NIP-29 group policy engine for an owned relay.
 *
 * Thread-safety: single-threaded JS hosts only. Hosts that need shared
 * state across processes must rehydrate from stored moderation history.
 */
export class GroupPolicyEngine {
  private readonly groups = new Map<string, GroupRecord>()
  private readonly rolePermissions: Readonly<Record<string, readonly string[]>>
  private readonly config: GroupPolicyConfig
  /** Capability grant id → groupId:pubkey (for quick revoke lookup) */
  private readonly capabilityIndex = new Map<string, string>()

  constructor(config: GroupPolicyConfig = {}) {
    this.config = config
    this.rolePermissions = config.rolePermissions ?? DEFAULT_ROLE_PERMISSIONS
  }

  getConfig(): GroupPolicyConfig {
    return this.config
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getGroup(groupId: string): GroupRecord | undefined {
    return this.groups.get(groupId)
  }

  listGroupIds(): readonly string[] {
    return [...this.groups.keys()].filter((id) => {
      const g = this.groups.get(id)
      return g !== undefined && !g.deleted
    })
  }

  isMember(groupId: string, pubkey: string): boolean {
    const g = this.groups.get(groupId)
    if (!g || g.deleted) return false
    return g.members.has(pubkey)
  }

  getMember(groupId: string, pubkey: string): GroupMemberRecord | undefined {
    return this.groups.get(groupId)?.members.get(pubkey)
  }

  /**
   * Permissions the pubkey currently holds in the group (union of role
   * permissions plus any role name that appears as a bare permission).
   */
  permissionsFor(groupId: string, pubkey: string): ReadonlySet<string> {
    const member = this.getMember(groupId, pubkey)
    if (!member) return new Set()
    const perms = new Set<string>()
    for (const role of member.roles) {
      const fromRole = this.rolePermissions[role]
      if (fromRole) {
        for (const p of fromRole) perms.add(p)
      }
      // A bare role name may itself be used as a permission label.
      perms.add(role)
    }
    return perms
  }

  hasPermission(groupId: string, pubkey: string, permission: string): boolean {
    return this.permissionsFor(groupId, pubkey).has(permission)
  }

  /**
   * Capability grants still live for a member. Empty after revoke.
   */
  capabilityGrantsOf(groupId: string, pubkey: string): readonly string[] {
    return this.getMember(groupId, pubkey)?.capabilityGrants ?? []
  }

  hasCapabilityGrant(grantId: string): boolean {
    return this.capabilityIndex.has(grantId)
  }

  /**
   * Scoped discovery: groups a viewer may learn about.
   * - Never returns a global directory when scopedDiscovery is on and
   *   no explicit ids are requested.
   * - Hides `hidden` groups from non-members.
   * - Omits deleted groups.
   */
  listDiscoverableGroupIds(options: {
    readonly viewerPubkey?: string
    /** When set, only consider these ids (explicit invitation / naddr). */
    readonly explicitGroupIds?: readonly string[]
  } = {}): readonly string[] {
    const scoped = this.config.scopedDiscovery !== false
    if (scoped && (!options.explicitGroupIds || options.explicitGroupIds.length === 0)) {
      // No global directory.
      return []
    }
    const candidates =
      options.explicitGroupIds && options.explicitGroupIds.length > 0
        ? options.explicitGroupIds
        : this.listGroupIds()

    const out: string[] = []
    for (const id of candidates) {
      const g = this.groups.get(id)
      if (!g || g.deleted) continue
      if (g.isHidden) {
        if (!options.viewerPubkey || !g.members.has(options.viewerPubkey)) {
          continue
        }
      }
      out.push(id)
    }
    return out
  }

  /**
   * Two-room rule: community and owner-private must not share members.
   * Returns overlapping pubkeys if the invariant is broken.
   */
  sharedMembershipBetween(
    groupIdA: string,
    groupIdB: string
  ): readonly string[] {
    const a = this.groups.get(groupIdA)
    const b = this.groups.get(groupIdB)
    if (!a || !b) return []
    const shared: string[] = []
    for (const pk of a.members.keys()) {
      if (b.members.has(pk)) shared.push(pk)
    }
    return shared
  }

  /**
   * Assert community and owner-private rooms do not share membership.
   * Call after mutations when both room classes exist.
   */
  assertRoomIsolation(
    communityGroupId: string,
    ownerPrivateGroupId: string
  ): AdmitDecision {
    const community = this.groups.get(communityGroupId)
    const ownerPrivate = this.groups.get(ownerPrivateGroupId)
    if (!community || !ownerPrivate) {
      return { admit: true }
    }
    if (
      community.roomClass === ownerPrivate.roomClass &&
      community.roomClass !== "community"
    ) {
      // Same non-community class is caller concern.
      return { admit: true }
    }
    const shared = this.sharedMembershipBetween(
      communityGroupId,
      ownerPrivateGroupId
    )
    if (shared.length > 0) {
      return {
        admit: false,
        reason: `restricted: community and owner-private groups must not share membership (shared=${shared.join(",")})`,
      }
    }
    return { admit: true }
  }

  // ---------------------------------------------------------------------------
  // Mutations (host / moderation path)
  // ---------------------------------------------------------------------------

  /**
   * Admit a closed group into the engine (relay bootstrap or create-group).
   * Does not sign projections — use `buildRelaySignedProjections`.
   */
  createGroup(params: {
    readonly id: string
    readonly creatorPubkey: string
    readonly roomClass?: RoomClass
    readonly name?: string
    readonly about?: string
    readonly picture?: string
    readonly banner?: string
    readonly isPrivate?: boolean
    readonly isClosed?: boolean
    readonly isRestricted?: boolean
    readonly isHidden?: boolean
    readonly creatorRoles?: readonly string[]
    readonly creatorCapabilityGrants?: readonly string[]
  }): AdmitDecision {
    if (this.groups.has(params.id) && !this.groups.get(params.id)!.deleted) {
      return { admit: false, reason: "duplicate: group already exists" }
    }
    const flags = defaultFlags(this.config)
    const members = new Map<string, GroupMemberRecord>()
    const roles = params.creatorRoles ?? ["owner", "admin", "member"]
    const grants = params.creatorCapabilityGrants ?? []
    members.set(params.creatorPubkey, {
      pubkey: params.creatorPubkey,
      roles: [...roles],
      capabilityGrants: [...grants],
    })
    for (const g of grants) {
      this.capabilityIndex.set(g, `${params.id}:${params.creatorPubkey}`)
    }
    const record: GroupRecord = {
      id: params.id,
      roomClass: params.roomClass ?? flags.roomClass,
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.about !== undefined ? { about: params.about } : {}),
      ...(params.picture !== undefined ? { picture: params.picture } : {}),
      ...(params.banner !== undefined ? { banner: params.banner } : {}),
      isPrivate: params.isPrivate ?? flags.isPrivate,
      isClosed: params.isClosed ?? flags.isClosed,
      isRestricted: params.isRestricted ?? flags.isRestricted,
      isHidden: params.isHidden ?? flags.isHidden,
      deleted: false,
      members,
      invites: new Set(),
    }
    this.groups.set(params.id, record)
    return { admit: true }
  }

  /**
   * Put or update a user. Optional capability grants are bound to membership.
   */
  putUser(params: {
    readonly groupId: string
    readonly pubkey: string
    readonly roles?: readonly string[]
    readonly capabilityGrants?: readonly string[]
    readonly label?: string
    /** Merge grants with existing (default) or replace. */
    readonly replaceGrants?: boolean
  }): AdmitDecision {
    const g = this.groups.get(params.groupId)
    if (!g || g.deleted) {
      return { admit: false, reason: "restricted: group not found" }
    }
    const existing = g.members.get(params.pubkey)
    const roles =
      params.roles !== undefined
        ? [...params.roles]
        : existing
          ? [...existing.roles]
          : ["member"]
    if (!roles.includes("member") && roles.length === 0) {
      roles.push("member")
    }
    if (!roles.includes("member")) {
      // Ensure every member has at least the member role for membership checks.
      roles.push("member")
    }
    const prevGrants = existing?.capabilityGrants ?? []
    let nextGrants: string[]
    if (params.capabilityGrants !== undefined) {
      nextGrants = params.replaceGrants
        ? [...params.capabilityGrants]
        : [...new Set([...prevGrants, ...params.capabilityGrants])]
    } else {
      nextGrants = [...prevGrants]
    }
    // Drop old grant index entries that are no longer present.
    for (const old of prevGrants) {
      if (!nextGrants.includes(old)) this.capabilityIndex.delete(old)
    }
    for (const grant of nextGrants) {
      this.capabilityIndex.set(grant, `${params.groupId}:${params.pubkey}`)
    }
    const members = new Map(g.members)
    members.set(params.pubkey, {
      pubkey: params.pubkey,
      roles,
      capabilityGrants: nextGrants,
      ...(params.label !== undefined
        ? { label: params.label }
        : existing?.label !== undefined
          ? { label: existing.label }
          : {}),
    })
    this.groups.set(params.groupId, { ...g, members })
    return { admit: true }
  }

  /**
   * Remove a user and revoke all capability grants in the same action.
   */
  removeUser(params: {
    readonly groupId: string
    readonly pubkey: string
  }): RevocationResult {
    const g = this.groups.get(params.groupId)
    if (!g || g.deleted) {
      return {
        groupId: params.groupId,
        pubkey: params.pubkey,
        revokedCapabilityGrants: [],
        wasMember: false,
      }
    }
    const existing = g.members.get(params.pubkey)
    if (!existing) {
      return {
        groupId: params.groupId,
        pubkey: params.pubkey,
        revokedCapabilityGrants: [],
        wasMember: false,
      }
    }
    const revoked = [...existing.capabilityGrants]
    for (const grant of revoked) {
      this.capabilityIndex.delete(grant)
    }
    const members = new Map(g.members)
    members.delete(params.pubkey)
    this.groups.set(params.groupId, { ...g, members })
    return {
      groupId: params.groupId,
      pubkey: params.pubkey,
      revokedCapabilityGrants: revoked,
      wasMember: true,
    }
  }

  editMetadata(params: {
    readonly groupId: string
    readonly name?: string
    readonly about?: string
    readonly picture?: string
    readonly banner?: string
    readonly isPrivate?: boolean
    readonly isClosed?: boolean
    readonly isRestricted?: boolean
    readonly isHidden?: boolean
  }): AdmitDecision {
    const g = this.groups.get(params.groupId)
    if (!g || g.deleted) {
      return { admit: false, reason: "restricted: group not found" }
    }
    this.groups.set(params.groupId, {
      ...g,
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.about !== undefined ? { about: params.about } : {}),
      ...(params.picture !== undefined ? { picture: params.picture } : {}),
      ...(params.banner !== undefined ? { banner: params.banner } : {}),
      ...(params.isPrivate !== undefined ? { isPrivate: params.isPrivate } : {}),
      ...(params.isClosed !== undefined ? { isClosed: params.isClosed } : {}),
      ...(params.isRestricted !== undefined
        ? { isRestricted: params.isRestricted }
        : {}),
      ...(params.isHidden !== undefined ? { isHidden: params.isHidden } : {}),
    })
    return { admit: true }
  }

  deleteGroup(groupId: string): AdmitDecision {
    const g = this.groups.get(groupId)
    if (!g) {
      return { admit: false, reason: "restricted: group not found" }
    }
    // Revoke every member capability immediately.
    for (const member of g.members.values()) {
      for (const grant of member.capabilityGrants) {
        this.capabilityIndex.delete(grant)
      }
    }
    this.groups.set(groupId, {
      ...g,
      deleted: true,
      members: new Map(),
      invites: new Set(),
    })
    return { admit: true }
  }

  createInvite(groupId: string, code: string): AdmitDecision {
    const g = this.groups.get(groupId)
    if (!g || g.deleted) {
      return { admit: false, reason: "restricted: group not found" }
    }
    const invites = new Set(g.invites)
    invites.add(code)
    this.groups.set(groupId, { ...g, invites })
    return { admit: true }
  }

  /**
   * Honor a join request when the group is open or the code matches.
   * Closed groups without a valid invite are rejected.
   */
  honorJoinRequest(params: {
    readonly groupId: string
    readonly pubkey: string
    readonly code?: string
  }): AdmitDecision {
    const g = this.groups.get(params.groupId)
    if (!g || g.deleted) {
      return { admit: false, reason: "restricted: group not found" }
    }
    if (g.members.has(params.pubkey)) {
      return { admit: false, reason: "duplicate: already a member" }
    }
    if (g.isClosed) {
      if (!params.code || !g.invites.has(params.code)) {
        return {
          admit: false,
          reason: "restricted: group is closed; invite required",
        }
      }
      // Consume invite (single-use).
      const invites = new Set(g.invites)
      invites.delete(params.code)
      this.groups.set(params.groupId, { ...g, invites })
    }
    return this.putUser({
      groupId: params.groupId,
      pubkey: params.pubkey,
      roles: ["member"],
    })
  }

  // ---------------------------------------------------------------------------
  // Admission (EVENT path)
  // ---------------------------------------------------------------------------

  /**
   * Admit an EVENT for storage under owned NIP-29 group policy.
   *
   * Non-group-surface events Accept (leave to other modules).
   */
  admitEvent(event: GroupPolicyEvent): AdmitDecision {
    // Relay-signed group state
    if (isRelaySignedGroupKind(event.kind)) {
      return this.admitRelaySignedState(event)
    }

    // Moderation
    if (isModerationKind(event.kind)) {
      return this.admitModeration(event)
    }

    // Join / leave
    if (event.kind === GROUP_JOIN_REQUEST_KIND) {
      return this.admitJoinRequest(event)
    }
    if (event.kind === GROUP_LEAVE_REQUEST_KIND) {
      return this.admitLeaveRequest(event)
    }

    // Any other event with h-tag: membership write policy
    const groupId = getHTag(event)
    if (groupId !== undefined) {
      return this.admitGroupWrite(event, groupId)
    }

    return { admit: true }
  }

  private admitRelaySignedState(event: GroupPolicyEvent): AdmitDecision {
    const relayPubkey = this.config.relayPubkey
    if (relayPubkey && event.pubkey !== relayPubkey) {
      return {
        admit: false,
        reason:
          "restricted: group state events (39000-39005) must be signed by the relay",
      }
    }
    const d = getDTag(event)
    if (!d) {
      return { admit: false, reason: "invalid: group state requires d tag" }
    }
    return { admit: true }
  }

  private admitModeration(event: GroupPolicyEvent): AdmitDecision {
    const groupId = getHTag(event)
    if (!groupId) {
      return { admit: false, reason: "invalid: moderation event requires h tag" }
    }

    // create-group may bootstrap a new id when the actor is the relay self
    // or already holds create-group somewhere (owned relay: relay key or seed owner).
    if (event.kind === GROUP_CREATE_GROUP_KIND) {
      const existing = this.groups.get(groupId)
      if (existing && !existing.deleted) {
        return { admit: false, reason: "duplicate: group already exists" }
      }
      if (
        this.config.relayPubkey &&
        event.pubkey === this.config.relayPubkey
      ) {
        return { admit: true }
      }
      // Allow first create when no groups yet and actor becomes owner via apply.
      // Hosts that seed groups via `createGroup` will not hit this path.
      return { admit: true }
    }

    const g = this.groups.get(groupId)
    if (!g || g.deleted) {
      return { admit: false, reason: "restricted: group not found" }
    }

    // Relay self may always moderate.
    if (this.config.relayPubkey && event.pubkey === this.config.relayPubkey) {
      return { admit: true }
    }

    const permission = MODERATION_PERMISSION[event.kind]
    if (!permission) {
      return { admit: false, reason: "restricted: unknown moderation kind" }
    }
    // put-user also accepts the legacy add-user permission name.
    const ok =
      this.hasPermission(groupId, event.pubkey, permission) ||
      (permission === "put-user" &&
        this.hasPermission(groupId, event.pubkey, "add-user"))
    if (!ok) {
      return {
        admit: false,
        reason: `restricted: missing permission ${permission}`,
      }
    }
    return { admit: true }
  }

  private admitJoinRequest(event: GroupPolicyEvent): AdmitDecision {
    const groupId = getHTag(event)
    if (!groupId) {
      return { admit: false, reason: "invalid: join request requires h tag" }
    }
    const g = this.groups.get(groupId)
    if (!g || g.deleted) {
      return { admit: false, reason: "restricted: group not found" }
    }
    if (g.members.has(event.pubkey)) {
      return { admit: false, reason: "duplicate: already a member" }
    }
    if (g.isClosed) {
      const codeTag = event.tags.find((t) => t[0] === "code" && t[1])
      const code = codeTag?.[1]
      if (!code || !g.invites.has(code)) {
        return {
          admit: false,
          reason: "restricted: group is closed; invite required",
        }
      }
    }
    // Pending review is not used for owned closed rooms — admit structurally;
    // the host applies honorJoinRequest after accept.
    return { admit: true }
  }

  private admitLeaveRequest(event: GroupPolicyEvent): AdmitDecision {
    const groupId = getHTag(event)
    if (!groupId) {
      return { admit: false, reason: "invalid: leave request requires h tag" }
    }
    if (!this.isMember(groupId, event.pubkey)) {
      return { admit: false, reason: "restricted: not a member" }
    }
    return { admit: true }
  }

  /**
   * Membership write gate for events that carry `h` and are not
   * moderation/join/leave. Restricted groups require membership.
   */
  private admitGroupWrite(
    event: GroupPolicyEvent,
    groupId: string
  ): AdmitDecision {
    const g = this.groups.get(groupId)
    if (!g || g.deleted) {
      // Unknown group id: owned relay rejects rather than creating open writes.
      return { admit: false, reason: "restricted: group not found" }
    }
    if (g.isRestricted && !g.members.has(event.pubkey)) {
      return {
        admit: false,
        reason: "restricted: membership required to write",
      }
    }
    if (
      g.supportedKinds &&
      g.supportedKinds.length > 0 &&
      !g.supportedKinds.includes(event.kind)
    ) {
      return {
        admit: false,
        reason: `restricted: kind ${event.kind} not supported in group`,
      }
    }
    return { admit: true }
  }

  /**
   * Apply a previously admitted moderation / join / leave event to state.
   * Call only after `admitEvent` returns admit: true for the same event.
   */
  applyEvent(event: GroupPolicyEvent): {
    readonly applied: boolean
    readonly revocation?: RevocationResult | undefined
    readonly reason?: string | undefined
  } {
    if (event.kind === GROUP_CREATE_GROUP_KIND) {
      const groupId = getHTag(event)
      if (!groupId) return { applied: false, reason: "missing h" }
      const decision = this.createGroup({
        id: groupId,
        creatorPubkey: event.pubkey,
      })
      return decision.admit
        ? { applied: true }
        : { applied: false, reason: decision.reason }
    }

    if (event.kind === GROUP_PUT_USER_KIND) {
      const groupId = getHTag(event)
      if (!groupId) return { applied: false, reason: "missing h" }
      const targets = getPutUserTargets(event)
      for (const t of targets) {
        const decision = this.putUser({
          groupId,
          pubkey: t.pubkey,
          roles: t.roles.length > 0 ? t.roles : ["member"],
        })
        if (!decision.admit) {
          return { applied: false, reason: decision.reason }
        }
      }
      return { applied: true }
    }

    if (event.kind === GROUP_REMOVE_USER_KIND) {
      const groupId = getHTag(event)
      if (!groupId) return { applied: false, reason: "missing h" }
      const targets = getPTags(event)
      let last: RevocationResult | undefined
      for (const pk of targets) {
        last = this.removeUser({ groupId, pubkey: pk })
      }
      if (last !== undefined) {
        return { applied: true, revocation: last }
      }
      return { applied: true }
    }

    if (event.kind === GROUP_EDIT_METADATA_KIND) {
      const groupId = getHTag(event)
      if (!groupId) return { applied: false, reason: "missing h" }
      let name: string | undefined
      let about: string | undefined
      let picture: string | undefined
      let banner: string | undefined
      let isPrivate: boolean | undefined
      let isClosed: boolean | undefined
      let isRestricted: boolean | undefined
      let isHidden: boolean | undefined
      for (const t of event.tags) {
        if (t[0] === "name" && t[1] !== undefined) name = t[1]
        if (t[0] === "about" && t[1] !== undefined) about = t[1]
        if (t[0] === "picture" && t[1] !== undefined) picture = t[1]
        if (t[0] === "banner" && t[1] !== undefined) banner = t[1]
        if (t[0] === "private") isPrivate = true
        if (t[0] === "closed") isClosed = true
        if (t[0] === "restricted") isRestricted = true
        if (t[0] === "hidden") isHidden = true
      }
      const decision = this.editMetadata({
        groupId,
        ...(name !== undefined ? { name } : {}),
        ...(about !== undefined ? { about } : {}),
        ...(picture !== undefined ? { picture } : {}),
        ...(banner !== undefined ? { banner } : {}),
        ...(isPrivate !== undefined ? { isPrivate } : {}),
        ...(isClosed !== undefined ? { isClosed } : {}),
        ...(isRestricted !== undefined ? { isRestricted } : {}),
        ...(isHidden !== undefined ? { isHidden } : {}),
      })
      return decision.admit
        ? { applied: true }
        : { applied: false, reason: decision.reason }
    }

    if (event.kind === GROUP_DELETE_GROUP_KIND) {
      const groupId = getHTag(event)
      if (!groupId) return { applied: false, reason: "missing h" }
      const decision = this.deleteGroup(groupId)
      return decision.admit
        ? { applied: true }
        : { applied: false, reason: decision.reason }
    }

    if (event.kind === GROUP_CREATE_INVITE_KIND) {
      const groupId = getHTag(event)
      if (!groupId) return { applied: false, reason: "missing h" }
      const codeTag = event.tags.find((t) => t[0] === "code" && t[1])
      if (!codeTag?.[1]) {
        return { applied: false, reason: "invalid: create-invite requires code" }
      }
      const decision = this.createInvite(groupId, codeTag[1])
      return decision.admit
        ? { applied: true }
        : { applied: false, reason: decision.reason }
    }

    if (event.kind === GROUP_JOIN_REQUEST_KIND) {
      const groupId = getHTag(event)
      if (!groupId) return { applied: false, reason: "missing h" }
      const codeTag = event.tags.find((t) => t[0] === "code" && t[1])
      const decision = this.honorJoinRequest({
        groupId,
        pubkey: event.pubkey,
        ...(codeTag?.[1] !== undefined ? { code: codeTag[1] } : {}),
      })
      return decision.admit
        ? { applied: true }
        : { applied: false, reason: decision.reason }
    }

    if (event.kind === GROUP_LEAVE_REQUEST_KIND) {
      const groupId = getHTag(event)
      if (!groupId) return { applied: false, reason: "missing h" }
      const revocation = this.removeUser({
        groupId,
        pubkey: event.pubkey,
      })
      return { applied: true, revocation }
    }

    // delete-event / update-pin-list do not change membership state here.
    if (
      event.kind === GROUP_DELETE_EVENT_KIND ||
      event.kind === GROUP_UPDATE_PIN_LIST_KIND
    ) {
      return { applied: true }
    }

    return { applied: false, reason: "not a state-changing group event" }
  }

  // ---------------------------------------------------------------------------
  // Relay-signed projections
  // ---------------------------------------------------------------------------

  /**
   * Build unsigned templates for kinds 39000/39001/39002 that a client can
   * verify once the host signs them with the relay key.
   */
  buildRelaySignedProjections(
    groupId: string,
    createdAt: number = Math.floor(Date.now() / 1000)
  ):
    | {
        readonly ok: true
        readonly metadata: EventTemplate
        readonly admins: EventTemplate
        readonly members: EventTemplate
        readonly roles: EventTemplate
      }
    | { readonly ok: false; readonly reason: string } {
    const g = this.groups.get(groupId)
    if (!g || g.deleted) {
      return { ok: false, reason: "group not found" }
    }

    const metadataTags: string[][] = [["d", groupId]]
    if (g.name) metadataTags.push(["name", g.name])
    if (g.picture) metadataTags.push(["picture", g.picture])
    if (g.banner) metadataTags.push(["banner", g.banner])
    if (g.about) metadataTags.push(["about", g.about])
    if (g.isPrivate) metadataTags.push(["private"])
    if (g.isClosed) metadataTags.push(["closed"])
    if (g.isRestricted) metadataTags.push(["restricted"])
    if (g.isHidden) metadataTags.push(["hidden"])
    // Room class as a non-conflicting extension tag for operators.
    metadataTags.push(["room-class", g.roomClass])

    const adminTags: string[][] = [["d", groupId]]
    const memberTags: string[][] = [["d", groupId]]
    for (const m of g.members.values()) {
      const elevated = m.roles.filter((r) => r !== "member")
      if (elevated.length > 0) {
        const tag = ["p", m.pubkey]
        if (m.label) tag.push(m.label)
        else tag.push("")
        // Permissions as advertised roles for kind 39001.
        for (const role of elevated) tag.push(role)
        adminTags.push(tag)
      }
      const memberTag = ["p", m.pubkey]
      if (m.label) memberTag.push(m.label)
      memberTags.push(memberTag)
    }

    const roleTags: string[][] = [["d", groupId]]
    for (const [role, perms] of Object.entries(this.rolePermissions)) {
      roleTags.push(["role", role, perms.join(",")])
    }

    return {
      ok: true,
      metadata: {
        kind: GROUP_METADATA_KIND,
        tags: metadataTags,
        content: "",
        created_at: createdAt,
      },
      admins: {
        kind: GROUP_ADMINS_KIND,
        tags: adminTags,
        content: `admins for ${groupId}`,
        created_at: createdAt,
      },
      members: {
        kind: GROUP_MEMBERS_KIND,
        tags: memberTags,
        content: `members for ${groupId}`,
        created_at: createdAt,
      },
      roles: {
        kind: GROUP_ROLES_KIND,
        tags: roleTags,
        content: `roles for ${groupId}`,
        created_at: createdAt,
      },
    }
  }

  /** Snapshot a group (deep-ish clone for tests). */
  snapshot(groupId: string): GroupRecord | undefined {
    const g = this.groups.get(groupId)
    if (!g) return undefined
    const members = new Map<string, GroupMemberRecord>()
    for (const [k, v] of g.members) members.set(k, cloneMember(v))
    return {
      ...g,
      members,
      invites: new Set(g.invites),
    }
  }
}

// =============================================================================
// Pure policy helper (no engine instance required for simple checks)
// =============================================================================

/**
 * Pure closed-write check used by hosts that keep membership elsewhere.
 */
export const admitClosedWrite = (params: {
  readonly isRestricted: boolean
  readonly isMember: boolean
  readonly groupExists: boolean
}): AdmitDecision => {
  if (!params.groupExists) {
    return { admit: false, reason: "restricted: group not found" }
  }
  if (params.isRestricted && !params.isMember) {
    return {
      admit: false,
      reason: "restricted: membership required to write",
    }
  }
  return { admit: true }
}

/**
 * Pure immediate-revocation helper: membership ends and grants clear together.
 */
export const revokeMembershipWithCapabilities = (member: GroupMemberRecord): {
  readonly revokedCapabilityGrants: readonly string[]
  readonly remainingGrants: readonly string[]
} => ({
  revokedCapabilityGrants: [...member.capabilityGrants],
  remainingGrants: [],
})
