/**
 * OpenAgents draft NIPs (SA / AC / SKL / TRN / LBR / DS)
 *
 * Living specs at openagents/docs/nips/. Not upstream nostr-protocol/nips.
 * This module provides kind constants + minimal event templates for interop.
 * LBR/DS dataset+labor kinds also live in Nip90.ts; re-exported here for discovery.
 */

import type { EventKind, UnixTimestamp } from "./Schema.js"
import {
  KIND_DATASET_LISTING,
  KIND_DATASET_OFFER,
  KIND_JOB_LABOR_CODE_TASK,
  KIND_JOB_LABOR_REVIEW,
  KIND_JOB_LABOR_DOCUMENT_WORK,
} from "./Nip90.js"

// =============================================================================
// NIP-SA — Sovereign Agents
// =============================================================================

export const SA_AGENT_PROFILE_KIND = 39200 as EventKind
export const SA_STATE_STORAGE_KIND = 39201 as EventKind
export const SA_SCHEDULE_KIND = 39202 as EventKind
export const SA_GOALS_KIND = 39203 as EventKind
export const SA_TICK_REQUEST_KIND = 39210 as EventKind
export const SA_TICK_RESULT_KIND = 39211 as EventKind
export const SA_GUARDIAN_APPROVAL_REQUEST_KIND = 39212 as EventKind
export const SA_GUARDIAN_APPROVAL_KIND = 39213 as EventKind
export const SA_SKILL_LICENSE_KIND = 39220 as EventKind
export const SA_SKILL_DELIVERY_KIND = 39221 as EventKind
export const SA_TRAJECTORY_SESSION_KIND = 39230 as EventKind
export const SA_TRAJECTORY_KIND = 39231 as EventKind

// =============================================================================
// NIP-AC — Agent Credit
// =============================================================================

export const AC_ENVELOPE_KIND = 39242 as EventKind
export const AC_SPEND_AUTHORIZATION_KIND = 39243 as EventKind
export const AC_SETTLEMENT_RECEIPT_KIND = 39244 as EventKind
export const AC_DEFAULT_NOTICE_KIND = 39245 as EventKind
export const AC_CANCEL_SPEND_KIND = 39246 as EventKind

// =============================================================================
// NIP-SKL — Skills
// =============================================================================

export const SKL_MANIFEST_KIND = 33400 as EventKind
export const SKL_VERSION_LOG_KIND = 33401 as EventKind
export const SKL_AUTH_CHALLENGE_KIND = 33410 as EventKind
export const SKL_AUTH_RESPONSE_KIND = 33411 as EventKind

// =============================================================================
// NIP-TRN — Training Network
// =============================================================================

export const TRN_NETWORK_CONTRACT_KIND = 39500 as EventKind
export const TRN_NODE_RECORD_KIND = 39501 as EventKind
export const TRN_WINDOW_KIND = 39510 as EventKind
export const TRN_RECEIPT_KIND = 39511 as EventKind
export const TRN_VERDICT_KIND = 39512 as EventKind
export const TRN_ARTIFACT_LOCATOR_KIND = 39520 as EventKind
export const TRN_CONTRIBUTION_CLOSEOUT_KIND = 39530 as EventKind

// =============================================================================
// NIP-LBR / NIP-DS (via Nip90 labor/dataset kinds)
// =============================================================================

export const LBR_CODE_TASK_KIND = KIND_JOB_LABOR_CODE_TASK as EventKind
export const LBR_REVIEW_KIND = KIND_JOB_LABOR_REVIEW as EventKind
export const LBR_DOCUMENT_WORK_KIND = KIND_JOB_LABOR_DOCUMENT_WORK as EventKind
export const DS_LISTING_KIND = KIND_DATASET_LISTING as EventKind
export const DS_OFFER_KIND = KIND_DATASET_OFFER as EventKind

export interface DraftEventTemplate {
  readonly kind: EventKind
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly created_at: UnixTimestamp
}

const now = (): UnixTimestamp => Math.floor(Date.now() / 1000) as UnixTimestamp

/** SA agent profile (addressable-ish content JSON + tags) */
export function generateSaAgentProfileTemplate(params: {
  readonly name: string
  readonly about?: string
  readonly lud16?: string
  readonly contentJson?: Record<string, unknown>
}): DraftEventTemplate {
  const tags: string[][] = [["name", params.name]]
  if (params.about) tags.push(["about", params.about])
  if (params.lud16) tags.push(["lud16", params.lud16])
  return {
    kind: SA_AGENT_PROFILE_KIND,
    tags,
    content: JSON.stringify(params.contentJson ?? { name: params.name, about: params.about }),
    created_at: now(),
  }
}

/** SKL skill manifest (kind 33400) requires d + version tags at minimum */
export function generateSklManifestTemplate(params: {
  readonly d: string
  readonly version: string
  readonly name: string
  readonly description?: string
  readonly content?: string
}): DraftEventTemplate {
  const tags: string[][] = [
    ["d", params.d],
    ["version", params.version],
    ["name", params.name],
  ]
  if (params.description) tags.push(["description", params.description])
  return {
    kind: SKL_MANIFEST_KIND,
    tags,
    content: params.content ?? "",
    created_at: now(),
  }
}

/** AC credit envelope (kind 39242, addressable by d=envelope_id) */
export function generateAcEnvelopeTemplate(params: {
  readonly envelopeId: string
  readonly maxSats: number
  readonly status: string
  readonly spendRail?: string
  readonly extraTags?: readonly (readonly string[])[]
}): DraftEventTemplate {
  const tags: string[][] = [
    ["d", params.envelopeId],
    ["max", String(params.maxSats)],
    ["status", params.status],
  ]
  if (params.spendRail) tags.push(["spend_rail", params.spendRail])
  if (params.extraTags) for (const t of params.extraTags) tags.push([...t])
  return { kind: AC_ENVELOPE_KIND, tags, content: "", created_at: now() }
}

/** TRN network contract (kind 39500) */
export function generateTrnNetworkContractTemplate(params: {
  readonly d: string
  readonly name: string
  readonly content?: string
}): DraftEventTemplate {
  return {
    kind: TRN_NETWORK_CONTRACT_KIND,
    tags: [
      ["d", params.d],
      ["name", params.name],
    ],
    content: params.content ?? "",
    created_at: now(),
  }
}

/** SA tick request (kind 39210) */
export function generateSaTickRequestTemplate(params: {
  readonly agentPubkey: string
  readonly budgetSats?: number
  readonly spendRail?: string
  readonly envelopeId?: string
  readonly guardian?: string
  readonly approvalThreshold?: number
  readonly content?: string
}): DraftEventTemplate {
  const tags: string[][] = [["p", params.agentPubkey]]
  if (params.budgetSats !== undefined) {
    if (params.spendRail === "envelope" && params.envelopeId) {
      tags.push(["budget", String(params.budgetSats), "envelope", params.envelopeId])
    } else if (params.spendRail) {
      tags.push(["budget", String(params.budgetSats), params.spendRail])
    } else {
      tags.push(["budget", String(params.budgetSats)])
    }
  }
  if (params.guardian) tags.push(["guardian", params.guardian])
  if (params.approvalThreshold !== undefined) {
    tags.push(["approval_threshold", String(params.approvalThreshold)])
  }
  return {
    kind: SA_TICK_REQUEST_KIND,
    tags,
    content: params.content ?? "",
    created_at: now(),
  }
}

/** AC spend authorization (kind 39243) */
export function generateAcSpendAuthorizationTemplate(params: {
  readonly envelopeId: string
  readonly amountSats: number
  readonly providerPubkey?: string
  readonly jobEventId?: string
  readonly content?: string
}): DraftEventTemplate {
  const tags: string[][] = [
    ["envelope", params.envelopeId],
    ["amount", String(params.amountSats)],
  ]
  if (params.providerPubkey) tags.push(["p", params.providerPubkey])
  if (params.jobEventId) tags.push(["e", params.jobEventId])
  return {
    kind: AC_SPEND_AUTHORIZATION_KIND,
    tags,
    content: params.content ?? "",
    created_at: now(),
  }
}

/** TRN training window (kind 39510) */
export function generateTrnWindowTemplate(params: {
  readonly d: string
  readonly networkId: string
  readonly round?: number
  readonly content?: string
}): DraftEventTemplate {
  const tags: string[][] = [
    ["d", params.d],
    ["network", params.networkId],
  ]
  if (params.round !== undefined) tags.push(["round", String(params.round)])
  return {
    kind: TRN_WINDOW_KIND,
    tags,
    content: params.content ?? "",
    created_at: now(),
  }
}

/** All draft kind numbers for discovery / documentation */
export const OPENAGENTS_DRAFT_KINDS = {
  SA: [
    SA_AGENT_PROFILE_KIND,
    SA_STATE_STORAGE_KIND,
    SA_SCHEDULE_KIND,
    SA_GOALS_KIND,
    SA_TICK_REQUEST_KIND,
    SA_TICK_RESULT_KIND,
    SA_GUARDIAN_APPROVAL_REQUEST_KIND,
    SA_GUARDIAN_APPROVAL_KIND,
    SA_SKILL_LICENSE_KIND,
    SA_SKILL_DELIVERY_KIND,
    SA_TRAJECTORY_SESSION_KIND,
    SA_TRAJECTORY_KIND,
  ],
  AC: [
    AC_ENVELOPE_KIND,
    AC_SPEND_AUTHORIZATION_KIND,
    AC_SETTLEMENT_RECEIPT_KIND,
    AC_DEFAULT_NOTICE_KIND,
    AC_CANCEL_SPEND_KIND,
  ],
  SKL: [SKL_MANIFEST_KIND, SKL_VERSION_LOG_KIND, SKL_AUTH_CHALLENGE_KIND, SKL_AUTH_RESPONSE_KIND],
  TRN: [
    TRN_NETWORK_CONTRACT_KIND,
    TRN_NODE_RECORD_KIND,
    TRN_WINDOW_KIND,
    TRN_RECEIPT_KIND,
    TRN_VERDICT_KIND,
    TRN_ARTIFACT_LOCATOR_KIND,
    TRN_CONTRIBUTION_CLOSEOUT_KIND,
  ],
  LBR: [LBR_CODE_TASK_KIND, LBR_REVIEW_KIND, LBR_DOCUMENT_WORK_KIND],
  DS: [DS_LISTING_KIND, DS_OFFER_KIND],
} as const
