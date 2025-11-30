/**
 * NIP-SB: Remote Sandbox Protocol
 *
 * Type-safe Nostr event types for remote sandbox operations.
 * Enables agents to run code in isolated sandboxes using the NIP-90 DVM pattern.
 *
 * @see https://github.com/OpenAgentsInc/openagents.com/blob/main/docs/mechacoder/NIP-SB.md
 */
import { Schema } from "@effect/schema"
import { EventKind } from "./Schema.js"

// =============================================================================
// Kind Constants
// =============================================================================

/** Request Kinds (57XX) */
export const SANDBOX_CREATE_KIND = 5700 as EventKind
export const SANDBOX_EXECUTE_KIND = 5701 as EventKind
export const SANDBOX_UPLOAD_KIND = 5702 as EventKind
export const SANDBOX_DOWNLOAD_KIND = 5703 as EventKind
export const SANDBOX_CONTROL_KIND = 5704 as EventKind
export const SANDBOX_STATUS_KIND = 5705 as EventKind
export const SANDBOX_GIT_CLONE_KIND = 5706 as EventKind
export const SANDBOX_PORT_FORWARD_KIND = 5707 as EventKind

/** Result Kinds (67XX) */
export const SANDBOX_CREATE_RESULT_KIND = 6700 as EventKind
export const SANDBOX_EXECUTE_RESULT_KIND = 6701 as EventKind
export const SANDBOX_UPLOAD_RESULT_KIND = 6702 as EventKind
export const SANDBOX_DOWNLOAD_RESULT_KIND = 6703 as EventKind
export const SANDBOX_CONTROL_RESULT_KIND = 6704 as EventKind
export const SANDBOX_STATUS_RESULT_KIND = 6705 as EventKind
export const SANDBOX_GIT_CLONE_RESULT_KIND = 6706 as EventKind
export const SANDBOX_PORT_FORWARD_RESULT_KIND = 6707 as EventKind

/** Special Kinds */
export const SANDBOX_STATE_KIND = 31750 as EventKind // Replaceable
export const SANDBOX_HEARTBEAT_KIND = 27570 as EventKind // Ephemeral
export const SANDBOX_FEEDBACK_KIND = 7000 as EventKind // Standard NIP-90 feedback

// =============================================================================
// Sandbox ID
// =============================================================================

/** Sandbox identifier (e.g., "sb_abc123") */
export const SandboxId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(64),
  Schema.brand("SandboxId")
)
export type SandboxId = typeof SandboxId.Type

// =============================================================================
// Common Types
// =============================================================================

/** Sandbox status values */
export const SandboxStatus = Schema.Union(
  Schema.Literal("pending"),
  Schema.Literal("creating"),
  Schema.Literal("running"),
  Schema.Literal("stopped"),
  Schema.Literal("error"),
  Schema.Literal("deleted")
)
export type SandboxStatus = typeof SandboxStatus.Type

/** Control actions */
export const SandboxControlAction = Schema.Union(
  Schema.Literal("start"),
  Schema.Literal("stop"),
  Schema.Literal("restart"),
  Schema.Literal("delete"),
  Schema.Literal("snapshot")
)
export type SandboxControlAction = typeof SandboxControlAction.Type

/** Supported languages */
export const SandboxLanguage = Schema.Union(
  Schema.Literal("typescript"),
  Schema.Literal("javascript"),
  Schema.Literal("python"),
  Schema.Literal("rust"),
  Schema.Literal("go"),
  Schema.Literal("java")
)
export type SandboxLanguage = typeof SandboxLanguage.Type

// =============================================================================
// Request Payloads
// =============================================================================

/** Configuration for creating a sandbox (kind 5700) */
export const SandboxCreateConfig = Schema.Struct({
  /** Base image (optional) */
  image: Schema.optional(Schema.String),
  /** CPU cores (default: 1) */
  cpu: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  /** Memory in MB (default: 1024) */
  memory: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  /** Disk in MB (default: 10240) */
  disk: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  /** Primary language */
  language: Schema.optional(SandboxLanguage),
  /** Max lifetime in seconds */
  timeout: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  /** Environment variables */
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})
export type SandboxCreateConfig = typeof SandboxCreateConfig.Type

/** Options for executing a command (kind 5701) */
export const SandboxExecuteOptions = Schema.Struct({
  /** Working directory */
  cwd: Schema.optional(Schema.String),
  /** Command timeout in seconds */
  timeout: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  /** Stream output via feedback events */
  stream: Schema.optional(Schema.Boolean),
  /** Shell to use (bash, sh, zsh) */
  shell: Schema.optional(Schema.String),
})
export type SandboxExecuteOptions = typeof SandboxExecuteOptions.Type

/** Options for git clone (kind 5706) */
export const SandboxGitCloneOptions = Schema.Struct({
  /** Branch to clone (default: default branch) */
  branch: Schema.optional(Schema.String),
  /** Clone destination (default: /workspace) */
  path: Schema.optional(Schema.String),
  /** Shallow clone depth */
  depth: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
})
export type SandboxGitCloneOptions = typeof SandboxGitCloneOptions.Type

/** Options for uploading a file (kind 5702) */
export const SandboxUploadOptions = Schema.Struct({
  /** Content encoding (base64, utf8) */
  encoding: Schema.optional(Schema.Union(Schema.Literal("base64"), Schema.Literal("utf8"))),
  /** Unix permissions (default: 644) */
  permissions: Schema.optional(Schema.String),
})
export type SandboxUploadOptions = typeof SandboxUploadOptions.Type

/** Options for downloading a file (kind 5703) */
export const SandboxDownloadOptions = Schema.Struct({
  /** Response format (base64, blossom) */
  format: Schema.optional(Schema.Union(Schema.Literal("base64"), Schema.Literal("blossom"))),
})
export type SandboxDownloadOptions = typeof SandboxDownloadOptions.Type

/** Options for port forwarding (kind 5707) */
export const SandboxPortForwardOptions = Schema.Struct({
  /** Protocol (http, tcp) */
  protocol: Schema.optional(Schema.Union(Schema.Literal("http"), Schema.Literal("tcp"))),
  /** Public access (default: false) */
  public: Schema.optional(Schema.Boolean),
})
export type SandboxPortForwardOptions = typeof SandboxPortForwardOptions.Type

// =============================================================================
// Result Payloads
// =============================================================================

/** Result from sandbox creation (kind 6700) */
export const SandboxCreateResult = Schema.Struct({
  id: SandboxId,
  status: SandboxStatus,
  urls: Schema.optional(
    Schema.Struct({
      ssh: Schema.optional(Schema.String),
      http: Schema.optional(Schema.String),
    })
  ),
  expiresAt: Schema.optional(Schema.Number),
})
export type SandboxCreateResult = typeof SandboxCreateResult.Type

/** Result from command execution (kind 6701) */
export const SandboxExecuteResult = Schema.Struct({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number.pipe(Schema.int()),
  duration: Schema.optional(Schema.Number), // milliseconds
})
export type SandboxExecuteResult = typeof SandboxExecuteResult.Type

/** Result from file upload (kind 6702) */
export const SandboxUploadResult = Schema.Struct({
  path: Schema.String,
  size: Schema.Number.pipe(Schema.int()),
  sha256: Schema.optional(Schema.String),
})
export type SandboxUploadResult = typeof SandboxUploadResult.Type

/** Result from file download (kind 6703) */
export const SandboxDownloadResult = Schema.Struct({
  content: Schema.optional(Schema.String), // base64 for small files
  blossom: Schema.optional(Schema.String), // blossom hash for large files
  size: Schema.Number.pipe(Schema.int()),
  sha256: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String), // download URL for large files
})
export type SandboxDownloadResult = typeof SandboxDownloadResult.Type

/** Result from control action (kind 6704) */
export const SandboxControlResult = Schema.Struct({
  action: SandboxControlAction,
  previousStatus: SandboxStatus,
  newStatus: SandboxStatus,
})
export type SandboxControlResult = typeof SandboxControlResult.Type

/** Result from status request (kind 6705) */
export const SandboxStatusResult = Schema.Struct({
  status: SandboxStatus,
  uptime: Schema.optional(Schema.Number), // seconds
  metrics: Schema.optional(
    Schema.Struct({
      cpu: Schema.optional(Schema.Number), // percentage
      memory: Schema.optional(Schema.Number), // MB
      disk: Schema.optional(Schema.Number), // MB
    })
  ),
})
export type SandboxStatusResult = typeof SandboxStatusResult.Type

/** Result from git clone (kind 6706) */
export const SandboxGitCloneResult = Schema.Struct({
  commit: Schema.String,
  branch: Schema.String,
  files: Schema.Number.pipe(Schema.int()),
})
export type SandboxGitCloneResult = typeof SandboxGitCloneResult.Type

/** Result from port forward (kind 6707) */
export const SandboxPortForwardResult = Schema.Struct({
  internal: Schema.Number.pipe(Schema.int()),
  external: Schema.optional(Schema.Number.pipe(Schema.int())),
  url: Schema.String,
})
export type SandboxPortForwardResult = typeof SandboxPortForwardResult.Type

// =============================================================================
// State Event (kind 31750)
// =============================================================================

/** Sandbox state for replaceable event */
export const SandboxState = Schema.Struct({
  status: SandboxStatus,
  ports: Schema.optional(
    Schema.Array(
      Schema.Struct({
        internal: Schema.Number.pipe(Schema.int()),
        url: Schema.String,
      })
    )
  ),
  metrics: Schema.optional(
    Schema.Struct({
      cpu: Schema.optional(Schema.Number),
      memory: Schema.optional(Schema.Number),
      disk: Schema.optional(Schema.Number),
    })
  ),
})
export type SandboxState = typeof SandboxState.Type

// =============================================================================
// Feedback Statuses (kind 7000)
// =============================================================================

/** Sandbox-specific feedback statuses */
export const SandboxFeedbackStatus = Schema.Union(
  Schema.Literal("payment-required"),
  Schema.Literal("creating"),
  Schema.Literal("ready"),
  Schema.Literal("processing"),
  Schema.Literal("streaming"),
  Schema.Literal("error"),
  Schema.Literal("success")
)
export type SandboxFeedbackStatus = typeof SandboxFeedbackStatus.Type

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a kind is a NIP-SB request kind (5700-5707)
 */
export const isSandboxRequestKind = (kind: EventKind | number): boolean => {
  const k = kind as number
  return k >= 5700 && k <= 5707
}

/**
 * Check if a kind is a NIP-SB result kind (6700-6707)
 */
export const isSandboxResultKind = (kind: EventKind | number): boolean => {
  const k = kind as number
  return k >= 6700 && k <= 6707
}

/**
 * Get the result kind for a request kind
 */
export const getResultKind = (requestKind: EventKind | number): EventKind => {
  return ((requestKind as number) + 1000) as EventKind
}

/**
 * Build sandbox tag for events
 */
export const buildSandboxTag = (sandboxId: SandboxId): readonly [string, string] => {
  return ["sandbox", sandboxId] as const
}

/**
 * Build param tag for events
 */
export const buildParamTag = (
  key: string,
  value: string
): readonly [string, string, string] => {
  return ["param", key, value] as const
}

/**
 * Build env tag for events
 */
export const buildEnvTag = (
  key: string,
  value: string
): readonly [string, string, string] => {
  return ["env", key, value] as const
}
