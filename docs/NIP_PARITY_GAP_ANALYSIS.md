# NIP Parity Gap Analysis

Date: 2026-06-09

Reference inputs:

- Upstream NIPs clone: `/Users/christopherdavid/work/projects/repos/nips`
- Upstream commit: `7a2197c` (`nip50: add autocomplete:true/false search extension (#2357)`)
- nostr-effect commit reviewed: `ffce04d` (`test: add NIP wrapper and module coverage`)
- nostr-effect claimed support list: `docs/SUPPORTED_NIPS.md`

This audit compares the current local `nostr-protocol/nips` reference clone
against the NIP support that `nostr-effect` claims and exposes. It is not a
recommendation to implement every NIP. The upstream README explicitly says NIPs
are not a checklist; the practical goal is to identify what is missing, what is
stale, and what matters for OpenAgents integrations such as orange-check,
Forum, relay bridge, and Lightning-adjacent flows.

## Summary

Current upstream has 98 root NIP files excluding `README.md`. The README public
list names 94 NIPs because it omits older/moved protocol files such as
`12.md`, `16.md`, `20.md`, and `33.md`.

`nostr-effect` currently claims support for 93 entries. Of those, 92 correspond
to upstream root NIP files, and one entry (`SB`) is an OpenAgents-specific
remote sandbox protocol outside the upstream NIPs repo.

The direct upstream omissions are:

- `NIP-5A`: Static Websites / nsites
- `NIP-67`: EOSE Completeness Hint
- `NIP-85`: Trusted Assertions
- `NIP-A4`: Public Messages
- `NIP-CC`: Geocaching Events
- `NIP-F4`: Podcasts

The higher-risk issue is semantic drift in existing claimed support:

- `NIP-58` badge support is stale for current Profile Badges and Badge Sets.
- `NIP-98` HTTP auth validation does not currently verify the event signature.
- `NIP-01` filter/tag support is too narrow for arbitrary current tag filters.
- `NIP-50` lacks the new `autocomplete:true/false` search extension from the
  current upstream commit.
- `NIP-11`, `NIP-51`, and package kind constants are missing several current
  fields/kinds.

## Missing NIPs

| NIP | Upstream title | Current status | Why it matters | Suggested priority |
| --- | --- | --- | --- | --- |
| `5A` | Static Websites (nsites) | Missing | Uses Blossom assets plus site manifest events (`15128`, `35128`) to serve static sites. This is adjacent to existing Blossom support but needs manifest validation, base36 pubkey label parsing, path/server tag handling, and host fallback behavior. | Medium if `nostr-effect` wants Blossom/site-host coverage; otherwise low. |
| `67` | EOSE Completeness Hint | Missing | Extends `["EOSE", subid]` with optional hints such as `["finish"]` and `["more"]`. This directly affects relay correctness and client pagination. | High for relay and `SimplePool` quality. |
| `85` | Trusted Assertions | Missing | Defines signed assertion events for users, events, addressable events, and NIP-73 identifiers (`30382`-`30385`) plus user provider preferences (`10040`). This is useful for OpenAgents reputation, orange-check metadata, and web-of-trust overlays. | High for OpenAgents reputation/orange-check work; medium generally. |
| `A4` | Public Messages | Missing | Defines public kind `24` messages to one or more receivers using `p` tags, routed to receiver NIP-65 inbox relays and sender outbox relays. This is different from NIP-17 DMs and NIP-C7 chats. | Medium for social/client coverage. |
| `CC` | Geocaching Events | Missing | Adds geocache listing/log events (`37515`, `37516`) and geohash/query conventions. It also exposes broader tag-filter needs such as `#g` and, in the spec examples, multi-character filters like `#status` and `#cache-type`. | Low unless building location/geocaching clients. |
| `F4` | Podcasts | Missing | Adds podcast metadata (`10154`), podcast episodes (`54`), authored podcasts (`10064`), and favorite podcasts (`10054`). It also expands current NIP-51 list coverage. | Medium for media clients; low for relay/core. |

## Implemented NIPs Now Marked Unrecommended Upstream

The current upstream README marks these NIPs as unrecommended:

| NIP | Current upstream reason | nostr-effect status |
| --- | --- | --- |
| `03` | OpenTimestamps attack risk; needs update | Implemented wrapper/tests. Keep as legacy unless there is a maintenance reason. |
| `04` | Deprecated in favor of NIP-17 | Implemented. Keep for legacy decryption but document as deprecated. |
| `06` | Prefer a single `nsec` | Implemented key derivation. Keep as compatibility helper. |
| `08` | Deprecated in favor of NIP-27 | Implemented wrapper/tests. Mark legacy. |
| `15` | Marketplace too complicated; use NIP-99 instead | Implemented client and relay module. Avoid advertising as preferred new marketplace path. |
| `26` | Delegation adds burden for little gain | Implemented wrapper/tests. Avoid using for OpenAgents authority or owner delegation. |
| `28` | Public Chat superseded by NIP-29 | Implemented client and relay module. Prefer NIP-29 for new group/community work. |
| `31` | Unknown events / `alt` tag considered bloated | Implemented helper/tests. Low risk as a helper. |
| `72` | Moderated Communities superseded by NIP-29 | Implemented wrapper/tests. Avoid as first choice for Forum bridge work. |
| `90` | Data Vending Machines got too broad | Implemented DVM service/tests. Treat as legacy/generalized DVM support, not a new product default. |
| `96` | HTTP File Storage replaced by Blossom | Implemented wrapper/tests. Prefer Blossom / NIP-B7 for new media storage work. |
| `BE` | BLE protocol unclear and needs review | Implemented service/tests. Keep niche. |
| `EE` | MLS E2EE superseded by Marmot Protocol | Implemented service/tests. Do not position as current preferred E2EE messaging. |

Recommendation: keep these compatibility exports unless removing them is an
explicit product/API decision, but update docs and relay defaults so users do
not mistake unrecommended NIPs for preferred new implementation targets.

## High-Risk Semantic Drift

### NIP-58 Badges

This is the most important gap for orange-check.

Current upstream NIP-58 says:

- Badge Definition is kind `30009`.
- Badge Award is kind `8`.
- Profile Badges is kind `10008` as a NIP-51 standard list.
- Badge Set is kind `30008` as a NIP-51 set.
- The earlier kind `30008` Profile Badges event with `d=profile_badges` is
  deprecated, but clients may treat it as equivalent for migration.

Current `nostr-effect` defines:

- `BADGE_DEFINITION_KIND = 30009`
- `BADGE_AWARD_KIND = 8`
- `PROFILE_BADGES_KIND = 30008`
- `ProfileBadges.d = "profile_badges"`

That means current Profile Badges support is the deprecated shape, and Badge Set
support is missing. This should be fixed before using `nostr-effect` for
OpenAgents orange-check badge exports.

Recommended fix:

- Change current Profile Badges generation/validation to kind `10008`.
- Add Badge Set generation/validation for kind `30008`.
- Preserve deprecated `30008` `d=profile_badges` parsing behind an explicit
  legacy helper or migration path.
- Update tests with current upstream examples and add orange-check-specific
  badge definition/award/profile-badge fixtures.

### NIP-98 HTTP Auth

Current upstream NIP-98 requires servers to validate a kind `27235` event with
the exact absolute URL, HTTP method, reasonable timestamp window, and optional
payload hash over the request body.

Current `src/core/Nip98.ts` validates kind, timestamp, URL tag, method tag, and
payload tag, but `validateEventFull` currently comments that signature
verification is assumed rather than performed. It also hashes `JSON.stringify`
of an object payload, not necessarily the raw HTTP request body bytes.

This is not strong enough for account linking or orange-check Nostr key
attachment.

Recommended fix:

- Verify the Nostr event signature inside `validateEventFull` or expose a
  strict verifier that composes with `verifyEvent`.
- Hash the exact request body bytes for `payload`, with a helper that accepts
  `Uint8Array`, `ArrayBuffer`, `string`, or `Request`.
- Keep the current object helper only as a convenience wrapper with documented
  canonicalization limits.
- Add tests where a valid token fails after signature tampering, URL query
  changes, method changes, timestamp expiry, and raw body mutation.

### NIP-01 Filter And Tag Indexing

Current NIP-01 says all single-letter tag keys (`a-z`, `A-Z`) are expected to
be indexed by relays and queryable with `#<letter>`.

Current `Filter` schema only models:

- `#e`
- `#p`
- `#a`
- `#d`
- `#t`

Current `FilterMatcher` only checks the same fixed set. That is not enough for
current NIP coverage. Examples:

- NIP-CC needs `#g` geohash queries.
- NIP-A4 and NIP-57 rely on `#p`, `#k`, and related routing/target tags.
- NIP-73 external identifiers use `i` tags.
- Current and future single-letter tags should not require schema edits.

Recommended fix:

- Represent filters with an index signature for `#<single-letter>` keys while
  keeping typed helpers for common tags.
- Update matcher/storage query paths to apply any `#x` single-letter filter,
  not just the hard-coded subset.
- Decide whether to support multi-character tag filters such as the examples in
  NIP-CC (`#status`, `#cache-type`). If supported, document it as broader than
  NIP-01's single-letter indexing convention.

### NIP-67 EOSE Completeness

Current upstream NIP-67 permits:

```json
["EOSE", "<subscription_id>", ["finish"]]
["EOSE", "<subscription_id>", ["more"]]
```

Current `nostr-effect` schemas and relay messages only model the legacy
two-element `["EOSE", subid]` form. `MessageHandler` emits two-element EOSE
unconditionally.

Recommended fix:

- Extend `RelayEoseMessage` to accept an optional third array of hint strings.
- Add typed hint helpers for `finish` and `more`.
- Teach relay query paths to emit `finish` when query limits/storage caps prove
  completion, and `more` when the backend can cheaply detect additional stored
  matches.
- Teach `SimplePool` and relay clients to consume unknown hints safely and use
  `more`/`finish` for pagination decisions.

### NIP-50 Search

The current upstream commit is specifically a NIP-50 update adding the
`autocomplete:true/false` extension. NIP-50 also lists other extension keys such
as `include:spam`, `domain`, `language`, `sentiment`, and `nsfw`.

Current `Nip50Service` sends `filter.search` strings and the relay matcher does
case-insensitive content substring search. There is no parsing, construction,
or server behavior for the `autocomplete:true/false` extension, and no scoring
or extension handling.

Recommended fix:

- Add a typed `SearchExtension` model and serializer/parser for NIP-50
  `key:value` tokens.
- Add `autocomplete?: boolean` to `SearchParams`.
- Add relay matcher behavior for autocomplete against short, name-shaped fields:
  metadata `name`, `display_name`, `nip05`, channel names, and `title` tags.
- Keep existing substring behavior as the default full-text fallback.

### NIP-11 Relay Information

Current NIP-11 includes optional fields such as `banner`, `self`,
`terms_of_service`, `limitation.default_limit`, and fee units shown as `msats`.
It also says relay-side `supported_nips` should not advertise client-only NIPs.

Current `Nip11.ts` has several fields typed as required in
`BasicRelayInformation`, omits some current optional fields, and uses the fee
unit `"msat"` instead of the current example spelling `"msats"`. The relay
module registry is better than the old static `RelayInfo`, but default module
selection should be reviewed because it includes some upstream-unrecommended
relay modules.

Recommended fix:

- Make current NIP-11 top-level fields optional where the spec allows omission.
- Add `banner`, `self`, `terms_of_service`, and `limitation.default_limit`.
- Decide whether to accept both `msat` and `msats` for compatibility.
- Ensure relay `supported_nips` advertises only relay behavior actually active
  in the deployed relay configuration.

### NIP-51 Lists

Current NIP-51 includes newer standard lists and sets that are absent from
`kinds.ts` and likely absent from `Nip51Service` helpers. Notable examples:

- Standard lists: `10012`, `10013`, `10020`, `10054`, `10063`, `10064`
- Sets: `30007`, `30063`, `30267`, `39089`, `39092`
- Profile Badges current kind `10008`
- Badge Sets current kind `30008`

Recommended fix:

- Update `kinds.ts` to the current NIP-51 table.
- Add high-level helper coverage for the new standard lists/sets.
- Reconcile NIP-58 badge helpers with NIP-51's current badge list/set split.

### Event Kind Constants

The upstream README says the event-kind table is not exhaustive and points to
the separate registry-of-kinds project for machine-readable authority. Still,
`nostr-effect/kinds` is a public convenience surface and is currently behind
the upstream README table.

Missing or stale examples include:

- Regular/social/media: `9`, `11`, `15`, `17`, `20`, `21`, `22`, `24`, `54`,
  `78`
- Lists/media/storage: `10008`, `10011`, `10012`, `10013`, `10019`, `10020`,
  `10054`, `10063`, `10064`, `10154`, `15128`, `17375`, `24242`
- Assertions/sites/geocaching/podcasts: `30382`-`30385`, `35128`, `37515`,
  `37516`

Recommended fix:

- Update constants from current NIPs plus registry-of-kinds if this package
  intends to offer a current kind catalog.
- Add tests that assert current NIP constants used by wrappers/services match
  the upstream values.

## Orange-Check Impact

For OpenAgents orange-check or Forum integration, do not use `nostr-effect` as
the authority path yet. Use OpenAgents ledgers and receipts as authority, then
export Nostr artifacts after validation.

The minimum `nostr-effect` fixes before using it for orange-check are:

1. Fix NIP-98 signature verification and raw body payload hashing.
2. Fix NIP-58 Profile Badges to current kind `10008` and add Badge Sets kind
   `30008`.
3. Add or expose NIP-85 Trusted Assertions if OpenAgents wants a signed
   reputation/trust overlay in addition to badges.
4. Add NIP-67 if OpenAgents runs a relay bridge or depends on relay pagination
   completeness.
5. Add the NIP-50 autocomplete extension if OpenAgents wants Nostr-backed
   typeahead for profiles, communities, badges, or Forum surfaces.

## Suggested Buildout Order

1. Correct high-risk current support first: NIP-98, NIP-58/NIP-51, and generic
   NIP-01 tag filters.
2. Add NIP-67 to the relay/client path because it is small and improves
   pagination semantics.
3. Add NIP-85 for OpenAgents trust/orange-check export work.
4. Add NIP-5A only after Blossom support is solid enough to host and retrieve
   static assets.
5. Add NIP-A4, NIP-F4, and NIP-CC based on actual product demand.
6. Mark upstream-unrecommended NIPs in docs and examples so new users do not
   pick legacy protocols by accident.

## Current Coverage Table

| Category | NIPs |
| --- | --- |
| Missing upstream NIPs | `5A`, `67`, `85`, `A4`, `CC`, `F4` |
| Implemented but upstream-unrecommended | `03`, `04`, `06`, `08`, `15`, `26`, `28`, `31`, `72`, `90`, `96`, `BE`, `EE` |
| Upstream files supported but omitted from README public list | `12`, `16`, `20`, `33` |
| OpenAgents-specific non-upstream support | `SB` |
| Highest-priority semantic drift | `58`, `98`, `01`, `50`, `11`, `51` |
