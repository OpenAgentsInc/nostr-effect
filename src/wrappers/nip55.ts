/**
 * NIP-55: Android Signer Application
 *
 * Build intent URIs for Android signing applications.
 *
 * @example
 * ```typescript
 * import { getPublicKeyUri, signEventUri, encryptNip44Uri } from 'nostr-effect/nip55'
 *
 * // Get public key URI
 * const uri = getPublicKeyUri({ callbackUrl: 'myapp://callback' })
 *
 * // Sign event URI
 * const signUri = signEventUri({
 *   eventJson: { kind: 1, content: 'Hello' },
 *   callbackUrl: 'myapp://callback'
 * })
 * ```
 */

/** Base parameters for all URI types */
interface BaseParams {
  callbackUrl?: string
  returnType?: "signature" | "event"
  compressionType?: "none" | "gzip"
}

/** Parameters for permission requests */
interface PermissionsParams extends BaseParams {
  permissions?: { type: string; kind?: number }[]
}

/** Parameters for event signing */
interface EventUriParams extends BaseParams {
  eventJson: Record<string, unknown>
  id?: string
  currentUser?: string
}

/** Parameters for encryption/decryption */
interface EncryptDecryptParams extends BaseParams {
  pubKey: string
  content: string
  id?: string
  currentUser?: string
}

/** Internal URI parameters */
interface UriParams extends BaseParams {
  base: string
  type: string
  id?: string
  currentUser?: string
  permissions?: { type: string; kind?: number }[]
  pubKey?: string
  plainText?: string
  encryptedText?: string
  appName?: string
}

function encodeParams(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function filterUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as T
}

function buildUri({
  base,
  type,
  callbackUrl,
  returnType = "signature",
  compressionType = "none",
  ...params
}: UriParams): string {
  const baseParams: Record<string, string | undefined> = {
    type,
    compressionType,
    returnType,
    callbackUrl,
    id: params.id,
    current_user: params.currentUser,
    permissions:
      params.permissions && params.permissions.length > 0
        ? encodeURIComponent(JSON.stringify(params.permissions))
        : undefined,
    pubKey: params.pubKey,
    plainText: params.plainText,
    encryptedText: params.encryptedText,
    appName: params.appName,
  }

  const filteredParams = filterUndefined(baseParams)
  return `${base}?${encodeParams(filteredParams as Record<string, string>)}`
}

function buildDefaultUri(type: string, params: Partial<UriParams>): string {
  return buildUri({
    base: "nostrsigner:",
    type,
    ...params,
  })
}

/**
 * Build URI to get public key from Android signer
 */
export function getPublicKeyUri({ permissions = [], ...params }: PermissionsParams): string {
  return buildDefaultUri("get_public_key", { permissions, ...params })
}

/**
 * Build URI to sign event with Android signer
 */
export function signEventUri({ eventJson, ...params }: EventUriParams): string {
  return buildUri({
    base: `nostrsigner:${encodeURIComponent(JSON.stringify(eventJson))}`,
    type: "sign_event",
    ...params,
  })
}

/**
 * Build URI to encrypt with NIP-04 using Android signer
 */
export function encryptNip04Uri(params: EncryptDecryptParams): string {
  return buildDefaultUri("nip04_encrypt", { ...params, plainText: params.content })
}

/**
 * Build URI to decrypt with NIP-04 using Android signer
 */
export function decryptNip04Uri(params: EncryptDecryptParams): string {
  return buildDefaultUri("nip04_decrypt", { ...params, encryptedText: params.content })
}

/**
 * Build URI to encrypt with NIP-44 using Android signer
 */
export function encryptNip44Uri(params: EncryptDecryptParams): string {
  return buildDefaultUri("nip44_encrypt", { ...params, plainText: params.content })
}

/**
 * Build URI to decrypt with NIP-44 using Android signer
 */
export function decryptNip44Uri(params: EncryptDecryptParams): string {
  return buildDefaultUri("nip44_decrypt", { ...params, encryptedText: params.content })
}

/**
 * Build URI to decrypt zap event using Android signer
 */
export function decryptZapEventUri({ eventJson, ...params }: EventUriParams): string {
  return buildUri({
    base: `nostrsigner:${encodeURIComponent(JSON.stringify(eventJson))}`,
    type: "decrypt_zap_event",
    ...params,
  })
}
