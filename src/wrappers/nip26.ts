/**
 * NIP-26: Delegated Event Signing
 *
 * Helpers to create and verify delegation tokens and to sign delegated events.
 *
 * Spec: ~/code/nips/26.md
 */
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import type { Event, EventTemplate } from "./pure.js"
import { finalizeEvent, getPublicKey, verifyEvent } from "./pure.js"

/**
 * A delegation tag as used in NIP-26
 * ["delegation", delegatorPubkey, conditions, signature]
 */
export type DelegationTag = ["delegation", string, string, string]

/**
 * Build the NIP-26 signing payload for a given delegate and conditions.
 *
 * message = `nostr:delegation:${delegatePubkey}:${conditions}`
 */
export function buildDelegationMessage(delegatePubkey: string, conditions: string): Uint8Array {
  const msg = `nostr:delegation:${delegatePubkey}:${conditions}`
  return new TextEncoder().encode(msg)
}

/**
 * Create a delegation tag signed by the delegator.
 *
 * @param delegatorSecretKey - delegator secret key (Uint8Array)
 * @param delegatePubkey - hex public key of the delegate
 * @param conditions - authorization string (e.g., "kind=1&created_at<1700000000")
 */
export function createDelegationTag(
  delegatorSecretKey: Uint8Array,
  delegatePubkey: string,
  conditions: string
): DelegationTag {
  const delegatorPubkey = getPublicKey(delegatorSecretKey)
  const msg = buildDelegationMessage(delegatePubkey, conditions)
  const digest = sha256(msg)
  const sig = schnorr.sign(bytesToHex(digest), delegatorSecretKey)
  return ["delegation", delegatorPubkey, conditions, bytesToHex(sig)]
}

/**
 * Verify the delegation tag against the given delegate public key.
 *
 * @param tag - delegation tag
 * @param delegatePubkey - expected delegate pubkey (hex)
 * @returns true if signature is valid for message and delegator pubkey
 */
export function verifyDelegationTag(tag: DelegationTag, delegatePubkey: string): boolean {
  const [_t, delegatorPubkey, conditions, sig] = tag
  // Build message hash
  const msg = buildDelegationMessage(delegatePubkey, conditions)
  const digest = sha256(msg)
  try {
    return schnorr.verify(sig, bytesToHex(digest), delegatorPubkey)
  } catch {
    return false
  }
}

/**
 * Attach a delegation tag to an event template's tags array.
 */
export function withDelegationTag<T extends EventTemplate>(tmpl: T, tag: DelegationTag): T {
  const tags = Array.isArray(tmpl.tags) ? tmpl.tags.slice() : []
  tags.push(tag)
  return { ...tmpl, tags } as T
}

/**
 * Sign a delegated event: attaches the provided delegation tag and signs the event with the delegate secret key.
 *
 * Note: This function does not validate the tag; callers can use `verifyDelegationTag` prior to publishing.
 */
export function finalizeDelegatedEvent(
  template: EventTemplate,
  delegateSecretKey: Uint8Array,
  delegationTag: DelegationTag
): Event {
  const withTag = withDelegationTag(template, delegationTag)
  return finalizeEvent(withTag, delegateSecretKey)
}

/**
 * Verify a delegated event:
 * - verifies the event signature (delegate-signed)
 * - verifies the delegation tag signature against the event.pubkey
 */
export function verifyDelegatedEvent(event: Event): boolean {
  if (!verifyEvent(event)) return false
  const tag = event.tags.find((t) => t[0] === "delegation") as DelegationTag | undefined
  if (!tag) return false
  // tag format: ["delegation", delegatorPubkey, conditions, signature]
  return verifyDelegationTag(tag, event.pubkey)
}
