/**
 * Nip29Service
 *
 * NIP-29: Relay-based Groups service.
 * Provides Effect-based methods for interacting with relay-based groups.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/29.md
 */
import { Context, Effect, Layer, Stream, Option } from "effect"
import { Schema } from "@effect/schema"
import { makeRelayServiceScoped } from "./RelayService.js"
import { ConnectionError, SubscriptionError } from "../core/Errors.js"
import {
  type NostrEvent,
  Filter,
  EventKind,
} from "../core/Schema.js"

// =============================================================================
// Types
// =============================================================================

const decodeFilter = Schema.decodeSync(Filter)
const decodeKind = Schema.decodeSync(EventKind)

/** Represents a NIP-29 group */
export interface Group {
  relay: string
  metadata: GroupMetadata
  admins?: GroupAdmin[]
  members?: GroupMember[]
  reference: GroupReference
}

/** Represents the metadata for a NIP-29 group */
export interface GroupMetadata {
  id: string
  pubkey: string
  name?: string
  picture?: string
  about?: string
  isPublic?: boolean
  isOpen?: boolean
}

/** Represents a NIP-29 group reference */
export interface GroupReference {
  id: string
  host: string
}

/** Represents a NIP-29 group member */
export interface GroupMember {
  pubkey: string
  label?: string
}

/** Represents a NIP-29 group admin */
export interface GroupAdmin {
  pubkey: string
  label?: string
  permissions: GroupAdminPermission[]
}

/** Represents the permissions that a NIP-29 group admin can have */
export enum GroupAdminPermission {
  AddUser = "add-user",
  EditMetadata = "edit-metadata",
  DeleteEvent = "delete-event",
  RemoveUser = "remove-user",
  PutUser = "put-user",
  CreateGroup = "create-group",
  DeleteGroup = "delete-group",
  CreateInvite = "create-invite",
}

// NIP-29 Event Kinds
export const GROUP_METADATA_KIND = 39000
export const GROUP_ADMINS_KIND = 39001
export const GROUP_MEMBERS_KIND = 39002

/** NIP-11 Relay Information */
export interface RelayInformation {
  name?: string
  description?: string
  pubkey?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  limitation?: Record<string, unknown>
  relay_countries?: string[]
  language_tags?: string[]
  tags?: string[]
  posting_policy?: string
  payments_url?: string
  fees?: Record<string, unknown>
}

// =============================================================================
// Service Interface
// =============================================================================

export interface Nip29Service {
  readonly _tag: "Nip29Service"

  /**
   * Load a group from a relay
   */
  loadGroup(params: {
    groupReference: GroupReference
    skipMetadata?: boolean
    skipAdmins?: boolean
    skipMembers?: boolean
  }): Effect.Effect<Group, ConnectionError | SubscriptionError>

  /**
   * Fetch group metadata event
   */
  fetchGroupMetadataEvent(
    groupReference: GroupReference
  ): Effect.Effect<NostrEvent | null, ConnectionError | SubscriptionError>

  /**
   * Fetch group admins event
   */
  fetchGroupAdminsEvent(
    groupReference: GroupReference
  ): Effect.Effect<NostrEvent | null, ConnectionError | SubscriptionError>

  /**
   * Fetch group members event
   */
  fetchGroupMembersEvent(
    groupReference: GroupReference
  ): Effect.Effect<NostrEvent | null, ConnectionError | SubscriptionError>

  /**
   * Get relay information for a group
   */
  fetchRelayInformation(
    groupReference: GroupReference
  ): Effect.Effect<RelayInformation, ConnectionError>

  /**
   * Parse a group metadata event
   */
  parseGroupMetadataEvent(event: NostrEvent): GroupMetadata

  /**
   * Parse a group admins event
   */
  parseGroupAdminsEvent(event: NostrEvent): GroupAdmin[]

  /**
   * Parse a group members event
   */
  parseGroupMembersEvent(event: NostrEvent): GroupMember[]
}

// =============================================================================
// Service Tag
// =============================================================================

export const Nip29Service = Context.GenericTag<Nip29Service>("Nip29Service")

// =============================================================================
// Helper Functions
// =============================================================================

function normalizeURL(url: string): string {
  let normalized = url.trim()

  // Add protocol if missing
  if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
    normalized = `wss://${normalized}`
  }

  // Remove trailing slash
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

function parseMetadataFromEvent(event: NostrEvent): GroupMetadata {
  const metadata: GroupMetadata = {
    id: "",
    pubkey: event.pubkey,
  }

  for (const tag of event.tags) {
    const [tagName, tagValue] = tag
    // Presence-only toggles
    if (tagName === "public") metadata.isPublic = true
    if (tagName === "open") metadata.isOpen = true

    // Value-based fields
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
    }
  }

  return metadata
}

function parseAdminsFromEvent(event: NostrEvent): GroupAdmin[] {
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

function parseMembersFromEvent(event: NostrEvent): GroupMember[] {
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
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const fetchEventByKind = (
    relayUrl: string,
    groupId: string,
    kind: number
  ): Effect.Effect<NostrEvent | null, ConnectionError | SubscriptionError> =>
    Effect.gen(function* () {
      const relay = yield* makeRelayServiceScoped({ url: relayUrl })
      yield* relay.connect()

      const filter = decodeFilter({
        kinds: [decodeKind(kind)],
        "#d": [groupId],
        limit: 1,
      })

      const sub = yield* relay.subscribe([filter])

      const maybeEvent = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(3000).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))

      yield* sub.unsubscribe()
      yield* relay.disconnect()

      return Option.isSome(maybeEvent) ? maybeEvent.value : null
    })

  const loadGroup: Nip29Service["loadGroup"] = (params) =>
    Effect.gen(function* () {
      const { groupReference, skipMetadata, skipAdmins, skipMembers } = params
      const relayUrl = normalizeURL(groupReference.host)

      const group: Group = {
        relay: relayUrl,
        metadata: { id: groupReference.id, pubkey: "" },
        reference: groupReference,
      }

      // Fetch metadata
      if (!skipMetadata) {
        const metadataEvent = yield* fetchEventByKind(
          relayUrl,
          groupReference.id,
          GROUP_METADATA_KIND
        )
        if (metadataEvent) {
          group.metadata = parseMetadataFromEvent(metadataEvent)
        }
      }

      // Fetch admins
      if (!skipAdmins) {
        const adminsEvent = yield* fetchEventByKind(
          relayUrl,
          groupReference.id,
          GROUP_ADMINS_KIND
        )
        if (adminsEvent) {
          group.admins = parseAdminsFromEvent(adminsEvent)
        }
      }

      // Fetch members
      if (!skipMembers) {
        const membersEvent = yield* fetchEventByKind(
          relayUrl,
          groupReference.id,
          GROUP_MEMBERS_KIND
        )
        if (membersEvent) {
          group.members = parseMembersFromEvent(membersEvent)
        }
      }

      return group
    })

  const fetchGroupMetadataEvent: Nip29Service["fetchGroupMetadataEvent"] = (
    groupReference
  ) =>
    fetchEventByKind(
      normalizeURL(groupReference.host),
      groupReference.id,
      GROUP_METADATA_KIND
    )

  const fetchGroupAdminsEvent: Nip29Service["fetchGroupAdminsEvent"] = (
    groupReference
  ) =>
    fetchEventByKind(
      normalizeURL(groupReference.host),
      groupReference.id,
      GROUP_ADMINS_KIND
    )

  const fetchGroupMembersEvent: Nip29Service["fetchGroupMembersEvent"] = (
    groupReference
  ) =>
    fetchEventByKind(
      normalizeURL(groupReference.host),
      groupReference.id,
      GROUP_MEMBERS_KIND
    )

  const fetchRelayInformation: Nip29Service["fetchRelayInformation"] = (
    groupReference
  ) =>
    Effect.gen(function* () {
      const relayUrl = normalizeURL(groupReference.host)
      // Convert wss:// to https:// for NIP-11 HTTP request
      const httpUrl = relayUrl.replace(/^wss?:\/\//, "https://")

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(httpUrl, {
            headers: { Accept: "application/nostr+json" },
          }),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to fetch relay info: ${error}`,
            url: relayUrl,
          }),
      })

      if (!response.ok) {
        return yield* Effect.fail(
          new ConnectionError({
            message: `Failed to fetch relay info: ${response.status}`,
            url: relayUrl,
          })
        )
      }

      const info = yield* Effect.tryPromise({
        try: () => response.json() as Promise<RelayInformation>,
        catch: (error) =>
          new ConnectionError({
            message: `Failed to parse relay info: ${error}`,
            url: relayUrl,
          }),
      })

      return info
    })

  const parseGroupMetadataEvent: Nip29Service["parseGroupMetadataEvent"] = (
    event
  ) => parseMetadataFromEvent(event)

  const parseGroupAdminsEvent: Nip29Service["parseGroupAdminsEvent"] = (
    event
  ) => parseAdminsFromEvent(event)

  const parseGroupMembersEvent: Nip29Service["parseGroupMembersEvent"] = (
    event
  ) => parseMembersFromEvent(event)

  return {
    _tag: "Nip29Service" as const,
    loadGroup,
    fetchGroupMetadataEvent,
    fetchGroupAdminsEvent,
    fetchGroupMembersEvent,
    fetchRelayInformation,
    parseGroupMetadataEvent,
    parseGroupAdminsEvent,
    parseGroupMembersEvent,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for Nip29Service
 */
export const Nip29ServiceLive = Layer.effect(Nip29Service, make)
