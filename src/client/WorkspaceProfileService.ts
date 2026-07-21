/**
 * WorkspaceProfileService
 *
 * NIP-WP: Workspace Profile (kind 9033).
 *
 * Admin/owner-signed command to set or clear a relay-scoped workspace icon.
 * Write path: kind 9033 with an `icon` tag (content empty). Read path: plain
 * NIP-11 `icon` on the relay information document — no new event kind.
 *
 * This module implements the protocol helpers (build/validate command, read
 * icon via NIP-11, pure role-gated admission). Full relay storage/module
 * wiring is left to the host relay.
 *
 * @see NIP-WP: ~/work/projects/repos/buzz/docs/nips/NIP-WP.md
 * @see NIP-11: ~/code/nips/11.md
 * @see NIP-43: ~/code/nips/43.md (admin/owner role state)
 */
import { Context, Data, Effect, Layer, Schema } from "effect"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import {
  EventKind,
  Tag,
  type NostrEvent,
  type PrivateKey,
} from "../core/Schema.js"
import {
  fetchRelayInformation,
  type RelayInformation,
} from "../core/Nip11.js"
import { SetWorkspaceProfile as SET_WORKSPACE_PROFILE_KIND } from "../wrappers/kinds.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeTag = Schema.decodeSync(Tag)

// =============================================================================
// Constants
// =============================================================================

/** Kind 9033 — Set Workspace Profile (NIP-WP). */
export const WORKSPACE_PROFILE_KIND = SET_WORKSPACE_PROFILE_KIND

/** Tag name carrying the workspace icon value. */
export const ICON_TAG = "icon"

/** Recommended max length for plain `http(s)` icon URLs (bytes / UTF-16 length). */
export const MAX_ICON_URL_BYTES = 2048

/** Recommended max length for inline `data:image/*` icon URLs. */
export const MAX_ICON_DATA_URL_BYTES = 96 * 1024

/** Roles authorized to publish kind 9033. */
export type WorkspaceAdminRole = "admin" | "owner"

const CONTROL_OR_WS = /[\u0000-\u001f\u007f\s]/

// =============================================================================
// Errors
// =============================================================================

/** Failure while building, validating, publishing, or reading a workspace profile. */
export class WorkspaceProfileError extends Data.TaggedError("WorkspaceProfileError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// =============================================================================
// Pure icon validation
// =============================================================================

/**
 * Validate an icon value for NIP-WP write path.
 *
 * - empty string → clear (valid)
 * - `http://` or `https://` URL → valid within {@link MAX_ICON_URL_BYTES}
 * - `data:image/*` URL → valid within {@link MAX_ICON_DATA_URL_BYTES}
 * - any whitespace/control characters → invalid
 * - other schemes (e.g. `javascript:`) or non-image `data:` → invalid
 */
export const isValidIconValue = (value: string): boolean => {
  if (value === "") return true
  if (CONTROL_OR_WS.test(value)) return false

  if (value.startsWith("https://") || value.startsWith("http://")) {
    return value.length <= MAX_ICON_URL_BYTES
  }

  if (value.startsWith("data:image/")) {
    // data:image/<type>[;params],payload — require a comma separating metadata from data
    const comma = value.indexOf(",")
    if (comma <= "data:image/".length) return false
    const meta = value.slice("data:".length, comma) // e.g. "image/webp;base64"
    if (!meta.startsWith("image/")) return false
    // subtype must be non-empty before optional params
    const subtype = meta.slice("image/".length).split(";", 1)[0] ?? ""
    if (subtype.length === 0) return false
    return value.length <= MAX_ICON_DATA_URL_BYTES
  }

  return false
}

/**
 * Extract the icon value from tags for a kind 9033 command.
 *
 * Returns:
 * - `{ ok: true, icon: string }` when a non-empty valid icon is set
 * - `{ ok: true, icon: null }` when clearing (absent tag or empty value)
 * - `{ ok: false, reason }` on structural/value errors
 */
export type IconParseResult =
  | { readonly ok: true; readonly icon: string | null }
  | { readonly ok: false; readonly reason: string }

export const parseIconFromTags = (
  tags: readonly (readonly string[])[]
): IconParseResult => {
  const iconTags = tags.filter((t) => t[0] === ICON_TAG)
  if (iconTags.length > 1) {
    return { ok: false, reason: "exactly one icon tag is required (found multiple)" }
  }
  if (iconTags.length === 0) {
    return { ok: true, icon: null }
  }
  const raw = iconTags[0]![1] ?? ""
  if (!isValidIconValue(raw)) {
    return {
      ok: false,
      reason:
        "icon must be empty (clear), an http(s) URL, or a data:image/* URL with no whitespace/control characters",
    }
  }
  return { ok: true, icon: raw === "" ? null : raw }
}

/**
 * Validate a kind 9033 Set Workspace Profile command structure.
 * Does not check signatures or roles.
 */
export type CommandValidationResult =
  | { readonly ok: true; readonly icon: string | null }
  | { readonly ok: false; readonly reason: string }

/** Minimal event shape for structural validation of kind 9033. */
export interface WorkspaceProfileCommandShape {
  readonly kind: number
  readonly content: string
  readonly tags: readonly (readonly string[])[]
  readonly pubkey?: string
}

export const validateSetWorkspaceProfileCommand = (
  event: WorkspaceProfileCommandShape
): CommandValidationResult => {
  if (event.kind !== WORKSPACE_PROFILE_KIND) {
    return { ok: false, reason: `expected kind ${WORKSPACE_PROFILE_KIND}, got ${event.kind}` }
  }
  if (event.content !== "") {
    return { ok: false, reason: "content must be empty for kind 9033" }
  }
  return parseIconFromTags(event.tags)
}

/**
 * Pure relay admission helper for kind 9033.
 *
 * Checks structural validity and that the actor holds an `admin` or
 * `owner` role in the provided role set (NIP-43 access-control state).
 * Signature verification is left to the host pipeline.
 */
export type AdmitResult =
  | { readonly admit: true; readonly icon: string | null }
  | { readonly admit: false; readonly reason: string }

export const admitSetWorkspaceProfile = (
  event: WorkspaceProfileCommandShape,
  roles: ReadonlySet<WorkspaceAdminRole | string>
): AdmitResult => {
  const structure = validateSetWorkspaceProfileCommand(event)
  if (!structure.ok) {
    return { admit: false, reason: structure.reason }
  }
  const isAdmin = roles.has("admin") || roles.has("owner")
  if (!isAdmin) {
    return {
      admit: false,
      reason: "actor must hold admin or owner role to set workspace profile",
    }
  }
  return { admit: true, icon: structure.icon }
}

/**
 * Read the presentation icon from a NIP-11 document.
 * Empty/missing → `null` (caller falls back to a local placeholder).
 */
export const iconFromRelayInformation = (
  info: Pick<RelayInformation, "icon">
): string | null => {
  const icon = info.icon
  if (typeof icon !== "string" || icon.length === 0) return null
  return icon
}

// =============================================================================
// Service options
// =============================================================================

export interface SetWorkspaceProfileParams {
  /**
   * Icon value to set. Pass `null`, `undefined`, or `""` to clear.
   * Non-empty values must be `http(s)` or `data:image/*` URLs.
   */
  readonly icon?: string | null
  /** Override `created_at` (unix seconds) for deterministic tests. */
  readonly createdAt?: number
}

// =============================================================================
// Service interface
// =============================================================================

export interface WorkspaceProfileService {
  readonly _tag: "WorkspaceProfileService"

  /**
   * Build and sign a kind 9033 Set Workspace Profile command.
   * Always emits exactly one `icon` tag (empty string when clearing).
   */
  buildSetWorkspaceProfile(
    params: SetWorkspaceProfileParams,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, WorkspaceProfileError>

  /**
   * Build, sign, and publish a kind 9033 command via {@link RelayService}.
   */
  publishSetWorkspaceProfile(
    params: SetWorkspaceProfileParams,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, WorkspaceProfileError | RelayError>

  /**
   * Fetch the workspace icon from a relay's NIP-11 document.
   * Uses `relayUrl` when provided; otherwise the connected {@link RelayService} URL.
   */
  getWorkspaceIcon(
    relayUrl?: string
  ): Effect.Effect<string | null, WorkspaceProfileError>
}

export const WorkspaceProfileService = Context.Service<WorkspaceProfileService>(
  "WorkspaceProfileService"
)

// =============================================================================
// Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const buildSetWorkspaceProfile: WorkspaceProfileService["buildSetWorkspaceProfile"] = (
    params,
    privateKey
  ) =>
    Effect.gen(function* () {
      const raw = params.icon ?? ""
      if (!isValidIconValue(raw)) {
        return yield* Effect.fail(
          new WorkspaceProfileError({
            message:
              "icon must be empty (clear), an http(s) URL, or a data:image/* URL with no whitespace/control characters",
          })
        )
      }

      const tags = [decodeTag([ICON_TAG, raw])]
      const event = yield* events
        .createEvent(
          {
            kind: decodeKind(WORKSPACE_PROFILE_KIND),
            content: "",
            tags,
            created_at: (params.createdAt ?? undefined) as never,
          },
          privateKey
        )
        .pipe(
          Effect.mapError(
            (e) =>
              new WorkspaceProfileError({
                message: `failed to sign kind 9033: ${String(e)}`,
                cause: e,
              })
          )
        )
      return event
    })

  const publishSetWorkspaceProfile: WorkspaceProfileService["publishSetWorkspaceProfile"] = (
    params,
    privateKey
  ) =>
    Effect.gen(function* () {
      const event = yield* buildSetWorkspaceProfile(params, privateKey)
      return yield* relay.publish(event).pipe(
        Effect.mapError(
          (e) =>
            new RelayError({
              message: String(e),
              relay: relay.url,
            })
        )
      )
    })

  const getWorkspaceIcon: WorkspaceProfileService["getWorkspaceIcon"] = (relayUrl) =>
    Effect.gen(function* () {
      const url = relayUrl ?? relay.url
      const info = yield* Effect.tryPromise({
        try: () => fetchRelayInformation(url),
        catch: (e) =>
          new WorkspaceProfileError({
            message: `failed to fetch NIP-11 for ${url}: ${String(e)}`,
            cause: e,
          }),
      })
      return iconFromRelayInformation(info)
    })

  return {
    _tag: "WorkspaceProfileService" as const,
    buildSetWorkspaceProfile,
    publishSetWorkspaceProfile,
    getWorkspaceIcon,
  } satisfies WorkspaceProfileService
})

export const WorkspaceProfileServiceLive = Layer.effect(WorkspaceProfileService, make)
