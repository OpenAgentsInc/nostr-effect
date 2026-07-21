/**
 * NIP-IA: Identity Archival
 *
 * Thin Promise-style wrappers around the Effect client builders.
 * Authoritative implementation: `src/client/NipIAService.ts`.
 *
 * Spec: ~/work/projects/repos/buzz/docs/nips/NIP-IA.md
 */
import {
  ARCHIVE_REQUEST_KIND,
  UNARCHIVE_REQUEST_KIND,
  ARCHIVED_IDENTITY_KIND,
  UNARCHIVED_IDENTITY_KIND,
  ARCHIVED_IDENTITIES_LIST_KIND,
  buildArchiveRequestTemplate,
  buildUnarchiveRequestTemplate,
  buildArchivedDeltaTemplate,
  buildUnarchivedDeltaTemplate,
  buildArchiveSnapshotTemplate,
  type RequestOptions,
  type DeltaOptions,
  type SnapshotOptions,
  type NipIaEventTemplate,
  type ConsentTag,
} from "../client/NipIAService.js"

// Re-export kinds for Promise-API consumers
export const ArchiveRequestKind = ARCHIVE_REQUEST_KIND
export const UnarchiveRequestKind = UNARCHIVE_REQUEST_KIND
export const ArchivedIdentityKind = ARCHIVED_IDENTITY_KIND
export const UnarchivedIdentityKind = UNARCHIVED_IDENTITY_KIND
export const ArchivedIdentitiesListKind = ARCHIVED_IDENTITIES_LIST_KIND

export type {
  RequestOptions,
  DeltaOptions,
  SnapshotOptions,
  NipIaEventTemplate,
  ConsentTag,
}

import { Effect } from "effect"

/** Build an unsigned archive request template (`kind:9035`). */
export function buildArchiveRequest(options: RequestOptions): NipIaEventTemplate {
  return Effect.runSync(buildArchiveRequestTemplate(options))
}

/** Build an unsigned unarchive request template (`kind:9036`). */
export function buildUnarchiveRequest(
  options: RequestOptions
): NipIaEventTemplate {
  return Effect.runSync(buildUnarchiveRequestTemplate(options))
}

/** Build an unsigned archived-identity delta template (`kind:8002`). */
export function buildArchivedIdentity(
  options: DeltaOptions
): NipIaEventTemplate {
  return Effect.runSync(buildArchivedDeltaTemplate(options))
}

/** Build an unsigned unarchived-identity delta template (`kind:8003`). */
export function buildUnarchivedIdentity(
  options: DeltaOptions
): NipIaEventTemplate {
  return Effect.runSync(buildUnarchivedDeltaTemplate(options))
}

/** Build an unsigned archived identities list template (`kind:13535`). */
export function buildArchivedIdentitiesList(
  options: SnapshotOptions
): NipIaEventTemplate {
  return Effect.runSync(buildArchiveSnapshotTemplate(options))
}
