# Supported NIPs (Definitive)

Canonical list of NIPs supported by this repo. For each NIP, we link to:
- Spec path (local): `~/code/nips/<nip>.md`
- Main code entry points (service/wrapper/module)
- Tests (when present)

Keep this file up to date whenever adding or removing support.

| NIP | Title | Spec | Code (service/wrapper/module) | Tests |
|-----|-------|------|--------------------------------|-------|
| 01 | Basic protocol flow | `~/code/nips/01.md` | `src/relay/core/nip/modules/Nip01Module.ts` | `src/relay/FilterMatcher.test.ts` |
| 02 | Follow list | `~/code/nips/02.md` | `src/client/FollowListService.ts` | `src/client/FollowListService.test.ts` |
| 04 | Legacy encrypted DMs | `~/code/nips/04.md` | `src/wrappers/nip04.ts` | `src/core/Nip04.test.ts` |
| 05 | DNS-based identifiers | `~/code/nips/05.md` | `src/client/Nip05Service.ts` | `src/client/Nip05Service.test.ts` |
| 06 | Key derivation from mnemonic | `~/code/nips/06.md` | `src/wrappers/nip06.ts` | `src/core/Nip06.test.ts` |
| 10 | Reply threading | `~/code/nips/10.md` | `src/client/Nip10Service.ts` | `src/client/Nip10Service.test.ts` |
| 11 | Relay information | `~/code/nips/11.md` | `src/relay/core/nip/modules/Nip11Module.ts` | `src/core/Nip11.test.ts`, `src/relay/RelayInfo.test.ts` |
| 13 | Proof of Work | `~/code/nips/13.md` | `src/wrappers/nip13.ts` | `src/core/Nip13.test.ts` |
| 16 | Event treatment | `~/code/nips/16.md` | `src/relay/core/nip/modules/Nip16Module.ts` | `src/relay/core/nip/NipRegistry.test.ts` |
| 17 | Private direct messages | `~/code/nips/17.md` | `src/client/Nip17Service.ts` | `src/core/Nip17.test.ts`, `src/client/Nip17Service.test.ts` |
| 18 | Reposts | `~/code/nips/18.md` | `src/client/Nip18Service.ts` | `src/client/Nip18Service.test.ts` |
| 19 | bech32 encoding | `~/code/nips/19.md` | `src/core/Nip19.ts`, `src/wrappers/nip19.ts` | `src/core/Nip19.test.ts`, `src/wrappers/nip19.test.ts` |
| 21 | nostr: URI scheme | `~/code/nips/21.md` | `src/core/Nip21.ts`, `src/wrappers/nip21.ts` | `src/core/Nip21.test.ts` |
| 25 | Reactions | `~/code/nips/25.md` | `src/client/Nip25Service.ts` | `src/client/Nip25Service.test.ts` |
| 27 | Content parsing | `~/code/nips/27.md` | `src/wrappers/nip27.ts` | `src/core/Nip27.test.ts` |
| 28 | Public chat | `~/code/nips/28.md` | `src/client/ChatService.ts`, `src/relay/core/nip/modules/Nip28Module.ts` | `src/client/ChatService.test.ts` |
| 29 | Relay-based groups | `~/code/nips/29.md` | `src/client/Nip29Service.ts` | (none yet) |
| 30 | Custom emoji | `~/code/nips/30.md` | `src/wrappers/nip30.ts` | `src/core/Nip30.test.ts` |
| 33 | Parameterized replaceable events | `~/code/nips/33.md` | `src/relay/core/nip/modules/Nip16Module.ts` | `src/relay/core/nip/NipRegistry.test.ts` |
| 32 | Labeling | `~/code/nips/32.md` | `src/client/Nip32Service.ts` | `src/client/Nip32Service.test.ts` |
| 34 | Git collaboration | `~/code/nips/34.md` | `src/core/Nip34.ts` | `src/core/Nip34.test.ts` |
| 23 | Long-form content | `~/code/nips/23.md` | `src/client/Nip23Service.ts` | `src/client/Nip23Service.test.ts` |
| 39 | External identities | `~/code/nips/39.md` | `src/client/Nip39Service.ts` | `src/client/Nip39Service.test.ts` |
| 52 | Calendar events | `~/code/nips/52.md` | `src/client/Nip52Service.ts` | `src/client/Nip52Service.test.ts` |
| 53 | Live activities | `~/code/nips/53.md` | `src/client/Nip53Service.ts` | `src/client/Nip53Service.test.ts` |
| 40 | Expiration timestamp | `~/code/nips/40.md` | (handled by relay policies) | `src/core/Nip40.test.ts` |
| 42 | Client authentication | `~/code/nips/42.md` | `src/relay/core/nip/modules/Nip42Module.ts` | `src/core/Nip42.test.ts`, `src/relay/core/nip/modules/Nip42Module.test.ts` |
| 44 | Versioned encryption | `~/code/nips/44.md` | `src/services/Nip44Service.ts` | `src/services/Nip44Service.test.ts` |
| 46 | Nostr Connect | `~/code/nips/46.md` | `src/client/Nip46Service.ts` | `src/client/Nip46Service.test.ts` |
| 47 | Nostr Wallet Connect | `~/code/nips/47.md` | `src/wrappers/nip47.ts` | `src/core/Nip47.test.ts` |
| 49 | Encrypted private keys | `~/code/nips/49.md` | `src/wrappers/nip49.ts` | `src/core/Nip49.test.ts` |
| 54 | Wiki | `~/code/nips/54.md` | `src/wrappers/nip54.ts` | `src/core/Nip54.test.ts` |
| 57 | Lightning zaps | `~/code/nips/57.md` | `src/client/ZapService.ts`, `src/relay/core/nip/modules/Nip57Module.ts` | `src/client/ZapService.test.ts` |
| 58 | Badges | `~/code/nips/58.md` | `src/client/Nip58Service.ts` | `src/client/Nip58Service.test.ts` |
| 59 | Gift wrap | `~/code/nips/59.md` | `src/wrappers/nip59.ts` | `src/core/Nip59.test.ts` |
| 65 | Relay list metadata | `~/code/nips/65.md` | `src/client/RelayListService.ts` | `src/client/RelayListService.test.ts` |
| 75 | Zap goals | `~/code/nips/75.md` | `src/wrappers/nip75.ts` | `src/core/Nip75.test.ts` |
| 78 | Arbitrary custom app data | `~/code/nips/78.md` | `src/client/AppDataService.ts` | `src/client/AppDataService.test.ts` |
| 66 | Relay discovery & liveness | `~/code/nips/66.md` | `src/client/RelayDiscoveryService.ts` | `src/client/RelayDiscoveryService.test.ts` |
| 87 | Ecash mint discoverability | `~/code/nips/87.md` | `src/client/MintDiscoverabilityService.ts` | `src/client/MintDiscoverabilityService.test.ts` |
| 89 | Recommended application handlers | `~/code/nips/89.md` | `src/client/HandlerService.ts` | `src/client/HandlerService.test.ts` |
| 90 | Data vending machine | `~/code/nips/90.md` | `src/client/DVMService.ts` | `src/client/DVMService.test.ts` |
| 71 | Video events | `~/code/nips/71.md` | `src/client/Nip71Service.ts` | `src/client/Nip71Service.test.ts` |
| 88 | Polls | `~/code/nips/88.md` | `src/client/Nip88Service.ts` | `src/client/Nip88Service.test.ts` |
| 51 | Lists | `~/code/nips/51.md` | `src/client/Nip51Service.ts` | `src/client/Nip51Service.test.ts` |
| 45 | Event counts | `~/code/nips/45.md` | `src/client/Nip45Service.ts`, `src/relay/core/MessageHandler.ts` | `src/client/Nip45Service.test.ts` |
| 50 | Search capability | `~/code/nips/50.md` | `src/relay/core/FilterMatcher.ts` | `src/client/Nip50Service.test.ts` |
| 09 | Event deletion | `~/code/nips/09.md` | `src/relay/core/MessageHandler.ts` | `src/relay/Nip09Deletion.test.ts` |
| 31 | Unknown kinds (alt tag) | `~/code/nips/31.md` | `src/wrappers/nip31.ts` | `src/wrappers/nip31.test.ts` |
| 14 | Subject tag | `~/code/nips/14.md` | `src/wrappers/nip14.ts` | `src/wrappers/nip14.test.ts` |
| 36 | Sensitive content (content-warning) | `~/code/nips/36.md` | `src/wrappers/nip36.ts` | `src/wrappers/nip36.test.ts` |
| 48 | Proxy tags | `~/code/nips/48.md` | `src/wrappers/nip48.ts` | `src/wrappers/nip48.test.ts` |
| 94 | File metadata | `~/code/nips/94.md` | `src/core/Nip94.ts`, `src/wrappers/nip94.ts` | `src/core/Nip94.test.ts` |
| 98 | HTTP auth | `~/code/nips/98.md` | `src/wrappers/nip98.ts` | `src/core/Nip98.test.ts` |
| 99 | Classified listings | `~/code/nips/99.md` | `src/wrappers/nip99.ts` | `src/core/Nip99.test.ts` |

Notes
- Registry modules live under `src/relay/core/nip/modules/**`. Default relay modules: NIP-01, NIP-11, NIP-16/33. Others (e.g., NIP-28, NIP-57, NIP-42) are available but may not be in `DefaultModules`.
- Client services live under `src/client/**`. Wrappers for specific NIPs live under `src/wrappers/**`.
- Some NIPs are primarily policy/behavior and validated by integration tests rather than a dedicated “NipXXService”.
