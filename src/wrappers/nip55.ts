/**
 * NIP-55: Android Signer Application helpers
 *
 * Build nostrsigner: intent URIs and extras payloads that Android apps can use
 * to communicate with an external signer. This wrapper is platform-agnostic and
 * focuses on producing the strings and JSON structures defined by the spec.
 *
 * Spec: ~/code/nips/55.md
 */

// =============================================================================
// Types
// =============================================================================

export type SignerMethod =
  | "get_public_key"
  | "sign_event"
  | "nip04_encrypt"
  | "nip04_decrypt"
  | "nip44_encrypt"
  | "nip44_decrypt"

export interface Permission {
  readonly type: Exclude<SignerMethod, "get_public_key" | "sign_event"> | "sign_event"
  readonly kind?: number
}

export interface GetPublicKeyRequest {
  readonly permissions?: readonly Permission[]
}

export interface BaseRequestWithUser {
  readonly current_user: string
  readonly id?: string
  /** Android package name of signer (optional on first call, required after get_public_key) */
  readonly package?: string
}

export interface SignEventRequest extends BaseRequestWithUser {
  /** Raw event JSON string to sign */
  readonly eventJson: string
}

export interface Nip04EncryptRequest extends BaseRequestWithUser {
  readonly plaintext: string
  readonly pubkey: string
}

export interface Nip04DecryptRequest extends BaseRequestWithUser {
  readonly encryptedText: string
  readonly pubkey: string
}

export interface Nip44EncryptRequest extends BaseRequestWithUser {
  readonly plaintext: string
  readonly pubkey: string
}

export interface Nip44DecryptRequest extends BaseRequestWithUser {
  readonly encryptedText: string
  readonly pubkey: string
}

export interface IntentBuildResult {
  /** The nostrsigner URI to feed into Intent.ACTION_VIEW */
  readonly uri: string
  /** Key-value map for Intent extras (type, id, current_user, pubkey, permissions, etc.) */
  readonly extras: Readonly<Record<string, string>>
}

// =============================================================================
// Builders
// =============================================================================

/** Build a nostrsigner: URI without payload. */
export const buildBaseUri = (): string => "nostrsigner:"

/** Build a nostrsigner: URI carrying arbitrary payload (e.g., event JSON or plaintext). */
export const buildPayloadUri = (payload: string): string => `nostrsigner:${payload}`

export function buildGetPublicKeyIntent(req: GetPublicKeyRequest = {}): IntentBuildResult {
  const uri = buildBaseUri()
  const extras: Record<string, string> = { type: "get_public_key" }
  if (req.permissions && req.permissions.length > 0) {
    extras.permissions = JSON.stringify(req.permissions)
  }
  return { uri, extras }
}

export function buildSignEventIntent(req: SignEventRequest): IntentBuildResult {
  const uri = buildPayloadUri(req.eventJson)
  const extras: Record<string, string> = { type: "sign_event", current_user: req.current_user }
  if (req.id) extras.id = req.id
  if (req.package) extras.package = req.package
  return { uri, extras }
}

export function buildNip04EncryptIntent(req: Nip04EncryptRequest): IntentBuildResult {
  const uri = buildPayloadUri(req.plaintext)
  const extras: Record<string, string> = {
    type: "nip04_encrypt",
    current_user: req.current_user,
    pubkey: req.pubkey,
  }
  if (req.id) extras.id = req.id
  if (req.package) extras.package = req.package
  return { uri, extras }
}

export function buildNip04DecryptIntent(req: Nip04DecryptRequest): IntentBuildResult {
  const uri = buildPayloadUri(req.encryptedText)
  const extras: Record<string, string> = {
    type: "nip04_decrypt",
    current_user: req.current_user,
    pubkey: req.pubkey,
  }
  if (req.id) extras.id = req.id
  if (req.package) extras.package = req.package
  return { uri, extras }
}

export function buildNip44EncryptIntent(req: Nip44EncryptRequest): IntentBuildResult {
  const uri = buildPayloadUri(req.plaintext)
  const extras: Record<string, string> = {
    type: "nip44_encrypt",
    current_user: req.current_user,
    pubkey: req.pubkey,
  }
  if (req.id) extras.id = req.id
  if (req.package) extras.package = req.package
  return { uri, extras }
}

export function buildNip44DecryptIntent(req: Nip44DecryptRequest): IntentBuildResult {
  const uri = buildPayloadUri(req.encryptedText)
  const extras: Record<string, string> = {
    type: "nip44_decrypt",
    current_user: req.current_user,
    pubkey: req.pubkey,
  }
  if (req.id) extras.id = req.id
  if (req.package) extras.package = req.package
  return { uri, extras }
}

// =============================================================================
// Result parsing
// =============================================================================

export interface SignerResultItem {
  readonly package?: string
  readonly result?: string
  readonly id?: string
  readonly event?: string
}

/** Parse batch results JSON produced by signer (for multiple permissions). */
export function parseSignerResults(json: string): readonly SignerResultItem[] {
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr.map((x) => ({
      package: typeof x.package === "string" ? x.package : undefined,
      result: typeof x.result === "string" ? x.result : undefined,
      id: typeof x.id === "string" ? x.id : undefined,
      event: typeof x.event === "string" ? x.event : undefined,
    }))
  } catch {
    return []
  }
}

