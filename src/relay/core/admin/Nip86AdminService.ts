/**
 * Nip86AdminService
 *
 * In-memory admin state and handlers for NIP-86 Management API.
 */
import { Context, Effect, Layer } from "effect"
import type { RelayInfo } from "../RelayInfo.js"

export interface PubkeyEntry { readonly pubkey: string; readonly reason?: string }
export interface EventEntry { readonly id: string; readonly reason?: string }
export interface IpEntry { readonly ip: string; readonly reason?: string }

export interface Nip86AdminService {
  readonly _tag: "Nip86AdminService"

  // Relay info mutations
  changeRelayName(name: string): Effect.Effect<boolean>
  changeRelayDescription(description: string): Effect.Effect<boolean>
  changeRelayIcon(iconUrl: string): Effect.Effect<boolean>
  getRelayInfo(): Effect.Effect<Partial<RelayInfo>>

  // Pubkeys
  banPubkey(pubkey: string, reason?: string): Effect.Effect<boolean>
  listBannedPubkeys(): Effect.Effect<readonly PubkeyEntry[]>
  allowPubkey(pubkey: string, reason?: string): Effect.Effect<boolean>
  listAllowedPubkeys(): Effect.Effect<readonly PubkeyEntry[]>

  // Events
  allowEvent(id: string, reason?: string): Effect.Effect<boolean>
  banEvent(id: string, reason?: string): Effect.Effect<boolean>
  listBannedEvents(): Effect.Effect<readonly EventEntry[]>
  listEventsNeedingModeration(): Effect.Effect<readonly EventEntry[]>

  // Kinds
  allowKind(kind: number): Effect.Effect<boolean>
  disallowKind(kind: number): Effect.Effect<boolean>
  listAllowedKinds(): Effect.Effect<readonly number[]>

  // IPs
  blockIp(ip: string, reason?: string): Effect.Effect<boolean>
  unblockIp(ip: string): Effect.Effect<boolean>
  listBlockedIps(): Effect.Effect<readonly IpEntry[]>
}

export const Nip86AdminService = Context.GenericTag<Nip86AdminService>("Nip86AdminService")

export const Nip86AdminServiceLive = (initialInfo: Partial<RelayInfo> = {}) =>
  Layer.effect(
    Nip86AdminService,
    Effect.sync(() => {
      // Mutable in-memory state (per server instance)
      const bannedPubkeys = new Map<string, string | undefined>()
      const allowedPubkeys = new Map<string, string | undefined>()
      const bannedEvents = new Map<string, string | undefined>()
      const moderationQueue: EventEntry[] = []
      const allowedKinds = new Set<number>()
      const blockedIps = new Map<string, string | undefined>()
      const relayInfo: Partial<RelayInfo> = { ...initialInfo }

      const toList = <T extends { [k: string]: any }>(m: Map<string, any>, key: string): readonly T[] =>
        [...m.entries()].map(([k, v]) => (v ? ({ [key]: k, reason: v } as any) : ({ [key]: k } as any)))

      const svc: Nip86AdminService = {
        _tag: "Nip86AdminService",

        changeRelayName: (name) => Effect.sync(() => {
          ;(relayInfo as any).name = name
          return true
        }),

        changeRelayDescription: (description) => Effect.sync(() => {
          ;(relayInfo as any).description = description
          return true
        }),

        changeRelayIcon: (iconUrl) => Effect.sync(() => {
          ;(relayInfo as any).icon = iconUrl
          return true
        }),

        getRelayInfo: () => Effect.succeed(relayInfo),

        banPubkey: (pubkey, reason) => Effect.sync(() => {
          bannedPubkeys.set(pubkey, reason)
          return true
        }),

        listBannedPubkeys: () => Effect.succeed(toList<PubkeyEntry>(bannedPubkeys, "pubkey")),

        allowPubkey: (pubkey, reason) => Effect.sync(() => {
          allowedPubkeys.set(pubkey, reason)
          return true
        }),

        listAllowedPubkeys: () => Effect.succeed(toList<PubkeyEntry>(allowedPubkeys, "pubkey")),

        allowEvent: (id, _reason) => Effect.sync(() => {
          bannedEvents.delete(id)
          return true
        }),

        banEvent: (id, reason) => Effect.sync(() => {
          bannedEvents.set(id, reason)
          return true
        }),

        listBannedEvents: () => Effect.succeed(toList<EventEntry>(bannedEvents, "id")),

        listEventsNeedingModeration: () => Effect.succeed([...moderationQueue]),

        allowKind: (kind) => Effect.sync(() => {
          allowedKinds.add(kind)
          return true
        }),

        disallowKind: (kind) => Effect.sync(() => {
          allowedKinds.delete(kind)
          return true
        }),

        listAllowedKinds: () => Effect.succeed([...allowedKinds.values()]),

        blockIp: (ip, reason) => Effect.sync(() => {
          blockedIps.set(ip, reason)
          return true
        }),

        unblockIp: (ip) => Effect.sync(() => {
          blockedIps.delete(ip)
          return true
        }),

        listBlockedIps: () => Effect.succeed(toList<IpEntry>(blockedIps, "ip")),
      }

      return svc
    })
  )

