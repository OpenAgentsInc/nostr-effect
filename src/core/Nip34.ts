/**
 * NIP-34: Git Collaboration
 * https://github.com/nostr-protocol/nips/blob/master/34.md
 *
 * Git-based code collaboration over Nostr including repository announcements,
 * patches, pull requests, issues, and status tracking.
 */
import type { EventKind, UnixTimestamp, NostrEvent } from "./Schema.js"

// =============================================================================
// Event Kinds
// =============================================================================

/** Kind 30617: Repository Announcement (parameterized replaceable) */
export const REPOSITORY_KIND = 30617 as EventKind

/** Kind 30618: Repository State (branches/tags) */
export const REPOSITORY_STATE_KIND = 30618 as EventKind

/** Kind 1617: Patch */
export const PATCH_KIND = 1617 as EventKind

/** Kind 1618: Pull Request */
export const PULL_REQUEST_KIND = 1618 as EventKind

/** Kind 1619: Pull Request Update */
export const PULL_REQUEST_UPDATE_KIND = 1619 as EventKind

/** Kind 1621: Issue */
export const ISSUE_KIND = 1621 as EventKind

/** Kind 1630: Status - Open */
export const STATUS_OPEN_KIND = 1630 as EventKind

/** Kind 1631: Status - Applied/Merged/Resolved */
export const STATUS_APPLIED_KIND = 1631 as EventKind

/** Kind 1632: Status - Closed */
export const STATUS_CLOSED_KIND = 1632 as EventKind

/** Kind 1633: Status - Draft */
export const STATUS_DRAFT_KIND = 1633 as EventKind

/** Kind 10317: User Grasp Server List */
export const GRASP_LIST_KIND = 10317 as EventKind

// =============================================================================
// Types
// =============================================================================

/** Event template for signing */
export interface EventTemplate {
  content: string
  created_at: UnixTimestamp
  kind: EventKind
  tags: string[][]
}

/**
 * Repository announcement data
 */
export interface Repository {
  /** Repository identifier (usually kebab-case short name) */
  id: string
  /** Human-readable project name */
  name?: string
  /** Brief project description */
  description?: string
  /** URLs for web browsing */
  web?: string[]
  /** URLs for git cloning */
  clone?: string[]
  /** Relay URLs for patches and issues */
  relays?: string[]
  /** Earliest unique commit ID */
  earliestUniqueCommit?: string
  /** Additional maintainer pubkeys */
  maintainers?: string[]
  /** Hashtags for the repository */
  tags?: string[]
  /** Whether this is a personal fork (not accepting contributions) */
  isPersonalFork?: boolean
}

/**
 * Repository state (branches and tags)
 */
export interface RepositoryState {
  /** Repository identifier */
  id: string
  /** Map of ref paths to commit IDs (e.g., "refs/heads/main" -> "abc123") */
  refs: Map<string, string[]>
  /** HEAD reference (e.g., "ref: refs/heads/main") */
  head?: string
}

/**
 * Patch data
 */
export interface Patch {
  /** The patch content (git format-patch output) */
  content: string
  /** Repository address (30617:<pubkey>:<id>) */
  repository?: string
  /** Earliest unique commit ID of the repo */
  earliestUniqueCommit?: string
  /** Repository owner pubkey */
  repositoryOwner?: string
  /** Additional pubkeys to notify */
  mentions?: string[]
  /** Whether this is the root patch in a series */
  isRoot?: boolean
  /** Whether this is the root of a revision */
  isRootRevision?: boolean
  /** Current commit ID */
  commit?: string
  /** Parent commit ID */
  parentCommit?: string
  /** Commit PGP signature */
  commitPgpSig?: string
  /** Committer info: [name, email, timestamp, timezone] */
  committer?: [string, string, string, string]
}

/**
 * Pull request data
 */
export interface PullRequest {
  /** PR description (markdown) */
  content: string
  /** Repository address (30617:<pubkey>:<id>) */
  repository?: string
  /** Earliest unique commit ID of the repo */
  earliestUniqueCommit?: string
  /** Repository owner pubkey */
  repositoryOwner?: string
  /** Additional pubkeys to notify */
  mentions?: string[]
  /** PR subject/title */
  subject?: string
  /** Labels */
  labels?: string[]
  /** Tip commit ID */
  commit: string
  /** Clone URLs where commit can be downloaded */
  clone: string[]
  /** Recommended branch name */
  branchName?: string
  /** Root patch event ID if this is a revision */
  rootPatchId?: string
  /** Most recent common ancestor with target branch */
  mergeBase?: string
}

/**
 * Pull request update data
 */
export interface PullRequestUpdate {
  /** Repository address (30617:<pubkey>:<id>) */
  repository?: string
  /** Earliest unique commit ID of the repo */
  earliestUniqueCommit?: string
  /** Repository owner pubkey */
  repositoryOwner?: string
  /** Additional pubkeys to notify */
  mentions?: string[]
  /** Original PR event ID */
  pullRequestId: string
  /** Original PR author pubkey */
  pullRequestAuthor: string
  /** Updated tip commit ID */
  commit: string
  /** Clone URLs where commit can be downloaded */
  clone: string[]
  /** Most recent common ancestor with target branch */
  mergeBase?: string
}

/**
 * Issue data
 */
export interface Issue {
  /** Issue content (markdown) */
  content: string
  /** Repository address (30617:<pubkey>:<id>) */
  repository?: string
  /** Repository owner pubkey */
  repositoryOwner?: string
  /** Issue subject/title */
  subject?: string
  /** Labels */
  labels?: string[]
}

/**
 * Status types
 */
export type StatusType = "open" | "applied" | "closed" | "draft"

/**
 * Status event data
 */
export interface Status {
  /** Status type */
  type: StatusType
  /** Status message (markdown) */
  content: string
  /** Root event ID (issue, PR, or original root patch) */
  rootEventId: string
  /** Repository owner pubkey */
  repositoryOwner?: string
  /** Root event author pubkey */
  rootEventAuthor?: string
  /** Revision author pubkey (for applied revisions) */
  revisionAuthor?: string
  /** Repository address */
  repository?: string
  /** Earliest unique commit ID */
  earliestUniqueCommit?: string
  /** Applied/merged patch event IDs (for applied status) */
  appliedPatches?: Array<{ id: string; relay?: string; pubkey?: string }>
  /** Merge commit ID (for merged status) */
  mergeCommit?: string
  /** Applied commit IDs (for applied status) */
  appliedAsCommits?: string[]
  /** Accepted revision root ID */
  acceptedRevisionId?: string
}

// =============================================================================
// Repository Functions
// =============================================================================

/**
 * Generate an event template for a repository announcement
 */
export function generateRepositoryEvent(repo: Repository): EventTemplate {
  const tags: string[][] = [["d", repo.id]]

  if (repo.name) tags.push(["name", repo.name])
  if (repo.description) tags.push(["description", repo.description])
  if (repo.web) repo.web.forEach((url) => tags.push(["web", url]))
  if (repo.clone) repo.clone.forEach((url) => tags.push(["clone", url]))
  if (repo.relays) tags.push(["relays", ...repo.relays])
  if (repo.earliestUniqueCommit) tags.push(["r", repo.earliestUniqueCommit, "euc"])
  if (repo.maintainers) tags.push(["maintainers", ...repo.maintainers])
  if (repo.isPersonalFork) tags.push(["t", "personal-fork"])
  if (repo.tags) repo.tags.forEach((t) => tags.push(["t", t]))

  return {
    content: "",
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: REPOSITORY_KIND,
    tags,
  }
}

/**
 * Parse a repository announcement event
 */
export function parseRepositoryEvent(event: NostrEvent): Repository {
  if (event.kind !== REPOSITORY_KIND) {
    throw new Error("Invalid event kind for repository")
  }

  const dTag = event.tags.find(([t]) => t === "d")
  if (!dTag?.[1]) {
    throw new Error("Missing d tag in repository event")
  }

  const repo: Repository = { id: dTag[1] }

  for (const tag of event.tags) {
    const value = tag[1]
    switch (tag[0]) {
      case "name":
        if (value) repo.name = value
        break
      case "description":
        if (value) repo.description = value
        break
      case "web":
        if (value) {
          repo.web ??= []
          repo.web.push(value)
        }
        break
      case "clone":
        if (value) {
          repo.clone ??= []
          repo.clone.push(value)
        }
        break
      case "relays":
        repo.relays = tag.slice(1)
        break
      case "r":
        if (tag[2] === "euc" && value) repo.earliestUniqueCommit = value
        break
      case "maintainers":
        repo.maintainers = tag.slice(1)
        break
      case "t":
        if (value === "personal-fork") {
          repo.isPersonalFork = true
        } else if (value) {
          repo.tags ??= []
          repo.tags.push(value)
        }
        break
    }
  }

  return repo
}

/**
 * Generate an event template for repository state
 */
export function generateRepositoryStateEvent(state: RepositoryState): EventTemplate {
  const tags: string[][] = [["d", state.id]]

  for (const [ref, commits] of state.refs) {
    tags.push([ref, ...commits])
  }

  if (state.head) tags.push(["HEAD", state.head])

  return {
    content: "",
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: REPOSITORY_STATE_KIND,
    tags,
  }
}

/**
 * Parse a repository state event
 */
export function parseRepositoryStateEvent(event: NostrEvent): RepositoryState {
  if (event.kind !== REPOSITORY_STATE_KIND) {
    throw new Error("Invalid event kind for repository state")
  }

  const dTag = event.tags.find(([t]) => t === "d")
  if (!dTag?.[1]) {
    throw new Error("Missing d tag in repository state event")
  }

  const state: RepositoryState = {
    id: dTag[1],
    refs: new Map(),
  }

  for (const tag of event.tags) {
    if (tag[0]?.startsWith("refs/")) {
      state.refs.set(tag[0], tag.slice(1))
    } else if (tag[0] === "HEAD" && tag[1]) {
      state.head = tag[1]
    }
  }

  return state
}

// =============================================================================
// Patch Functions
// =============================================================================

/**
 * Generate an event template for a patch
 */
export function generatePatchEvent(patch: Patch): EventTemplate {
  const tags: string[][] = []

  if (patch.repository) tags.push(["a", patch.repository])
  if (patch.earliestUniqueCommit) tags.push(["r", patch.earliestUniqueCommit])
  if (patch.repositoryOwner) tags.push(["p", patch.repositoryOwner])
  if (patch.mentions) patch.mentions.forEach((p) => tags.push(["p", p]))
  if (patch.isRoot) tags.push(["t", "root"])
  if (patch.isRootRevision) tags.push(["t", "root-revision"])
  if (patch.commit) {
    tags.push(["commit", patch.commit])
    tags.push(["r", patch.commit])
  }
  if (patch.parentCommit) tags.push(["parent-commit", patch.parentCommit])
  if (patch.commitPgpSig !== undefined) tags.push(["commit-pgp-sig", patch.commitPgpSig])
  if (patch.committer) tags.push(["committer", ...patch.committer])

  return {
    content: patch.content,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: PATCH_KIND,
    tags,
  }
}

/**
 * Parse a patch event
 */
export function parsePatchEvent(event: NostrEvent): Patch {
  if (event.kind !== PATCH_KIND) {
    throw new Error("Invalid event kind for patch")
  }

  const patch: Patch = { content: event.content }

  for (const tag of event.tags) {
    const value = tag[1]
    switch (tag[0]) {
      case "a":
        if (value) patch.repository = value
        break
      case "r":
        // Could be earliest unique commit or current commit
        if (!patch.earliestUniqueCommit && value) patch.earliestUniqueCommit = value
        break
      case "p":
        if (value) {
          if (!patch.repositoryOwner) {
            patch.repositoryOwner = value
          } else {
            patch.mentions ??= []
            patch.mentions.push(value)
          }
        }
        break
      case "t":
        if (value === "root") patch.isRoot = true
        if (value === "root-revision") patch.isRootRevision = true
        break
      case "commit":
        if (value) patch.commit = value
        break
      case "parent-commit":
        if (value) patch.parentCommit = value
        break
      case "commit-pgp-sig":
        if (value !== undefined) patch.commitPgpSig = value
        break
      case "committer":
        if (tag[1] && tag[2] && tag[3] && tag[4]) {
          patch.committer = [tag[1], tag[2], tag[3], tag[4]]
        }
        break
    }
  }

  return patch
}

// =============================================================================
// Pull Request Functions
// =============================================================================

/**
 * Generate an event template for a pull request
 */
export function generatePullRequestEvent(pr: PullRequest): EventTemplate {
  const tags: string[][] = []

  if (pr.repository) tags.push(["a", pr.repository])
  if (pr.earliestUniqueCommit) tags.push(["r", pr.earliestUniqueCommit])
  if (pr.repositoryOwner) tags.push(["p", pr.repositoryOwner])
  if (pr.mentions) pr.mentions.forEach((p) => tags.push(["p", p]))
  if (pr.subject) tags.push(["subject", pr.subject])
  if (pr.labels) pr.labels.forEach((l) => tags.push(["t", l]))
  tags.push(["c", pr.commit])
  pr.clone.forEach((url) => tags.push(["clone", url]))
  if (pr.branchName) tags.push(["branch-name", pr.branchName])
  if (pr.rootPatchId) tags.push(["e", pr.rootPatchId])
  if (pr.mergeBase) tags.push(["merge-base", pr.mergeBase])

  return {
    content: pr.content,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: PULL_REQUEST_KIND,
    tags,
  }
}

/**
 * Parse a pull request event
 */
export function parsePullRequestEvent(event: NostrEvent): PullRequest {
  if (event.kind !== PULL_REQUEST_KIND) {
    throw new Error("Invalid event kind for pull request")
  }

  const cTag = event.tags.find(([t]) => t === "c")
  const cloneTags = event.tags.filter(([t]) => t === "clone")

  if (!cTag?.[1]) {
    throw new Error("Missing commit (c) tag in pull request")
  }
  if (cloneTags.length === 0) {
    throw new Error("Missing clone tag in pull request")
  }

  const pr: PullRequest = {
    content: event.content,
    commit: cTag[1],
    clone: cloneTags.map((t) => t[1]!),
  }

  for (const tag of event.tags) {
    const value = tag[1]
    switch (tag[0]) {
      case "a":
        if (value) pr.repository = value
        break
      case "r":
        if (value) pr.earliestUniqueCommit = value
        break
      case "p":
        if (value) {
          if (!pr.repositoryOwner) {
            pr.repositoryOwner = value
          } else {
            pr.mentions ??= []
            pr.mentions.push(value)
          }
        }
        break
      case "subject":
        if (value) pr.subject = value
        break
      case "t":
        if (value) {
          pr.labels ??= []
          pr.labels.push(value)
        }
        break
      case "branch-name":
        if (value) pr.branchName = value
        break
      case "e":
        if (value) pr.rootPatchId = value
        break
      case "merge-base":
        if (value) pr.mergeBase = value
        break
    }
  }

  return pr
}

/**
 * Generate an event template for a pull request update
 */
export function generatePullRequestUpdateEvent(update: PullRequestUpdate): EventTemplate {
  const tags: string[][] = []

  if (update.repository) tags.push(["a", update.repository])
  if (update.earliestUniqueCommit) tags.push(["r", update.earliestUniqueCommit])
  if (update.repositoryOwner) tags.push(["p", update.repositoryOwner])
  if (update.mentions) update.mentions.forEach((p) => tags.push(["p", p]))
  tags.push(["E", update.pullRequestId])
  tags.push(["P", update.pullRequestAuthor])
  tags.push(["c", update.commit])
  update.clone.forEach((url) => tags.push(["clone", url]))
  if (update.mergeBase) tags.push(["merge-base", update.mergeBase])

  return {
    content: "",
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: PULL_REQUEST_UPDATE_KIND,
    tags,
  }
}

/**
 * Parse a pull request update event
 */
export function parsePullRequestUpdateEvent(event: NostrEvent): PullRequestUpdate {
  if (event.kind !== PULL_REQUEST_UPDATE_KIND) {
    throw new Error("Invalid event kind for pull request update")
  }

  const eTag = event.tags.find(([t]) => t === "E")
  const pTag = event.tags.find(([t]) => t === "P")
  const cTag = event.tags.find(([t]) => t === "c")
  const cloneTags = event.tags.filter(([t]) => t === "clone")

  if (!eTag?.[1]) {
    throw new Error("Missing E tag in pull request update")
  }
  if (!pTag?.[1]) {
    throw new Error("Missing P tag in pull request update")
  }
  if (!cTag?.[1]) {
    throw new Error("Missing c tag in pull request update")
  }
  if (cloneTags.length === 0) {
    throw new Error("Missing clone tag in pull request update")
  }

  const update: PullRequestUpdate = {
    pullRequestId: eTag[1],
    pullRequestAuthor: pTag[1],
    commit: cTag[1],
    clone: cloneTags.map((t) => t[1]!),
  }

  for (const tag of event.tags) {
    const value = tag[1]
    switch (tag[0]) {
      case "a":
        if (value) update.repository = value
        break
      case "r":
        if (value) update.earliestUniqueCommit = value
        break
      case "p":
        if (value) {
          if (!update.repositoryOwner) {
            update.repositoryOwner = value
          } else {
            update.mentions ??= []
            update.mentions.push(value)
          }
        }
        break
      case "merge-base":
        if (value) update.mergeBase = value
        break
    }
  }

  return update
}

// =============================================================================
// Issue Functions
// =============================================================================

/**
 * Generate an event template for an issue
 */
export function generateIssueEvent(issue: Issue): EventTemplate {
  const tags: string[][] = []

  if (issue.repository) tags.push(["a", issue.repository])
  if (issue.repositoryOwner) tags.push(["p", issue.repositoryOwner])
  if (issue.subject) tags.push(["subject", issue.subject])
  if (issue.labels) issue.labels.forEach((l) => tags.push(["t", l]))

  return {
    content: issue.content,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: ISSUE_KIND,
    tags,
  }
}

/**
 * Parse an issue event
 */
export function parseIssueEvent(event: NostrEvent): Issue {
  if (event.kind !== ISSUE_KIND) {
    throw new Error("Invalid event kind for issue")
  }

  const issue: Issue = { content: event.content }

  for (const tag of event.tags) {
    const value = tag[1]
    switch (tag[0]) {
      case "a":
        if (value) issue.repository = value
        break
      case "p":
        if (value) issue.repositoryOwner = value
        break
      case "subject":
        if (value) issue.subject = value
        break
      case "t":
        if (value) {
          issue.labels ??= []
          issue.labels.push(value)
        }
        break
    }
  }

  return issue
}

// =============================================================================
// Status Functions
// =============================================================================

/**
 * Get the event kind for a status type
 */
export function getStatusKind(type: StatusType): EventKind {
  switch (type) {
    case "open":
      return STATUS_OPEN_KIND
    case "applied":
      return STATUS_APPLIED_KIND
    case "closed":
      return STATUS_CLOSED_KIND
    case "draft":
      return STATUS_DRAFT_KIND
  }
}

/**
 * Get the status type from an event kind
 */
export function getStatusType(kind: EventKind): StatusType | null {
  switch (kind) {
    case STATUS_OPEN_KIND:
      return "open"
    case STATUS_APPLIED_KIND:
      return "applied"
    case STATUS_CLOSED_KIND:
      return "closed"
    case STATUS_DRAFT_KIND:
      return "draft"
    default:
      return null
  }
}

/**
 * Generate an event template for a status event
 */
export function generateStatusEvent(status: Status): EventTemplate {
  const tags: string[][] = []

  tags.push(["e", status.rootEventId, "", "root"])
  if (status.acceptedRevisionId) {
    tags.push(["e", status.acceptedRevisionId, "", "reply"])
  }
  if (status.repositoryOwner) tags.push(["p", status.repositoryOwner])
  if (status.rootEventAuthor) tags.push(["p", status.rootEventAuthor])
  if (status.revisionAuthor) tags.push(["p", status.revisionAuthor])
  if (status.repository) tags.push(["a", status.repository])
  if (status.earliestUniqueCommit) tags.push(["r", status.earliestUniqueCommit])

  // Applied/merged specific tags
  if (status.appliedPatches) {
    status.appliedPatches.forEach((p) => {
      const qTag = ["q", p.id]
      if (p.relay) qTag.push(p.relay)
      if (p.pubkey) qTag.push(p.pubkey)
      tags.push(qTag)
    })
  }
  if (status.mergeCommit) {
    tags.push(["merge-commit", status.mergeCommit])
    tags.push(["r", status.mergeCommit])
  }
  if (status.appliedAsCommits) {
    tags.push(["applied-as-commits", ...status.appliedAsCommits])
    status.appliedAsCommits.forEach((c) => tags.push(["r", c]))
  }

  return {
    content: status.content,
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: getStatusKind(status.type),
    tags,
  }
}

/**
 * Parse a status event
 */
export function parseStatusEvent(event: NostrEvent): Status {
  const type = getStatusType(event.kind)
  if (!type) {
    throw new Error("Invalid event kind for status")
  }

  const rootTag = event.tags.find(([t, , , marker]) => t === "e" && marker === "root")
  if (!rootTag?.[1]) {
    throw new Error("Missing root e tag in status event")
  }

  const status: Status = {
    type,
    content: event.content,
    rootEventId: rootTag[1],
  }

  const pTags = event.tags.filter(([t]) => t === "p")
  if (pTags[0]?.[1]) status.repositoryOwner = pTags[0][1]
  if (pTags[1]?.[1]) status.rootEventAuthor = pTags[1][1]
  if (pTags[2]?.[1]) status.revisionAuthor = pTags[2][1]

  for (const tag of event.tags) {
    const value = tag[1]
    switch (tag[0]) {
      case "e":
        if (tag[3] === "reply" && value) status.acceptedRevisionId = value
        break
      case "a":
        if (value) status.repository = value
        break
      case "r":
        if (!status.earliestUniqueCommit && value) status.earliestUniqueCommit = value
        break
      case "q":
        if (value) {
          status.appliedPatches ??= []
          status.appliedPatches.push({
            id: value,
            ...(tag[2] ? { relay: tag[2] } : {}),
            ...(tag[3] ? { pubkey: tag[3] } : {}),
          })
        }
        break
      case "merge-commit":
        if (value) status.mergeCommit = value
        break
      case "applied-as-commits":
        status.appliedAsCommits = tag.slice(1)
        break
    }
  }

  return status
}

// =============================================================================
// Grasp List Functions
// =============================================================================

/**
 * Grasp server list for NIP-34 activity
 */
export interface GraspList {
  /** Grasp server WebSocket URLs in order of preference */
  servers: string[]
}

/**
 * Generate an event template for a grasp server list
 */
export function generateGraspListEvent(list: GraspList): EventTemplate {
  const tags = list.servers.map((url) => ["g", url])

  return {
    content: "",
    created_at: Math.floor(Date.now() / 1000) as UnixTimestamp,
    kind: GRASP_LIST_KIND,
    tags,
  }
}

/**
 * Parse a grasp list event
 */
export function parseGraspListEvent(event: NostrEvent): GraspList {
  if (event.kind !== GRASP_LIST_KIND) {
    throw new Error("Invalid event kind for grasp list")
  }

  return {
    servers: event.tags.filter(([t]) => t === "g").map((t) => t[1]!),
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a repository address string
 */
export function createRepositoryAddress(pubkey: string, repoId: string): string {
  return `${REPOSITORY_KIND}:${pubkey}:${repoId}`
}

/**
 * Parse a repository address string
 */
export function parseRepositoryAddress(address: string): { pubkey: string; repoId: string } | null {
  const parts = address.split(":")
  if (parts.length !== 3 || parts[0] !== String(REPOSITORY_KIND)) {
    return null
  }
  return { pubkey: parts[1]!, repoId: parts[2]! }
}

/**
 * Check if an event is a git-related event
 */
export function isGitEvent(event: NostrEvent): boolean {
  return (
    event.kind === REPOSITORY_KIND ||
    event.kind === REPOSITORY_STATE_KIND ||
    event.kind === PATCH_KIND ||
    event.kind === PULL_REQUEST_KIND ||
    event.kind === PULL_REQUEST_UPDATE_KIND ||
    event.kind === ISSUE_KIND ||
    event.kind === STATUS_OPEN_KIND ||
    event.kind === STATUS_APPLIED_KIND ||
    event.kind === STATUS_CLOSED_KIND ||
    event.kind === STATUS_DRAFT_KIND ||
    event.kind === GRASP_LIST_KIND
  )
}
