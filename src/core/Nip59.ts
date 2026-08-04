/**
 * NIP-59: Gift Wrap
 * https://github.com/nostr-protocol/nips/blob/master/59.md
 */
import { randomBytes } from "@noble/hashes/utils";
import { decrypt, encrypt, getConversationKey } from "../wrappers/nip44.js";
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  validateEvent,
  verifyEvent,
  type Event,
} from "../wrappers/pure.js";
import type { EventId, EventKind, PublicKey, Signature, UnixTimestamp } from "./Schema.js";

export const SEAL_KIND = 13 as EventKind;
export const GIFT_WRAP_KIND = 1059 as EventKind;

const TWO_DAYS = 2 * 24 * 60 * 60;
const HEX_64 = /^[a-f0-9]{64}$/;

export interface UnsignedEvent {
  readonly kind: EventKind;
  readonly content: string;
  readonly tags: readonly (readonly string[])[];
  readonly created_at?: UnixTimestamp;
  readonly pubkey?: PublicKey;
}

export interface Rumor extends UnsignedEvent {
  readonly id: EventId;
  readonly pubkey: PublicKey;
  readonly created_at: UnixTimestamp;
}

export interface SealedEvent {
  readonly id: EventId;
  readonly pubkey: PublicKey;
  readonly created_at: UnixTimestamp;
  readonly kind: typeof SEAL_KIND;
  readonly tags: readonly [];
  readonly content: string;
  readonly sig: Signature;
}

export interface GiftWrappedEvent {
  readonly id: EventId;
  readonly pubkey: PublicKey;
  readonly created_at: UnixTimestamp;
  readonly kind: typeof GIFT_WRAP_KIND;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  readonly sig: Signature;
}

export interface UnwrappedEventDetails {
  readonly rumor: Rumor;
  readonly seal: SealedEvent;
  readonly wrapId: EventId;
  readonly sealId: EventId;
  readonly rumorId: EventId;
}

/** Optional inputs for deterministic conformance fixtures. */
export interface WrapMaterial {
  readonly sealCreatedAt?: number;
  readonly wrapCreatedAt?: number;
  readonly sealNonce?: Uint8Array;
  readonly wrapNonce?: Uint8Array;
  readonly wrapPrivateKey?: Uint8Array;
  readonly sealAuxiliaryRandomData?: Uint8Array;
  readonly wrapAuxiliaryRandomData?: Uint8Array;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function randomizedTimestamp(): number {
  const random = randomBytes(4);
  const offset =
    new DataView(random.buffer, random.byteOffset, random.byteLength).getUint32(0) % TWO_DAYS;
  return now() - offset;
}

function requirePublicKey(publicKey: string, label: string): void {
  if (!HEX_64.test(publicKey))
    throw new Error(`${label} must be 64 lowercase hexadecimal characters`);
}

function mutableTags(tags: readonly (readonly string[])[]): string[][] {
  return tags.map((tag) => [...tag]);
}

function eventForVerification(event: SealedEvent | GiftWrappedEvent): Event {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: mutableTags(event.tags),
    content: event.content,
    sig: event.sig,
  };
}

function requireValidSignedEvent(event: SealedEvent | GiftWrappedEvent, label: string): void {
  const candidate = eventForVerification(event);
  if (!validateEvent(candidate) || !verifyEvent(candidate))
    throw new Error(`${label} signature or ID is invalid`);
}

function requireRecipient(
  tags: readonly (readonly string[])[],
  recipient: string,
  label: string,
): void {
  if (
    tags.length !== 1 ||
    tags[0]?.length !== 2 ||
    tags[0]?.[0] !== "p" ||
    tags[0]?.[1] !== recipient
  ) {
    throw new Error(`${label} must contain exactly one recipient tag`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function isTags(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === "string"))
  );
}

function parseJsonObject(json: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function parseSeal(json: string): SealedEvent {
  const value = parseJsonObject(json, "gift wrap seal");
  requireExactKeys(
    value,
    ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"],
    "gift wrap seal",
  );
  if (
    typeof value.id !== "string" ||
    typeof value.pubkey !== "string" ||
    !Number.isSafeInteger(value.created_at) ||
    value.kind !== SEAL_KIND ||
    !isTags(value.tags) ||
    value.tags.length !== 0 ||
    typeof value.content !== "string" ||
    typeof value.sig !== "string"
  ) {
    throw new Error("gift wrap seal has an invalid structure");
  }
  return value as unknown as SealedEvent;
}

function parseRumor(json: string): Rumor {
  const value = parseJsonObject(json, "gift wrap rumor");
  requireExactKeys(
    value,
    ["id", "pubkey", "created_at", "kind", "tags", "content"],
    "gift wrap rumor",
  );
  if (
    typeof value.id !== "string" ||
    typeof value.pubkey !== "string" ||
    !Number.isSafeInteger(value.created_at) ||
    !Number.isSafeInteger(value.kind) ||
    (value.kind as number) < 0 ||
    (value.kind as number) > 65535 ||
    !isTags(value.tags) ||
    typeof value.content !== "string"
  ) {
    throw new Error("gift wrap rumor has an invalid structure");
  }
  requirePublicKey(value.pubkey, "gift wrap rumor public key");
  if (!HEX_64.test(value.id)) throw new Error("gift wrap rumor ID is invalid");
  return value as unknown as Rumor;
}

function rumorHash(rumor: Rumor): string {
  return getEventHash({
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    kind: rumor.kind,
    tags: mutableTags(rumor.tags),
    content: rumor.content,
  });
}

export function createRumor(event: Partial<UnsignedEvent>, privateKey: Uint8Array): Rumor {
  const pubkey = getPublicKey(privateKey) as PublicKey;
  const created_at = (event.created_at ?? now()) as UnixTimestamp;
  const rumor = {
    kind: event.kind ?? (1 as EventKind),
    content: event.content ?? "",
    tags: event.tags ?? [],
    pubkey,
    created_at,
  };
  const id = getEventHash({ ...rumor, tags: mutableTags(rumor.tags) }) as EventId;
  return { ...rumor, id };
}

export function createSeal(
  rumor: Rumor,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string,
  material: Pick<WrapMaterial, "sealCreatedAt" | "sealNonce" | "sealAuxiliaryRandomData"> = {},
): SealedEvent {
  requirePublicKey(recipientPublicKey, "recipient public key");
  const senderPublicKey = getPublicKey(senderPrivateKey);
  if (rumor.pubkey !== senderPublicKey || rumor.id !== rumorHash(rumor)) {
    throw new Error("rumor author or ID does not match the sender");
  }
  const conversationKey = getConversationKey(senderPrivateKey, recipientPublicKey);
  const encryptedContent = encrypt(JSON.stringify(rumor), conversationKey, material.sealNonce);
  return finalizeEvent(
    {
      kind: SEAL_KIND,
      created_at: material.sealCreatedAt ?? randomizedTimestamp(),
      tags: [],
      content: encryptedContent,
    },
    senderPrivateKey,
    material.sealAuxiliaryRandomData,
  ) as unknown as SealedEvent;
}

export function createWrap(
  seal: SealedEvent,
  recipientPublicKey: string,
  material: Pick<
    WrapMaterial,
    "wrapCreatedAt" | "wrapNonce" | "wrapPrivateKey" | "wrapAuxiliaryRandomData"
  > = {},
): GiftWrappedEvent {
  requirePublicKey(recipientPublicKey, "recipient public key");
  requireValidSignedEvent(seal, "gift wrap seal");
  if (seal.kind !== SEAL_KIND || seal.tags.length !== 0)
    throw new Error("gift wrap seal must be kind 13 with no tags");
  const wrapPrivateKey = material.wrapPrivateKey ?? generateSecretKey();
  if (getPublicKey(wrapPrivateKey) === seal.pubkey)
    throw new Error("gift wrap key must differ from the seal key");
  const conversationKey = getConversationKey(wrapPrivateKey, recipientPublicKey);
  const encryptedContent = encrypt(JSON.stringify(seal), conversationKey, material.wrapNonce);
  return finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      created_at: material.wrapCreatedAt ?? randomizedTimestamp(),
      tags: [["p", recipientPublicKey]],
      content: encryptedContent,
    },
    wrapPrivateKey,
    material.wrapAuxiliaryRandomData,
  ) as unknown as GiftWrappedEvent;
}

export function wrapEvent(
  event: Partial<UnsignedEvent>,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string,
  material: WrapMaterial = {},
): GiftWrappedEvent {
  const rumor = createRumor(event, senderPrivateKey);
  const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey, material);
  return createWrap(seal, recipientPublicKey, material);
}

export function wrapManyEvents(
  event: Partial<UnsignedEvent>,
  senderPrivateKey: Uint8Array,
  recipientsPublicKeys: readonly string[],
): readonly GiftWrappedEvent[] {
  if (recipientsPublicKeys.length === 0) throw new Error("At least one recipient is required.");
  const senderPublicKey = getPublicKey(senderPrivateKey);
  return [senderPublicKey, ...recipientsPublicKeys].map((recipientPublicKey) =>
    wrapEvent(event, senderPrivateKey, recipientPublicKey),
  );
}

export function unwrapEventWithDetails(
  wrap: GiftWrappedEvent,
  recipientPrivateKey: Uint8Array,
): UnwrappedEventDetails {
  const recipientPublicKey = getPublicKey(recipientPrivateKey);
  if (wrap.kind !== GIFT_WRAP_KIND) throw new Error("gift wrap must use kind 1059");
  requireRecipient(wrap.tags, recipientPublicKey, "gift wrap");
  requireValidSignedEvent(wrap, "gift wrap");

  const wrapConversationKey = getConversationKey(recipientPrivateKey, wrap.pubkey);
  const seal = parseSeal(decrypt(wrap.content, wrapConversationKey));
  requireValidSignedEvent(seal, "gift wrap seal");
  if (wrap.pubkey === seal.pubkey) throw new Error("gift wrap key must differ from the seal key");

  const sealConversationKey = getConversationKey(recipientPrivateKey, seal.pubkey);
  const rumor = parseRumor(decrypt(seal.content, sealConversationKey));
  if (rumor.id !== rumorHash(rumor)) throw new Error("gift wrap rumor ID is invalid");
  if (rumor.pubkey !== seal.pubkey)
    throw new Error("gift wrap rumor author does not match the seal signer");
  return {
    rumor,
    seal,
    wrapId: wrap.id,
    sealId: seal.id,
    rumorId: rumor.id,
  };
}

export function unwrapEvent(wrap: GiftWrappedEvent, recipientPrivateKey: Uint8Array): Rumor {
  return unwrapEventWithDetails(wrap, recipientPrivateKey).rumor;
}

export function unwrapManyEvents(
  wrappedEvents: readonly GiftWrappedEvent[],
  recipientPrivateKey: Uint8Array,
): readonly Rumor[] {
  return wrappedEvents
    .map((wrap) => unwrapEvent(wrap, recipientPrivateKey))
    .sort((left, right) => left.created_at - right.created_at);
}
