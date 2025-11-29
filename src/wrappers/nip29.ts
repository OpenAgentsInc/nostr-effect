/**
 * NIP-29: Relay-based Groups
 *
 * Support for relay-based groups including group metadata, members, and admins.
 * This wrapper provides nostr-tools-compatible API using Effect services under the hood.
 *
 * @example
 * ```typescript
 * import { SimplePool } from 'nostr-effect/pool'
 * import {
 *   loadGroup,
 *   parseGroupCode,
 *   generateGroupMetadataEventTemplate
 * } from 'nostr-effect/nip29'
 *
 * const pool = new SimplePool()
 * const groupRef = parseGroupCode("relay.example.com'mygroup")
 * const group = await loadGroup({ pool, groupReference: groupRef })
 * console.log(group.metadata.name)
 * ```
 */

import { Effect, Exit } from "effect"
import {
  Nip29Service,
  Nip29ServiceLive,
  type Group,
  type GroupMetadata,
  type GroupReference,
  type GroupMember,
  type GroupAdmin,
  GroupAdminPermission,
  type RelayInformation,
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
} from "../client/Nip29Service.js"
import { SimplePool, type Filter, type SubCloser } from "./pool.js"
import { decode, NostrTypeGuard } from "./nip19.js"
import { normalizeURL } from "./utils.js"

// Re-export types from service
export type {
  Group,
  GroupMetadata,
  GroupReference,
  GroupMember,
  GroupAdmin,
  RelayInformation,
}
export { GroupAdminPermission, GROUP_METADATA_KIND, GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND }

// =============================================================================
// Types
// =============================================================================

/** Event type */
export interface Event {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Event template for signing */
export interface EventTemplate {
  kind: number
  tags: string[][]
  content: string
  created_at: number
}

// =============================================================================
// Event Template Generators
// =============================================================================

/**
 * Generates a group metadata event template.
 */
export function generateGroupMetadataEventTemplate(
  group: GroupReference,
  meta: Partial<GroupMetadata>
): EventTemplate {
  const tags: string[][] = [["d", group.id]]

  if (meta.name) tags.push(["name", meta.name])
  if (meta.picture) tags.push(["picture", meta.picture])
  if (meta.about) tags.push(["about", meta.about])
  if (meta.isPublic) tags.push(["public"])
  if (meta.isOpen) tags.push(["open"])

  return {
    kind: GROUP_METADATA_KIND,
    content: "",
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

/**
 * Generates a group admins event template.
 */
export function generateGroupAdminsEventTemplate(
  group: GroupReference,
  admins: GroupAdmin[]
): EventTemplate {
  const tags: string[][] = [["d", group.id]]

  for (const admin of admins) {
    const tag = ["p", admin.pubkey]
    if (admin.label) tag.push(admin.label)
    else tag.push("")
    tag.push(...admin.permissions)
    tags.push(tag)
  }

  return {
    kind: GROUP_ADMINS_KIND,
    content: "",
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

/**
 * Generates a group members event template.
 */
export function generateGroupMembersEventTemplate(
  group: GroupReference,
  members: GroupMember[]
): EventTemplate {
  const tags: string[][] = [["d", group.id]]

  for (const member of members) {
    const tag = ["p", member.pubkey]
    if (member.label) tag.push(member.label)
    tags.push(tag)
  }

  return {
    kind: GROUP_MEMBERS_KIND,
    content: "",
    tags,
    created_at: Math.floor(Date.now() / 1000),
  }
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates a group metadata event.
 */
export function validateGroupMetadataEvent(event: Event): boolean {
  if (event.kind !== GROUP_METADATA_KIND) return false
  return event.tags.some((tag) => tag[0] === "d" && tag[1])
}

/**
 * Validates a group admins event.
 */
export function validateGroupAdminsEvent(event: Event): boolean {
  if (event.kind !== GROUP_ADMINS_KIND) return false
  return event.tags.some((tag) => tag[0] === "d" && tag[1])
}

/**
 * Validates a group members event.
 */
export function validateGroupMembersEvent(event: Event): boolean {
  if (event.kind !== GROUP_MEMBERS_KIND) return false
  return event.tags.some((tag) => tag[0] === "d" && tag[1])
}

// =============================================================================
// Parse Functions
// =============================================================================

/**
 * Parses a group metadata event and returns a GroupMetadata object.
 */
export function parseGroupMetadataEvent(event: Event): GroupMetadata {
  if (!validateGroupMetadataEvent(event)) throw new Error("invalid group metadata event")

  const metadata: GroupMetadata = {
    id: "",
    pubkey: event.pubkey,
  }

  for (const tag of event.tags) {
    const [tagName, tagValue] = tag
    if (!tagValue) continue

    switch (tagName) {
      case "d":
        metadata.id = tagValue
        break
      case "name":
        metadata.name = tagValue
        break
      case "picture":
        metadata.picture = tagValue
        break
      case "about":
        metadata.about = tagValue
        break
      case "public":
        metadata.isPublic = true
        break
      case "open":
        metadata.isOpen = true
        break
    }
  }

  return metadata
}

/**
 * Parses a group admins event and returns an array of GroupAdmin objects.
 */
export function parseGroupAdminsEvent(event: Event): GroupAdmin[] {
  if (!validateGroupAdminsEvent(event)) throw new Error("invalid group admins event")

  const admins: GroupAdmin[] = []

  for (const tag of event.tags) {
    if (tag[0] !== "p" || !tag[1]) continue

    const pubkey = tag[1]
    const label = tag[2]
    const permissions = tag.slice(3) as GroupAdminPermission[]

    const admin: GroupAdmin = { pubkey, permissions }
    if (label) admin.label = label

    admins.push(admin)
  }

  return admins
}

/**
 * Parses a group members event and returns an array of GroupMember objects.
 */
export function parseGroupMembersEvent(event: Event): GroupMember[] {
  if (!validateGroupMembersEvent(event)) throw new Error("invalid group members event")

  const members: GroupMember[] = []

  for (const tag of event.tags) {
    if (tag[0] !== "p" || !tag[1]) continue

    const pubkey = tag[1]
    const label = tag[2]

    const member: GroupMember = { pubkey }
    if (label) member.label = label

    members.push(member)
  }

  return members
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Returns the normalized relay URL based on the provided group reference.
 */
export function getNormalizedRelayURLByGroupReference(groupReference: GroupReference): string {
  return normalizeURL(groupReference.host)
}

/**
 * Fetches relay information by group reference using Effect service.
 */
export async function fetchRelayInformationByGroupReference(
  groupReference: GroupReference
): Promise<RelayInformation> {
  const program = Effect.gen(function* () {
    const service = yield* Nip29Service
    return yield* service.fetchRelayInformation(groupReference)
  }).pipe(Effect.provide(Nip29ServiceLive))

  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    throw new Error("Failed to fetch relay information")
  }

  return exit.value
}

/**
 * Parses a group code and returns a GroupReference object.
 */
export function parseGroupCode(code: string): null | GroupReference {
  if (NostrTypeGuard.isNAddr(code)) {
    try {
      const { data } = decode(code)

      const { relays, identifier } = data as { relays?: string[]; identifier: string }
      if (!relays || relays.length === 0) return null

      const firstRelay = relays[0]
      if (!firstRelay) return null

      let host = firstRelay
      if (host.startsWith("wss://")) {
        host = host.slice(6)
      }
      return { host, id: identifier }
    } catch {
      return null
    }
  } else if (code.split("'").length === 2) {
    const spl = code.split("'")
    const hostPart = spl[0]
    const idPart = spl[1]
    if (!hostPart || !idPart) return null
    return { host: hostPart, id: idPart }
  }

  return null
}

/**
 * Encodes a group reference into a string.
 */
export function encodeGroupReference(gr: GroupReference): string {
  const { host, id } = gr
  const normalizedHost = host.replace(/^(https?:\/\/|wss?:\/\/)/, "")

  return `${normalizedHost}'${id}`
}

// =============================================================================
// Fetch Functions (nostr-tools compatible API using Effect under the hood)
// =============================================================================

/**
 * Fetches group metadata event.
 * Uses Effect-based service internally.
 */
export async function fetchGroupMetadataEvent({
  pool,
  groupReference,
}: {
  pool: SimplePool
  groupReference: GroupReference
}): Promise<Event | null> {
  const program = Effect.gen(function* () {
    const service = yield* Nip29Service
    return yield* service.fetchGroupMetadataEvent(groupReference)
  }).pipe(Effect.provide(Nip29ServiceLive))

  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    // Fallback to pool-based fetch
    return fetchEventViaPool(pool, groupReference, GROUP_METADATA_KIND)
  }

  return exit.value as Event | null
}

/**
 * Fetches group admins event.
 */
export async function fetchGroupAdminsEvent({
  pool,
  groupReference,
}: {
  pool: SimplePool
  groupReference: GroupReference
}): Promise<Event | null> {
  const program = Effect.gen(function* () {
    const service = yield* Nip29Service
    return yield* service.fetchGroupAdminsEvent(groupReference)
  }).pipe(Effect.provide(Nip29ServiceLive))

  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    return fetchEventViaPool(pool, groupReference, GROUP_ADMINS_KIND)
  }

  return exit.value as Event | null
}

/**
 * Fetches group members event.
 */
export async function fetchGroupMembersEvent({
  pool,
  groupReference,
}: {
  pool: SimplePool
  groupReference: GroupReference
}): Promise<Event | null> {
  const program = Effect.gen(function* () {
    const service = yield* Nip29Service
    return yield* service.fetchGroupMembersEvent(groupReference)
  }).pipe(Effect.provide(Nip29ServiceLive))

  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    return fetchEventViaPool(pool, groupReference, GROUP_MEMBERS_KIND)
  }

  return exit.value as Event | null
}

/**
 * Fallback pool-based event fetch for nostr-tools compatibility.
 */
async function fetchEventViaPool(
  pool: SimplePool,
  groupReference: GroupReference,
  kind: number
): Promise<Event | null> {
  const relayUrl = normalizeURL(groupReference.host)

  const filter: Filter = {
    kinds: [kind],
    "#d": [groupReference.id],
    limit: 1,
  }

  return pool.get([relayUrl], filter) as Promise<Event | null>
}

// =============================================================================
// Load Functions
// =============================================================================

/**
 * Loads a complete group including metadata, admins, and members.
 * Uses Effect-based service internally.
 */
export async function loadGroup({
  pool,
  groupReference,
  skipMetadata,
  skipAdmins,
  skipMembers,
}: {
  pool: SimplePool
  groupReference: GroupReference
  skipMetadata?: boolean
  skipAdmins?: boolean
  skipMembers?: boolean
}): Promise<Group> {
  const serviceParams: Parameters<Nip29Service["loadGroup"]>[0] = { groupReference }
  if (skipMetadata !== undefined) serviceParams.skipMetadata = skipMetadata
  if (skipAdmins !== undefined) serviceParams.skipAdmins = skipAdmins
  if (skipMembers !== undefined) serviceParams.skipMembers = skipMembers

  const program = Effect.gen(function* () {
    const service = yield* Nip29Service
    return yield* service.loadGroup(serviceParams)
  }).pipe(Effect.provide(Nip29ServiceLive))

  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    // Fallback to pool-based loading
    return loadGroupViaPoolInternal(pool, groupReference, skipMetadata, skipAdmins, skipMembers)
  }

  return exit.value
}

/**
 * Fallback pool-based group loading.
 */
async function loadGroupViaPoolInternal(
  pool: SimplePool,
  groupReference: GroupReference,
  skipMetadata?: boolean,
  skipAdmins?: boolean,
  skipMembers?: boolean
): Promise<Group> {
  const relayUrl = normalizeURL(groupReference.host)

  const group: Group = {
    relay: relayUrl,
    metadata: { id: groupReference.id, pubkey: "" },
    reference: groupReference,
  }

  if (!skipMetadata) {
    const metadataEvent = await fetchEventViaPool(pool, groupReference, GROUP_METADATA_KIND)
    if (metadataEvent) {
      group.metadata = parseGroupMetadataEvent(metadataEvent)
    }
  }

  if (!skipAdmins) {
    const adminsEvent = await fetchEventViaPool(pool, groupReference, GROUP_ADMINS_KIND)
    if (adminsEvent) {
      group.admins = parseGroupAdminsEvent(adminsEvent)
    }
  }

  if (!skipMembers) {
    const membersEvent = await fetchEventViaPool(pool, groupReference, GROUP_MEMBERS_KIND)
    if (membersEvent) {
      group.members = parseGroupMembersEvent(membersEvent)
    }
  }

  return group
}

/**
 * Loads a group from a group code string.
 */
export async function loadGroupFromCode({
  pool,
  code,
  skipMetadata,
  skipAdmins,
  skipMembers,
}: {
  pool: SimplePool
  code: string
  skipMetadata?: boolean
  skipAdmins?: boolean
  skipMembers?: boolean
}): Promise<Group | null> {
  const groupReference = parseGroupCode(code)
  if (!groupReference) return null

  const params: Parameters<typeof loadGroup>[0] = { pool, groupReference }
  if (skipMetadata !== undefined) params.skipMetadata = skipMetadata
  if (skipAdmins !== undefined) params.skipAdmins = skipAdmins
  if (skipMembers !== undefined) params.skipMembers = skipMembers

  return loadGroup(params)
}

// =============================================================================
// Subscription Functions
// =============================================================================

/**
 * Subscribes to relay groups metadata events.
 */
export function subscribeRelayGroupsMetadataEvents({
  pool,
  relay,
  onEvent,
  onEose,
}: {
  pool: SimplePool
  relay: string
  onEvent: (event: Event) => void
  onEose?: () => void
}): SubCloser {
  const normalizedUrl = normalizeURL(relay)

  const filter: Filter = {
    kinds: [GROUP_METADATA_KIND],
  }

  const params: { onevent: (event: Event) => void; oneose?: () => void } = {
    onevent: (event) => onEvent(event as Event),
  }
  if (onEose) params.oneose = onEose

  return pool.subscribe([normalizedUrl], filter, params)
}
