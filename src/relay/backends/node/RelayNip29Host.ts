/**
 * Durable NIP-29 relay identity and seed-group host.
 *
 * This module keeps deployment values outside the relay library. An operator
 * supplies one relay signing key and one or more standard NIP-29 seed groups.
 * The relay publishes `self` through NIP-11 and stores relay-signed group
 * projections before it starts to accept traffic.
 */
import { Effect } from "effect";
import { hexToBytes } from "@noble/hashes/utils";
import type { NostrEvent } from "../../../core/Schema.js";
import { StorageError } from "../../../core/Errors.js";
import {
  finalizeEvent,
  getPublicKey,
  verifyEvent,
  type Event as PureEvent,
} from "../../../wrappers/pure.js";
import type { EventStore } from "../../storage/EventStore.js";
import type { NipModule, PreStoreHook } from "../../core/nip/NipModule.js";
import {
  createNip29GroupPolicyModule,
  type Nip29GroupPolicyController,
} from "../../core/nip/modules/Nip29Module.js";
import { DefaultModules } from "../../core/nip/modules/index.js";
import {
  GROUP_ADMINS_KIND,
  GROUP_CREATE_GROUP_KIND,
  GROUP_EDIT_METADATA_KIND,
  GROUP_JOIN_REQUEST_KIND,
  GROUP_LEAVE_REQUEST_KIND,
  GROUP_METADATA_KIND,
  GROUP_PINNED_EVENTS_KIND,
  GROUP_PUT_USER_KIND,
  GROUP_REMOVE_USER_KIND,
  GROUP_ROLES_KIND,
  GROUP_UPDATE_PIN_LIST_KIND,
  getHTag,
  type EventTemplate,
  type RoomClass,
} from "../../../core/Nip29GroupPolicy.js";

const HEX_PRIVATE_KEY = /^[a-f0-9]{64}$/;
const HEX_EVENT_PREFIX = /^[a-f0-9]{8}$/;
const PROJECTION_KINDS = [
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND,
  GROUP_ROLES_KIND,
  GROUP_PINNED_EVENTS_KIND,
] as const;
const REPLAY_KINDS = [
  GROUP_PUT_USER_KIND,
  GROUP_REMOVE_USER_KIND,
  GROUP_EDIT_METADATA_KIND,
  GROUP_CREATE_GROUP_KIND,
  GROUP_UPDATE_PIN_LIST_KIND,
  GROUP_JOIN_REQUEST_KIND,
  GROUP_LEAVE_REQUEST_KIND,
] as const;
const REGENERATE_KINDS = new Set<number>(REPLAY_KINDS);

export interface RelayNip29SeedGroup {
  readonly id: string;
  readonly creatorPubkey?: string;
  readonly roomClass?: RoomClass;
  readonly name?: string;
  readonly about?: string;
  readonly picture?: string;
  readonly banner?: string;
  readonly isPrivate?: boolean;
  readonly isClosed?: boolean;
  readonly isRestricted?: boolean;
  readonly isHidden?: boolean;
  readonly creatorRoles?: readonly string[];
  readonly supportedKinds?: readonly number[];
  readonly pinnedReferences?: readonly (readonly ["e" | "a", string])[];
}

export interface RelayNip29HostConfig {
  /** Lowercase 32-byte hex secret supplied by the deployment secret store. */
  readonly relayPrivateKey: string;
  /** Groups that must exist before the relay starts to accept traffic. */
  readonly seedGroups: readonly RelayNip29SeedGroup[];
  /**
   * Enforce standard NIP-29 `previous` references when clients provide them.
   * The NIP allows zero references, so this does not require a tag.
   */
  readonly validatePreviousReferences?: boolean;
}

export interface RelayNip29Host {
  readonly relayPubkey: string;
  readonly modules: readonly NipModule[];
  readonly controller: Nip29GroupPolicyController;
  readonly seedGroupIds: readonly string[];
  /** Zero the retained signing-key bytes after the relay stops. */
  readonly dispose: () => void;
}

const asNostrEvent = (event: ReturnType<typeof finalizeEvent>): NostrEvent =>
  event as unknown as NostrEvent;

const normalizeKinds = (kinds: readonly number[] | undefined): readonly number[] | undefined => {
  if (kinds === undefined) return undefined;
  const unique = [...new Set(kinds)];
  if (unique.some((kind) => !Number.isSafeInteger(kind) || kind < 0 || kind > 65_535)) {
    throw new Error("relay: NIP-29 supportedKinds must contain event kinds");
  }
  return unique;
};

const validateSeedGroup = (group: RelayNip29SeedGroup): void => {
  if (!/^[a-zA-Z0-9._~:-]{1,128}$/.test(group.id)) {
    throw new Error(`relay: NIP-29 seed group id is invalid: ${JSON.stringify(group.id)}`);
  }
  normalizeKinds(group.supportedKinds);
  for (const [type, value] of group.pinnedReferences ?? []) {
    const valid = type === "e" ? /^[a-f0-9]{64}$/.test(value) : /^\d+:[a-f0-9]{64}:.+$/.test(value);
    if (!valid) {
      throw new Error(`relay: invalid NIP-29 pinned ${type} reference`);
    }
  }
};

const sameProjection = (
  event: NostrEvent | undefined,
  template: EventTemplate,
  relayPubkey: string,
): boolean =>
  event !== undefined &&
  event.pubkey === relayPubkey &&
  event.kind === template.kind &&
  event.content === template.content &&
  JSON.stringify(event.tags) === JSON.stringify(template.tags) &&
  verifyEvent(event as unknown as PureEvent);

const templateForKind = (
  projections: {
    readonly metadata: EventTemplate;
    readonly admins: EventTemplate;
    readonly members: EventTemplate;
    readonly roles: EventTemplate;
    readonly pinned: EventTemplate;
  },
  kind: (typeof PROJECTION_KINDS)[number],
): EventTemplate => {
  switch (kind) {
    case GROUP_METADATA_KIND:
      return projections.metadata;
    case GROUP_ADMINS_KIND:
      return projections.admins;
    case GROUP_ROLES_KIND:
      return projections.roles;
    case GROUP_PINNED_EVENTS_KIND:
      return projections.pinned;
  }
};

const groupFilter = (groupId: string, kinds: readonly number[], limit?: number) =>
  ({
    kinds,
    "#h": [groupId],
    ...(limit !== undefined ? { limit } : {}),
  }) as never;

const projectionFilter = (relayPubkey: string, groupId: string) =>
  ({
    authors: [relayPubkey],
    kinds: [...PROJECTION_KINDS],
    "#d": [groupId],
  }) as never;

/**
 * Create a durable NIP-29 host and write its seed projections.
 *
 * The returned module must replace the default advertisement-only NIP-29
 * module. Startup fails if the key, configuration, replay, or durable write
 * fails. This prevents a relay from reporting ready with missing state.
 */
export const createRelayNip29Host = async (
  config: RelayNip29HostConfig,
  eventStore: EventStore,
): Promise<RelayNip29Host> => {
  if (!HEX_PRIVATE_KEY.test(config.relayPrivateKey)) {
    throw new Error("relay: relayPrivateKey must be 64 lowercase hexadecimal characters");
  }
  if (config.seedGroups.length === 0) {
    throw new Error("relay: at least one NIP-29 seed group is required");
  }
  for (const group of config.seedGroups) validateSeedGroup(group);

  const validatePreviousReferences =
    config.validatePreviousReferences !== false;
  const secretKey = hexToBytes(config.relayPrivateKey);
  const relayPubkey = getPublicKey(secretKey);
  const seedGroups = config.seedGroups.map((group) => {
    const { supportedKinds, ...groupWithoutSupportedKinds } = group;
    return {
      ...groupWithoutSupportedKinds,
      creatorPubkey: group.creatorPubkey ?? relayPubkey,
      ...(supportedKinds !== undefined ? { supportedKinds: normalizeKinds(supportedKinds)! } : {}),
    };
  });
  const bundle = createNip29GroupPolicyModule({
    relayPubkey,
    seedGroups,
    defaultClosed: false,
    defaultRestricted: false,
  });

  const persistGroupProjections = async (groupId: string): Promise<void> => {
    const existing = await Effect.runPromise(
      eventStore.queryEvents([projectionFilter(relayPubkey, groupId)]),
    );
    const existingByKind = new Map<number, NostrEvent>(
      existing.map((event) => [event.kind, event]),
    );
    const newestCreatedAt = existing.reduce(
      (latest, event) => Math.max(latest, event.created_at),
      0,
    );
    const createdAt = Math.max(Math.floor(Date.now() / 1000), newestCreatedAt + 1);
    const projections = bundle.controller.buildRelaySignedProjections(groupId, createdAt);
    if (!projections.ok) {
      throw new Error(
        `relay: cannot build NIP-29 projections for ${groupId}: ${projections.reason}`,
      );
    }

    for (const kind of PROJECTION_KINDS) {
      const template = templateForKind(projections, kind);
      if (sameProjection(existingByKind.get(kind), template, relayPubkey)) {
        continue;
      }
      const event = asNostrEvent(
        finalizeEvent(
          {
            ...template,
            tags: template.tags.map((tag) => [...tag]),
          },
          secretKey,
        ),
      );
      const result = await Effect.runPromise(
        eventStore.storeParameterizedReplaceableEvent(event, groupId),
      );
      if (!result.stored && result.reason !== "duplicate") {
        throw new Error(
          `relay: could not store NIP-29 projection ${kind}:${groupId} (${result.reason ?? "unknown"})`,
        );
      }
    }
  };

  // Reconstruct mutations that were durably accepted before this process.
  // Seed configuration remains the base state; canonical moderation history is
  // replayed in timestamp and event-id order.
  for (const group of seedGroups) {
    const history = await Effect.runPromise(
      eventStore.queryEvents([groupFilter(group.id, REPLAY_KINDS)]),
    );
    const ordered = [...history].sort(
      (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
    );
    for (const event of ordered) {
      if (event.kind === GROUP_CREATE_GROUP_KIND) continue;
      const decision = bundle.engine.admitEvent(event);
      if (!decision.admit) {
        throw new Error(
          `relay: stored NIP-29 event ${event.id} cannot be replayed: ${decision.reason}`,
        );
      }
      const applied = bundle.engine.applyEvent(event);
      if (!applied.applied) {
        throw new Error(
          `relay: stored NIP-29 event ${event.id} cannot be applied: ${applied.reason ?? "unknown"}`,
        );
      }
    }
  }

  for (const group of seedGroups) {
    await persistGroupProjections(group.id);
  }

  const durablePreStoreHook: PreStoreHook = (event) =>
    Effect.gen(function* () {
      const groupId = getHTag(event);
      const previous = event.tags
        .filter((tag) => tag[0] === "previous")
        .flatMap((tag) => tag.slice(1));

      if (
        validatePreviousReferences &&
        groupId !== undefined &&
        previous.length > 0
      ) {
        if (previous.some((prefix) => !HEX_EVENT_PREFIX.test(prefix))) {
          return {
            action: "reject" as const,
            reason: "invalid: previous references must be 8 lowercase hexadecimal characters",
          };
        }
        const recent = yield* eventStore.queryEvents([groupFilter(groupId, [], 50)]);
        const validPrefixes = new Set(
          recent
            .filter((prior) => prior.pubkey !== event.pubkey)
            .map((prior) => prior.id.slice(0, 8)),
        );
        if (previous.some((prefix) => !validPrefixes.has(prefix))) {
          return {
            action: "reject" as const,
            reason: "invalid: previous reference is not in this relay group timeline",
          };
        }
      }

      // The durable host applies moderation only after the original event is
      // stored. This prevents a duplicate or failed write from changing the
      // in-memory engine without a matching durable event.
      const decision = bundle.engine.admitEvent(event);
      if (!decision.admit) {
        return {
          action: "reject" as const,
          reason: decision.reason,
        };
      }
      return { action: "store" as const, event };
    });

  const durableModule: NipModule = {
    ...bundle.module,
    preStoreHook: durablePreStoreHook,
    postStoreHook: (event) => {
      const groupId = getHTag(event);
      if (groupId === undefined || !REGENERATE_KINDS.has(event.kind)) {
        return Effect.void;
      }
      const applied = bundle.engine.applyEvent(event);
      if (!applied.applied) {
        return Effect.fail(
          new StorageError({
            operation: "upsert",
            message: `Failed to apply stored NIP-29 event ${event.id}: ${applied.reason ?? "unknown"}`,
          }),
        );
      }
      return Effect.tryPromise({
        try: () => persistGroupProjections(groupId),
        catch: (error) =>
          new StorageError({
            operation: "upsert",
            message: `Failed to regenerate NIP-29 projections: ${error instanceof Error ? error.message : String(error)}`,
          }),
      });
    },
  };

  return {
    relayPubkey,
    modules: [...DefaultModules.filter((module) => module.id !== "nip-29"), durableModule],
    controller: bundle.controller,
    seedGroupIds: seedGroups.map((group) => group.id),
    dispose: () => secretKey.fill(0),
  };
};
