/**
 * NIP-34: Git Collaboration Tests
 */
import { describe, test, expect } from "bun:test"
import {
  // Event Kinds
  REPOSITORY_KIND,
  REPOSITORY_STATE_KIND,
  PATCH_KIND,
  PULL_REQUEST_KIND,
  PULL_REQUEST_UPDATE_KIND,
  ISSUE_KIND,
  STATUS_OPEN_KIND,
  STATUS_APPLIED_KIND,
  STATUS_CLOSED_KIND,
  STATUS_DRAFT_KIND,
  GRASP_LIST_KIND,
  // Repository functions
  generateRepositoryEvent,
  parseRepositoryEvent,
  generateRepositoryStateEvent,
  parseRepositoryStateEvent,
  // Patch functions
  generatePatchEvent,
  parsePatchEvent,
  // PR functions
  generatePullRequestEvent,
  parsePullRequestEvent,
  generatePullRequestUpdateEvent,
  parsePullRequestUpdateEvent,
  // Issue functions
  generateIssueEvent,
  parseIssueEvent,
  // Status functions
  generateStatusEvent,
  parseStatusEvent,
  getStatusKind,
  getStatusType,
  // Grasp list functions
  generateGraspListEvent,
  parseGraspListEvent,
  // Utility functions
  createRepositoryAddress,
  parseRepositoryAddress,
  isGitEvent,
  // Types
  type Repository,
  type RepositoryState,
  type Patch,
  type PullRequest,
  type PullRequestUpdate,
  type Issue,
  type Status,
  type GraspList,
} from "./Nip34.js"
import { NostrEvent as NostrEventSchema } from "./Schema.js"
import type { NostrEvent, EventKind } from "./Schema.js"
import { Schema } from "@effect/schema"

// Helper to create a properly typed mock event using Schema decode
function createMockEvent(
  kind: EventKind,
  content: string,
  tags: string[][]
): NostrEvent {
  return Schema.decodeUnknownSync(NostrEventSchema)({
    id: "0".repeat(64),
    pubkey: "1".repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind,
    tags,
    content,
    sig: "2".repeat(128),
  })
}

describe("NIP-34: Git Collaboration", () => {
  describe("Event Kinds", () => {
    test("should have correct event kind values", () => {
      expect(REPOSITORY_KIND as number).toBe(30617)
      expect(REPOSITORY_STATE_KIND as number).toBe(30618)
      expect(PATCH_KIND as number).toBe(1617)
      expect(PULL_REQUEST_KIND as number).toBe(1618)
      expect(PULL_REQUEST_UPDATE_KIND as number).toBe(1619)
      expect(ISSUE_KIND as number).toBe(1621)
      expect(STATUS_OPEN_KIND as number).toBe(1630)
      expect(STATUS_APPLIED_KIND as number).toBe(1631)
      expect(STATUS_CLOSED_KIND as number).toBe(1632)
      expect(STATUS_DRAFT_KIND as number).toBe(1633)
      expect(GRASP_LIST_KIND as number).toBe(10317)
    })
  })

  describe("Repository", () => {
    test("should generate repository event with minimal data", () => {
      const repo: Repository = { id: "my-project" }
      const event = generateRepositoryEvent(repo)

      expect(event.kind).toBe(REPOSITORY_KIND)
      expect(event.content).toBe("")
      expect(event.tags).toContainEqual(["d", "my-project"])
    })

    test("should generate repository event with full data", () => {
      const repo: Repository = {
        id: "nostr-effect",
        name: "Nostr Effect",
        description: "Type-safe Nostr library",
        web: ["https://github.com/example/nostr-effect"],
        clone: ["https://github.com/example/nostr-effect.git"],
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
        earliestUniqueCommit: "abc123",
        maintainers: ["pubkey1", "pubkey2"],
        tags: ["nostr", "typescript"],
        isPersonalFork: false,
      }
      const event = generateRepositoryEvent(repo)

      expect(event.tags).toContainEqual(["d", "nostr-effect"])
      expect(event.tags).toContainEqual(["name", "Nostr Effect"])
      expect(event.tags).toContainEqual(["description", "Type-safe Nostr library"])
      expect(event.tags).toContainEqual(["web", "https://github.com/example/nostr-effect"])
      expect(event.tags).toContainEqual(["clone", "https://github.com/example/nostr-effect.git"])
      expect(event.tags).toContainEqual(["relays", "wss://relay1.example.com", "wss://relay2.example.com"])
      expect(event.tags).toContainEqual(["r", "abc123", "euc"])
      expect(event.tags).toContainEqual(["maintainers", "pubkey1", "pubkey2"])
      expect(event.tags).toContainEqual(["t", "nostr"])
      expect(event.tags).toContainEqual(["t", "typescript"])
    })

    test("should generate repository event with personal-fork tag", () => {
      const repo: Repository = { id: "my-fork", isPersonalFork: true }
      const event = generateRepositoryEvent(repo)

      expect(event.tags).toContainEqual(["t", "personal-fork"])
    })

    test("should parse repository event", () => {
      const event = createMockEvent(REPOSITORY_KIND, "", [
        ["d", "nostr-effect"],
        ["name", "Nostr Effect"],
        ["description", "Type-safe Nostr library"],
        ["web", "https://github.com/example/nostr-effect"],
        ["clone", "https://github.com/example/nostr-effect.git"],
        ["relays", "wss://relay1.example.com", "wss://relay2.example.com"],
        ["r", "abc123", "euc"],
        ["maintainers", "pubkey1", "pubkey2"],
        ["t", "nostr"],
        ["t", "typescript"],
      ])

      const repo = parseRepositoryEvent(event)

      expect(repo.id).toBe("nostr-effect")
      expect(repo.name).toBe("Nostr Effect")
      expect(repo.description).toBe("Type-safe Nostr library")
      expect(repo.web).toEqual(["https://github.com/example/nostr-effect"])
      expect(repo.clone).toEqual(["https://github.com/example/nostr-effect.git"])
      expect(repo.relays).toEqual(["wss://relay1.example.com", "wss://relay2.example.com"])
      expect(repo.earliestUniqueCommit).toBe("abc123")
      expect(repo.maintainers).toEqual(["pubkey1", "pubkey2"])
      expect(repo.tags).toEqual(["nostr", "typescript"])
    })

    test("should throw on invalid repository event", () => {
      const event = createMockEvent(PATCH_KIND, "", [])
      expect(() => parseRepositoryEvent(event)).toThrow("Invalid event kind")
    })

    test("should throw on missing d tag", () => {
      const event = createMockEvent(REPOSITORY_KIND, "", [])
      expect(() => parseRepositoryEvent(event)).toThrow("Missing d tag")
    })
  })

  describe("Repository State", () => {
    test("should generate repository state event", () => {
      const state: RepositoryState = {
        id: "nostr-effect",
        refs: new Map([
          ["refs/heads/main", ["abc123"]],
          ["refs/heads/develop", ["def456", "abc123"]],
          ["refs/tags/v1.0.0", ["789xyz"]],
        ]),
        head: "ref: refs/heads/main",
      }
      const event = generateRepositoryStateEvent(state)

      expect(event.kind).toBe(REPOSITORY_STATE_KIND)
      expect(event.tags).toContainEqual(["d", "nostr-effect"])
      expect(event.tags).toContainEqual(["refs/heads/main", "abc123"])
      expect(event.tags).toContainEqual(["refs/heads/develop", "def456", "abc123"])
      expect(event.tags).toContainEqual(["refs/tags/v1.0.0", "789xyz"])
      expect(event.tags).toContainEqual(["HEAD", "ref: refs/heads/main"])
    })

    test("should parse repository state event", () => {
      const event = createMockEvent(REPOSITORY_STATE_KIND, "", [
        ["d", "nostr-effect"],
        ["refs/heads/main", "abc123"],
        ["refs/heads/develop", "def456", "abc123"],
        ["HEAD", "ref: refs/heads/main"],
      ])

      const state = parseRepositoryStateEvent(event)

      expect(state.id).toBe("nostr-effect")
      expect(state.refs.get("refs/heads/main")).toEqual(["abc123"])
      expect(state.refs.get("refs/heads/develop")).toEqual(["def456", "abc123"])
      expect(state.head).toBe("ref: refs/heads/main")
    })
  })

  describe("Patch", () => {
    test("should generate patch event", () => {
      const patch: Patch = {
        content: "From abc123...\n---\ndiff --git a/file.ts b/file.ts",
        repository: "30617:pubkey:nostr-effect",
        earliestUniqueCommit: "abc123",
        repositoryOwner: "owner-pubkey",
        isRoot: true,
        commit: "def456",
        parentCommit: "abc123",
      }
      const event = generatePatchEvent(patch)

      expect(event.kind).toBe(PATCH_KIND)
      expect(event.content).toContain("diff --git")
      expect(event.tags).toContainEqual(["a", "30617:pubkey:nostr-effect"])
      expect(event.tags).toContainEqual(["r", "abc123"])
      expect(event.tags).toContainEqual(["p", "owner-pubkey"])
      expect(event.tags).toContainEqual(["t", "root"])
      expect(event.tags).toContainEqual(["commit", "def456"])
      expect(event.tags).toContainEqual(["parent-commit", "abc123"])
    })

    test("should parse patch event", () => {
      const event = createMockEvent(PATCH_KIND, "patch content", [
        ["a", "30617:pubkey:nostr-effect"],
        ["r", "abc123"],
        ["p", "owner-pubkey"],
        ["t", "root"],
        ["commit", "def456"],
        ["parent-commit", "abc123"],
      ])

      const patch = parsePatchEvent(event)

      expect(patch.content).toBe("patch content")
      expect(patch.repository).toBe("30617:pubkey:nostr-effect")
      expect(patch.earliestUniqueCommit).toBe("abc123")
      expect(patch.repositoryOwner).toBe("owner-pubkey")
      expect(patch.isRoot).toBe(true)
      expect(patch.commit).toBe("def456")
      expect(patch.parentCommit).toBe("abc123")
    })
  })

  describe("Pull Request", () => {
    test("should generate pull request event", () => {
      const pr: PullRequest = {
        content: "## Description\nThis PR adds a new feature",
        repository: "30617:pubkey:nostr-effect",
        repositoryOwner: "owner-pubkey",
        subject: "Add new feature",
        labels: ["enhancement", "breaking-change"],
        commit: "abc123",
        clone: ["https://github.com/user/nostr-effect.git"],
        branchName: "feature/new-thing",
        mergeBase: "def456",
      }
      const event = generatePullRequestEvent(pr)

      expect(event.kind).toBe(PULL_REQUEST_KIND)
      expect(event.content).toContain("Description")
      expect(event.tags).toContainEqual(["a", "30617:pubkey:nostr-effect"])
      expect(event.tags).toContainEqual(["p", "owner-pubkey"])
      expect(event.tags).toContainEqual(["subject", "Add new feature"])
      expect(event.tags).toContainEqual(["t", "enhancement"])
      expect(event.tags).toContainEqual(["t", "breaking-change"])
      expect(event.tags).toContainEqual(["c", "abc123"])
      expect(event.tags).toContainEqual(["clone", "https://github.com/user/nostr-effect.git"])
      expect(event.tags).toContainEqual(["branch-name", "feature/new-thing"])
      expect(event.tags).toContainEqual(["merge-base", "def456"])
    })

    test("should parse pull request event", () => {
      const event = createMockEvent(PULL_REQUEST_KIND, "PR description", [
        ["a", "30617:pubkey:nostr-effect"],
        ["p", "owner-pubkey"],
        ["subject", "Add new feature"],
        ["t", "enhancement"],
        ["c", "abc123"],
        ["clone", "https://github.com/user/nostr-effect.git"],
        ["branch-name", "feature/new-thing"],
      ])

      const pr = parsePullRequestEvent(event)

      expect(pr.content).toBe("PR description")
      expect(pr.repository).toBe("30617:pubkey:nostr-effect")
      expect(pr.repositoryOwner).toBe("owner-pubkey")
      expect(pr.subject).toBe("Add new feature")
      expect(pr.labels).toEqual(["enhancement"])
      expect(pr.commit).toBe("abc123")
      expect(pr.clone).toEqual(["https://github.com/user/nostr-effect.git"])
      expect(pr.branchName).toBe("feature/new-thing")
    })

    test("should throw on missing commit tag", () => {
      const event = createMockEvent(PULL_REQUEST_KIND, "", [
        ["clone", "https://github.com/user/repo.git"],
      ])
      expect(() => parsePullRequestEvent(event)).toThrow("Missing commit")
    })

    test("should throw on missing clone tag", () => {
      const event = createMockEvent(PULL_REQUEST_KIND, "", [["c", "abc123"]])
      expect(() => parsePullRequestEvent(event)).toThrow("Missing clone")
    })
  })

  describe("Pull Request Update", () => {
    test("should generate PR update event", () => {
      const update: PullRequestUpdate = {
        repository: "30617:pubkey:nostr-effect",
        repositoryOwner: "owner-pubkey",
        pullRequestId: "pr-event-id",
        pullRequestAuthor: "pr-author-pubkey",
        commit: "new-commit",
        clone: ["https://github.com/user/repo.git"],
      }
      const event = generatePullRequestUpdateEvent(update)

      expect(event.kind).toBe(PULL_REQUEST_UPDATE_KIND)
      expect(event.tags).toContainEqual(["E", "pr-event-id"])
      expect(event.tags).toContainEqual(["P", "pr-author-pubkey"])
      expect(event.tags).toContainEqual(["c", "new-commit"])
      expect(event.tags).toContainEqual(["clone", "https://github.com/user/repo.git"])
    })

    test("should parse PR update event", () => {
      const event = createMockEvent(PULL_REQUEST_UPDATE_KIND, "", [
        ["E", "pr-event-id"],
        ["P", "pr-author-pubkey"],
        ["c", "new-commit"],
        ["clone", "https://github.com/user/repo.git"],
      ])

      const update = parsePullRequestUpdateEvent(event)

      expect(update.pullRequestId).toBe("pr-event-id")
      expect(update.pullRequestAuthor).toBe("pr-author-pubkey")
      expect(update.commit).toBe("new-commit")
      expect(update.clone).toEqual(["https://github.com/user/repo.git"])
    })
  })

  describe("Issue", () => {
    test("should generate issue event", () => {
      const issue: Issue = {
        content: "## Bug Report\nSomething is broken",
        repository: "30617:pubkey:nostr-effect",
        repositoryOwner: "owner-pubkey",
        subject: "Bug: Something is broken",
        labels: ["bug", "high-priority"],
      }
      const event = generateIssueEvent(issue)

      expect(event.kind).toBe(ISSUE_KIND)
      expect(event.content).toContain("Bug Report")
      expect(event.tags).toContainEqual(["a", "30617:pubkey:nostr-effect"])
      expect(event.tags).toContainEqual(["p", "owner-pubkey"])
      expect(event.tags).toContainEqual(["subject", "Bug: Something is broken"])
      expect(event.tags).toContainEqual(["t", "bug"])
      expect(event.tags).toContainEqual(["t", "high-priority"])
    })

    test("should parse issue event", () => {
      const event = createMockEvent(ISSUE_KIND, "Issue content", [
        ["a", "30617:pubkey:nostr-effect"],
        ["p", "owner-pubkey"],
        ["subject", "Bug report"],
        ["t", "bug"],
      ])

      const issue = parseIssueEvent(event)

      expect(issue.content).toBe("Issue content")
      expect(issue.repository).toBe("30617:pubkey:nostr-effect")
      expect(issue.repositoryOwner).toBe("owner-pubkey")
      expect(issue.subject).toBe("Bug report")
      expect(issue.labels).toEqual(["bug"])
    })
  })

  describe("Status", () => {
    test("should get correct status kind", () => {
      expect(getStatusKind("open")).toBe(STATUS_OPEN_KIND)
      expect(getStatusKind("applied")).toBe(STATUS_APPLIED_KIND)
      expect(getStatusKind("closed")).toBe(STATUS_CLOSED_KIND)
      expect(getStatusKind("draft")).toBe(STATUS_DRAFT_KIND)
    })

    test("should get correct status type from kind", () => {
      expect(getStatusType(STATUS_OPEN_KIND)).toBe("open")
      expect(getStatusType(STATUS_APPLIED_KIND)).toBe("applied")
      expect(getStatusType(STATUS_CLOSED_KIND)).toBe("closed")
      expect(getStatusType(STATUS_DRAFT_KIND)).toBe("draft")
      expect(getStatusType(1 as EventKind)).toBe(null)
    })

    test("should generate status event", () => {
      const status: Status = {
        type: "applied",
        content: "Merged!",
        rootEventId: "root-event-id",
        repositoryOwner: "owner-pubkey",
        rootEventAuthor: "author-pubkey",
        repository: "30617:pubkey:nostr-effect",
        mergeCommit: "merge-abc123",
        appliedPatches: [{ id: "patch1", relay: "wss://relay.example.com" }],
      }
      const event = generateStatusEvent(status)

      expect(event.kind).toBe(STATUS_APPLIED_KIND)
      expect(event.content).toBe("Merged!")
      expect(event.tags).toContainEqual(["e", "root-event-id", "", "root"])
      expect(event.tags).toContainEqual(["p", "owner-pubkey"])
      expect(event.tags).toContainEqual(["p", "author-pubkey"])
      expect(event.tags).toContainEqual(["a", "30617:pubkey:nostr-effect"])
      expect(event.tags).toContainEqual(["merge-commit", "merge-abc123"])
      expect(event.tags).toContainEqual(["r", "merge-abc123"])
      expect(event.tags).toContainEqual(["q", "patch1", "wss://relay.example.com"])
    })

    test("should parse status event", () => {
      const event = createMockEvent(STATUS_APPLIED_KIND, "Merged!", [
        ["e", "root-event-id", "", "root"],
        ["p", "owner-pubkey"],
        ["p", "author-pubkey"],
        ["a", "30617:pubkey:nostr-effect"],
        ["merge-commit", "merge-abc123"],
        ["q", "patch1", "wss://relay.example.com", "patch-author"],
      ])

      const status = parseStatusEvent(event)

      expect(status.type).toBe("applied")
      expect(status.content).toBe("Merged!")
      expect(status.rootEventId).toBe("root-event-id")
      expect(status.repositoryOwner).toBe("owner-pubkey")
      expect(status.rootEventAuthor).toBe("author-pubkey")
      expect(status.repository).toBe("30617:pubkey:nostr-effect")
      expect(status.mergeCommit).toBe("merge-abc123")
      expect(status.appliedPatches).toEqual([
        { id: "patch1", relay: "wss://relay.example.com", pubkey: "patch-author" },
      ])
    })
  })

  describe("Grasp List", () => {
    test("should generate grasp list event", () => {
      const list: GraspList = {
        servers: ["wss://grasp1.example.com", "wss://grasp2.example.com"],
      }
      const event = generateGraspListEvent(list)

      expect(event.kind).toBe(GRASP_LIST_KIND)
      expect(event.content).toBe("")
      expect(event.tags).toContainEqual(["g", "wss://grasp1.example.com"])
      expect(event.tags).toContainEqual(["g", "wss://grasp2.example.com"])
    })

    test("should parse grasp list event", () => {
      const event = createMockEvent(GRASP_LIST_KIND, "", [
        ["g", "wss://grasp1.example.com"],
        ["g", "wss://grasp2.example.com"],
      ])

      const list = parseGraspListEvent(event)

      expect(list.servers).toEqual([
        "wss://grasp1.example.com",
        "wss://grasp2.example.com",
      ])
    })
  })

  describe("Utility Functions", () => {
    test("should create repository address", () => {
      const address = createRepositoryAddress("pubkey123", "nostr-effect")
      expect(address).toBe("30617:pubkey123:nostr-effect")
    })

    test("should parse repository address", () => {
      const result = parseRepositoryAddress("30617:pubkey123:nostr-effect")
      expect(result).toEqual({ pubkey: "pubkey123", repoId: "nostr-effect" })
    })

    test("should return null for invalid repository address", () => {
      expect(parseRepositoryAddress("invalid")).toBe(null)
      expect(parseRepositoryAddress("1234:pubkey:repo")).toBe(null)
      expect(parseRepositoryAddress("30617:pubkey")).toBe(null)
    })

    test("should identify git events", () => {
      expect(isGitEvent(createMockEvent(REPOSITORY_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(REPOSITORY_STATE_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(PATCH_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(PULL_REQUEST_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(PULL_REQUEST_UPDATE_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(ISSUE_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(STATUS_OPEN_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(STATUS_APPLIED_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(STATUS_CLOSED_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(STATUS_DRAFT_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(GRASP_LIST_KIND, "", []))).toBe(true)
      expect(isGitEvent(createMockEvent(1 as EventKind, "", []))).toBe(false)
    })
  })
})
