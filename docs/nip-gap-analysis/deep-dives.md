# Deep dives

## NIP-01 filters

**Code:** `src/core/Schema.ts` (`Filter`), `src/relay/core/FilterMatcher.ts`

NIP-01: all single-letter English tags (`a–z`, `A–Z`) are expected to be indexable as `#<letter>`; only the first value of each tag is indexed.

Today only `#e`, `#p`, `#a`, `#d`, `#t` are modeled. `FilterMatcher` only evaluates that set.

Verified: `decodeFilter({ kinds: [9321], "#u": ["https://mint"] })` succeeds and **drops `#u`**. Same for `#L` / `#l` (NIP-32).

Also: matcher uses **prefix** match on `ids`/`authors`; NIP-01 says exact 64-char lowercase hex.

**Acceptance:** any `#X` single-letter filter works schema → matcher → store → client; document exact-vs-prefix policy.

---

## Marketplace and Lightning

| NIP | Grade | Notes |
| --- | --- | --- |
| 15 Marketplace | Partial / Legacy | Stall/product/auction yes; **no checkout** types 0–2 over NIP-04; unrecommended → 99 |
| 47 NWC | Partial | NIP-04 only; no `encryption` negotiate; hold-invoice methods incomplete; multi-relay URI singular |
| 57 Zaps | Partial | Request/receipt builders; **no validateZapReceipt (App F)**; no zap-split `zap` tags (App G); no LNURL HTTP client |
| 60 Cashu | Mostly OK | 17375/7375/7376 + rollover; strongest payment state path |
| 61 Nutzaps | Partial | Publish OK; `#u` stripped; redeem fallback may skip NIP-44 |
| 69 P2P orders | Mostly OK | Tags incl. expires_at; needs open filters for `#f/#s/#g` |
| 75 Zap goals | Mostly OK | Kind 9041; weak compose with ZapService |
| 87 Mints | Mostly OK | 38000/38172/38173 |
| 99 Classifieds | Mostly OK | Preferred marketplace; strict validation; status/g polish |

**Payments implementation order:** open filters → 57 F/G → 47 NIP-44 → 61 redeem → 99 polish → 15 leave legacy.

---

## Core relay

| NIP | Grade | Notes |
| --- | --- | --- |
| 09 Deletion | Partial | `e` delete OK; **no `a` bulk delete** up to created_at; `k` not required |
| 11 Relay info | Partial client / OK relay | RelayInfo has banner/self/terms; `src/core/Nip11.ts` lags |
| 16/33 Treatment | Partial | Replaceable/addressable OK; **ephemeral still stored** |
| 20 OK results | Mostly OK | Prefixes used; consistency polish |
| 40 Expiration | Mostly OK | Write reject; confirm query-path filter |
| 42 AUTH | Mostly OK | Challenge/verify + protected gate |
| 70 Protected | Mostly OK | Default reject `["-"]`; auth path |

---

## Chat and groups

| NIP | Grade | Notes |
| --- | --- | --- |
| 10 Threading | Mostly OK | Parse root/reply/q; legacy mention still accepted |
| 17 Private DM | Mostly OK | Seal/gift-wrap; 10050 inbox |
| 22 Comment | Mostly OK | Kind 1111 builders |
| 28 Public chat | Legacy OK | Full 40–44; unrecommended → 29 |
| 29 Groups | **Stale** | Only 39000/01/02 read; metadata tags wrong (`public`/`open` vs `private`/`closed`/`restricted`/`hidden`); missing subgroups, LiveKit, pins+`a`, join/invite, moderation 9000–9022, roles 39003–39005; no relay policy module |
| C7 Chats | Mostly OK | Kind 9 + `q` |
| 7D Threads | Mostly OK | Kind 11 + NIP-22 |

**NIP-29 is the largest chat gap** if groups are in product.

---

## Reputation

| NIP | Grade | Notes |
| --- | --- | --- |
| 25 Reactions | Partial | Missing `a`/`k`; no kind 17 external |
| 32 Labeling | Partial | Publish OK; **`#L`/`#l` queries no-op** |
| 56 Reporting | Mostly OK | Profile/note/blob templates |
| 58 Badges | **Stale** | Profile badges still 30008+`profile_badges`; should be **10008**; Badge Sets missing |
| 72 Communities | Legacy OK | Prefer 29 |
| 85 Assertions | **Missing** | WoT/rank offload |

---

