# NIP-29 group policy and durable Node host

This document describes how the owned OpenAgents relay admits a closed NIP-29
group, enforces membership on write, and publishes relay-signed membership
state that a client can verify.

The Node host is generic. An operator can also configure a public group. The
host does not depend on an application account or session. NIP-42 authenticates
the Nostr key on the relay connection.

## Durable production configuration

The standalone Node entry requires these values in addition to `DATABASE_URL`
and `RELAY_PUBLIC_URL`:

```sh
RELAY_PRIVATE_KEY="<64 lowercase hex characters>"
RELAY_NIP29_SEED_GROUPS='[
  {
    "id": "public-chat",
    "name": "Public Chat",
    "about": "A public NIP-29 chat group.",
    "isClosed": false,
    "isRestricted": false,
    "isPrivate": false,
    "isHidden": false,
    "supportedKinds": [5, 7, 9, 1337, 1984]
  }
]'
```

Load `RELAY_PRIVATE_KEY` from the deployment secret store. Do not put it in
source control, an event, a log, or the group JSON. The relay derives the
lowercase public key and publishes it as NIP-11 `self`.

Before the listener starts, the host validates the inputs, replays stored
moderation history, and stores signed kinds `39000`, `39001`, `39003`, and
`39005`. Startup stops when a required read, signature, or write fails. An
unchanged restart keeps the same event IDs.

Accepted metadata and pin moderation events regenerate the affected
relay-signed state. Use one relay process for moderation writes. Restart replay
preserves state, but this release does not coordinate the in-memory policy
engine across concurrent relay processes.

When a group event contains `previous` references, each reference must be the
first eight lowercase hexadecimal characters of an event in the last 50 events
from that relay group. The referenced event must have a different author. The
tag remains optional, as NIP-29 specifies.

## Why

The community workroom is semi-public: read access is broad inside the
membership, write access is closed, and membership is explicit. Upstream marks
NIP-28 public chat and NIP-72 moderated communities as unrecommended and points
to NIP-29 instead.

| Room property | Carrier |
| --- | --- |
| Group identity and metadata | NIP-29 addressable group state (`kind:39000`) |
| Membership and roles | NIP-29 admin/member events, **relay-signed** (`39001`/`39002`) |
| Messages and threads | Any kind with the required `h` group tag |
| Moderation and tombstones | NIP-29 moderation events (`9000`–`9010`) |

## Rules this module enforces

1. **Closed write.** Restricted groups accept writes only from current members.
2. **Explicit membership.** Members are added by `put-user` (or a honored join
   with invite on a closed group), not by open publish.
3. **Immediate revocation.** `remove-user` (and leave) ends membership and
   every bound capability grant in the same action.
4. **Relay-signed state.** Kinds `39000`–`39005` are accepted only from the
   configured relay `self` pubkey. Clients verify those signatures.
5. **Scoped discovery.** There is no global group directory. Callers pass
   explicit group ids (invitation / `naddr`). Hidden groups stay hidden from
   non-members.
6. **Two-room separation.** Community and owner-private Sarah rooms are
   distinct group ids with independent membership. Use
   `assertRoomIsolation` to prove no shared membership.

## Install on a Node relay

```ts
import {
  DefaultModules,
  createNip29GroupPolicyModule,
  startRelay,
} from "nostr-effect/relay/node"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-effect/pure"

const relaySecret = generateSecretKey() // load from Secret Manager in prod
const relayPubkey = getPublicKey(relaySecret)
const ownerPubkey = "/* owner hex pubkey */"

const { module, controller } = createNip29GroupPolicyModule({
  relayPubkey,
  // Owned closed workroom defaults: closed + restricted.
  defaultClosed: true,
  defaultRestricted: true,
  seedGroups: [
    {
      id: "openagents-community",
      creatorPubkey: ownerPubkey,
      roomClass: "community",
      name: "OpenAgents Community",
      isClosed: true,
      isRestricted: true,
    },
    {
      id: "sarah-owner-private",
      creatorPubkey: ownerPubkey,
      roomClass: "owner-private",
      name: "Sarah",
      isPrivate: true,
      isClosed: true,
      isRestricted: true,
      isHidden: true,
    },
  ],
})

// Prefer the policy module over the advertisement-only Nip29Module.
const modules = [
  ...DefaultModules.filter((m) => m.id !== "nip-29"),
  module,
]

const relay = await startRelay({ port: 8080, modules })

// After membership changes, publish relay-signed projections clients verify.
function publishMembership(groupId: string) {
  const proj = controller.buildRelaySignedProjections(groupId)
  if (!proj.ok) throw new Error(proj.reason)
  const metadata = finalizeEvent(proj.metadata, relaySecret)
  const admins = finalizeEvent(proj.admins, relaySecret)
  const members = finalizeEvent(proj.members, relaySecret)
  const roles = finalizeEvent(proj.roles, relaySecret)
  const pinned = finalizeEvent(proj.pinned, relaySecret)
  // Store/broadcast metadata, admins, members, roles through the relay host.
  return { metadata, admins, members, roles, pinned }
}

publishMembership("openagents-community")
```

## Membership and capability grants

```ts
// Admit a developer (and bind a work-unit capability grant).
controller.putUser({
  groupId: "openagents-community",
  pubkey: developerPubkey,
  roles: ["member"],
  capabilityGrants: ["unit:abc123"],
})
publishMembership("openagents-community")

// Immediate revocation: membership and grants end together.
const rev = controller.removeUser({
  groupId: "openagents-community",
  pubkey: developerPubkey,
})
// rev.revokedCapabilityGrants === ["unit:abc123"]
// controller.hasCapabilityGrant("unit:abc123") === false
publishMembership("openagents-community")
```

Moderation events that pass the policy (`kind:9000` put-user, `kind:9001`
remove-user, join/leave, and so on) update the same engine through the
module `preStoreHook`. Drain `controller.drainLastRevocation()` after a
remove to mirror capability cleanup into an external grant store.

## Client verification

1. Load NIP-11 and read `self` (relay pubkey).
2. Fetch `kind:39002` with `#d = <group-id>`.
3. Verify the event id and Schnorr signature.
4. Confirm `event.pubkey === relay self`.
5. Treat `p` tags as the current membership set.

`Nip29Service` / `nostr-effect/nip29` already parse metadata, admins, and
members for clients.

## Scoped discovery

```ts
// Global directory — always empty when scopedDiscovery is on (default).
controller.listDiscoverableGroupIds() // []

// Invitation / naddr path — explicit ids only.
controller.listDiscoverableGroupIds({
  explicitGroupIds: ["openagents-community"],
  viewerPubkey: developerPubkey,
})
```

Hosts that answer `REQ` for `kinds:[39000]` without a `#d` filter should return
no events when this policy is active.

## Two-room rule

```ts
controller.assertRoomIsolation(
  "openagents-community",
  "sarah-owner-private"
)
// { admit: true } when membership sets are disjoint
```

Do not put the same pubkey in both rooms. History is already separate because
each room uses its own `h` / `d` group id.

## Pure engine (no relay host)

```ts
import { GroupPolicyEngine } from "nostr-effect" // or core path

const engine = new GroupPolicyEngine({ relayPubkey })
engine.createGroup({ id: "g", creatorPubkey: ownerPubkey })
engine.admitEvent({ pubkey, kind: 1, tags: [["h", "g"]], content: "" })
```

## Source map

| Piece | Path |
| --- | --- |
| Pure engine | `src/core/Nip29GroupPolicy.ts` |
| Relay module factory | `src/relay/core/nip/modules/Nip29Module.ts` (`createNip29GroupPolicyModule`) |
| Durable Node host | `src/relay/backends/node/RelayNip29Host.ts` |
| Advertisement-only module | `Nip29Module` (default module set) |
| Client loaders/parsers | `src/client/Nip29Service.ts`, `src/wrappers/nip29.ts` |
| Tests | `src/core/Nip29GroupPolicy.test.ts`, `src/relay/core/nip/modules/Nip29Module.test.ts` |

## Exit criteria (issue #168)

- [x] Owned relay admits a closed NIP-29 group
- [x] Membership enforced on write (`h` tag + restricted)
- [x] Relay-signed membership state build + client verify
- [x] Scoped discovery (no global directory)
- [x] Immediate revocation of membership and capability grants
- [x] Community vs owner-private isolation helper
