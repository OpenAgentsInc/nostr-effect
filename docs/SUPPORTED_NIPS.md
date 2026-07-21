# Supported NIPs (Definitive)

Canonical list of NIPs supported by this repo. For each NIP, we link to:
- Spec path (local): `~/code/nips/<nip>.md`
- Main code entry points (service/wrapper/module)
- Tests (when present)

Keep this file up to date whenever adding or removing support.

| NIP | Title | Spec | Code (service/wrapper/module) | Tests |
|-----|-------|------|--------------------------------|-------|
| 01 | Basic protocol flow | `~/code/nips/01.md` | `src/relay/core/nip/modules/Nip01Module.ts`, `src/core/Schema.ts` (open `#` tag filters), `src/relay/core/FilterMatcher.ts` | `src/relay/FilterMatcher.test.ts`, `src/core/Schema.test.ts` |
| 02 | Follow list | `~/code/nips/02.md` | `src/client/FollowListService.ts` | `src/client/FollowListService.test.ts` |
| 03 | OpenTimestamps attestations | `~/code/nips/03.md` | `src/wrappers/nip03.ts` | `src/wrappers/nip03.test.ts` |
| 04 | Legacy encrypted DMs | `~/code/nips/04.md` | `src/wrappers/nip04.ts` | `src/core/Nip04.test.ts` |
| 05 | DNS-based identifiers | `~/code/nips/05.md` | `src/client/Nip05Service.ts` | `src/client/Nip05Service.test.ts` |
| 06 | Key derivation from mnemonic | `~/code/nips/06.md` | `src/wrappers/nip06.ts` | `src/core/Nip06.test.ts` |
| 08 | Handling mentions | `~/code/nips/08.md` | `src/wrappers/nip08.ts` | `src/wrappers/nip08.test.ts` |
| 07 | window.nostr capability | `~/code/nips/07.md` | `src/wrappers/nip07.ts` | `src/wrappers/nip07.test.ts` |
| 09 | Event deletion | `~/code/nips/09.md` | `src/relay/core/MessageHandler.ts` (`e` + `a` tags) | `src/relay/Nip09Deletion.test.ts` |
| 10 | Reply threading | `~/code/nips/10.md` | `src/client/Nip10Service.ts` | `src/client/Nip10Service.test.ts` |
| 11 | Relay information | `~/code/nips/11.md` | `src/relay/core/nip/modules/Nip11Module.ts`, `src/core/Nip11.ts` (banner/self/terms aligned) | `src/core/Nip11.test.ts`, `src/relay/RelayInfo.test.ts` |
| 12 | Generic tag queries (moved to NIP-01) | `~/code/nips/12.md` | `src/core/Schema.ts`, `src/relay/core/FilterMatcher.ts` | `src/relay/FilterMatcher.test.ts` |
| 13 | Proof of Work | `~/code/nips/13.md` | `src/wrappers/nip13.ts` | `src/core/Nip13.test.ts` |
| 14 | Subject tag | `~/code/nips/14.md` | `src/wrappers/nip14.ts` | `src/wrappers/nip14.test.ts` |
| 15 | Nostr Marketplace | `~/code/nips/15.md` | `src/client/MarketplaceService.ts` | `src/client/MarketplaceService.test.ts` |
| 16 | Event treatment | `~/code/nips/16.md` | `src/relay/core/nip/modules/Nip16Module.ts` (ephemeral → broadcast, no store) | `src/relay/core/nip/NipRegistry.test.ts`, `src/relay/Nip16Ephemeral.test.ts` |
| 17 | Private direct messages | `~/code/nips/17.md` | `src/client/Nip17Service.ts` | `src/core/Nip17.test.ts`, `src/client/Nip17Service.test.ts` |
| 18 | Reposts | `~/code/nips/18.md` | `src/client/Nip18Service.ts`, `src/wrappers/nip18.ts` (`q` quote, addressable `a`) | `src/client/Nip18Service.test.ts`, `src/parity-100.test.ts` |
| 19 | bech32 encoding | `~/code/nips/19.md` | `src/core/Nip19.ts`, `src/wrappers/nip19.ts` | `src/core/Nip19.test.ts`, `src/wrappers/nip19.test.ts` |
| 20 | Command results | `~/code/nips/20.md` | `src/relay/core/MessageHandler.ts` | `src/relay/Nip20CommandResults.test.ts` |
| 21 | nostr: URI scheme | `~/code/nips/21.md` | `src/core/Nip21.ts`, `src/wrappers/nip21.ts` | `src/core/Nip21.test.ts` |
| 22 | Comment | `~/code/nips/22.md` | `src/wrappers/nip22.ts` | `src/wrappers/nip22.test.ts` |
| 23 | Long-form content | `~/code/nips/23.md` | `src/client/Nip23Service.ts` | `src/client/Nip23Service.test.ts` |
| 24 | Extra metadata fields and tags | `~/code/nips/24.md` | `src/wrappers/nip24.ts` | `src/wrappers/nip24.test.ts` |
| 25 | Reactions | `~/code/nips/25.md` | `src/client/Nip25Service.ts` (`a`/`k`, kind 17 external) | `src/client/Nip25Service.test.ts` |
| 26 | Delegated event signing | `~/code/nips/26.md` | `src/wrappers/nip26.ts` | `src/wrappers/nip26.test.ts` |
| 27 | Content parsing | `~/code/nips/27.md` | `src/wrappers/nip27.ts` | `src/core/Nip27.test.ts` |
| 28 | Public chat | `~/code/nips/28.md` | `src/client/ChatService.ts`, `src/relay/core/nip/modules/Nip28Module.ts` | `src/client/ChatService.test.ts` |
| 29 | Relay-based groups | `~/code/nips/29.md` | `src/client/Nip29Service.ts`, `src/relay/core/nip/modules/Nip29Module.ts` (full moderation matrix, LiveKit endpoints) | `src/client/Nip29Service.test.ts`, `src/parity-100.test.ts` |
| 30 | Custom emoji | `~/code/nips/30.md` | `src/core/Nip30.ts`, `src/wrappers/nip30.ts` (set-address 4th param) | `src/core/Nip30.test.ts`, `src/parity-100.test.ts` |
| 31 | Unknown kinds (alt tag) | `~/code/nips/31.md` | `src/wrappers/nip31.ts` | `src/wrappers/nip31.test.ts` |
| 32 | Labeling | `~/code/nips/32.md` | `src/client/Nip32Service.ts` | `src/client/Nip32Service.test.ts` |
| 33 | Parameterized replaceable events | `~/code/nips/33.md` | `src/relay/core/nip/modules/Nip16Module.ts` | `src/relay/core/nip/NipRegistry.test.ts` |
| 34 | Git collaboration | `~/code/nips/34.md` | `src/core/Nip34.ts` | `src/core/Nip34.test.ts` |
| 35 | Torrents | `~/code/nips/35.md` | `src/wrappers/nip35.ts` | `src/wrappers/nip35.test.ts` |
| 36 | Sensitive content (content-warning) | `~/code/nips/36.md` | `src/wrappers/nip36.ts` | `src/wrappers/nip36.test.ts` |
| 37 | Draft wraps | `~/code/nips/37.md` | `src/wrappers/nip37.ts` | `src/wrappers/nip37.test.ts` |
| 38 | User statuses | `~/code/nips/38.md` | `src/client/Nip38Service.ts` | `src/client/Nip38Service.test.ts` |
| 39 | External identities | `~/code/nips/39.md` | `src/client/Nip39Service.ts` | `src/client/Nip39Service.test.ts` |
| 40 | Expiration timestamp | `~/code/nips/40.md` | `src/relay/core/nip/modules/Nip40Module.ts`, `src/relay/backends/bun/BunSqliteStore.ts` | `src/relay/Nip40Expiration.test.ts`, `src/core/Nip40.test.ts` |
| 42 | Client authentication | `~/code/nips/42.md` | `src/relay/core/nip/modules/Nip42Module.ts` | `src/core/Nip42.test.ts`, `src/relay/core/nip/modules/Nip42Module.test.ts` |
| 43 | Relay access metadata/requests | `~/code/nips/43.md` | `src/wrappers/nip43.ts` | `src/wrappers/nip43.test.ts` |
| 44 | Versioned encryption | `~/code/nips/44.md` | `src/services/Nip44Service.ts` | `src/services/Nip44Service.test.ts` |
| 45 | Event counts | `~/code/nips/45.md` | `src/client/Nip45Service.ts`, `src/relay/core/MessageHandler.ts` | `src/client/Nip45Service.test.ts` |
| 46 | Nostr Connect | `~/code/nips/46.md` | `src/client/Nip46Service.ts` | `src/client/Nip46Service.test.ts` |
| 47 | Nostr Wallet Connect | `~/code/nips/47.md` | `src/core/Nip47.ts` (NIP-44 default, hold invoices), `src/wrappers/nip47.ts` | `src/core/Nip47.test.ts` |
| 48 | Proxy tags | `~/code/nips/48.md` | `src/wrappers/nip48.ts` | `src/wrappers/nip48.test.ts` |
| 49 | Encrypted private keys | `~/code/nips/49.md` | `src/wrappers/nip49.ts` | `src/core/Nip49.test.ts` |
| 50 | Search capability | `~/code/nips/50.md` | `src/client/Nip50Service.ts`, `src/relay/core/FilterMatcher.ts` (extensions + `rankSearchResults`) | `src/client/Nip50Service.test.ts`, `src/parity-100.test.ts` |
| 51 | Lists | `~/code/nips/51.md` | `src/client/Nip51Service.ts` | `src/client/Nip51Service.test.ts` |
| 52 | Calendar events | `~/code/nips/52.md` | `src/client/Nip52Service.ts` | `src/client/Nip52Service.test.ts` |
| 53 | Live activities | `~/code/nips/53.md` | `src/client/Nip53Service.ts` | `src/client/Nip53Service.test.ts` |
| 54 | Wiki | `~/code/nips/54.md` | `src/wrappers/nip54.ts` | `src/core/Nip54.test.ts` |
| 55 | Android signer application | `~/code/nips/55.md` | `src/wrappers/nip55.ts` | `src/wrappers/nip55.test.ts` |
| 56 | Reporting | `~/code/nips/56.md` | `src/wrappers/nip56.ts` | `src/wrappers/nip56.test.ts` |
| 57 | Lightning zaps | `~/code/nips/57.md` | `src/client/ZapService.ts` (Appendix F/G), `src/relay/core/nip/modules/Nip57Module.ts` | `src/client/ZapService.test.ts`, `src/client/ZapService.appendix.test.ts` |
| 58 | Badges | `~/code/nips/58.md` | `src/client/Nip58Service.ts` (10008 profile badges, 30008 sets) | `src/client/Nip58Service.test.ts` |
| 59 | Gift wrap | `~/code/nips/59.md` | `src/wrappers/nip59.ts` | `src/core/Nip59.test.ts` |
| 60 | Cashu Wallets | `~/code/nips/60.md` | `src/client/CashuWalletService.ts` | `src/client/CashuWalletService.test.ts` |
| 61 | Nutzaps | `~/code/nips/61.md` | `src/client/NutzapService.ts` (`#u` filters, NIP-44 redeem fallback) | `src/client/NutzapService.test.ts` |
| 62 | Request to Vanish | `~/code/nips/62.md` | `src/relay/core/MessageHandler.ts` | `src/relay/Nip62Vanish.test.ts` |
| 64 | Chess (PGN) | `~/code/nips/64.md` | `src/wrappers/nip64.ts` | `src/wrappers/nip64.test.ts` |
| 65 | Relay list metadata | `~/code/nips/65.md` | `src/client/RelayListService.ts` | `src/client/RelayListService.test.ts` |
| 66 | Relay discovery & liveness | `~/code/nips/66.md` | `src/client/RelayDiscoveryService.ts` | `src/client/RelayDiscoveryService.test.ts` |
| 67 | EOSE Completeness Hint | `~/code/nips/67.md` | `src/relay/core/MessageHandler.ts`, `src/relay/core/nip/modules/Nip67Module.ts` | `src/relay/Nip67Eose.test.ts`, `src/core/Schema.test.ts` |
| 68 | Picture-first feeds | `~/code/nips/68.md` | `src/wrappers/nip68.ts` | `src/wrappers/nip68.test.ts` |
| 69 | Peer-to-peer orders | `~/code/nips/69.md` | `src/wrappers/nip69.ts` | `src/wrappers/nip69.test.ts` |
| 70 | Protected events | `~/code/nips/70.md` | `src/relay/core/MessageHandler.ts` | `src/relay/Nip70Protected.test.ts` |
| 71 | Video events | `~/code/nips/71.md` | `src/client/Nip71Service.ts` | `src/client/Nip71Service.test.ts` |
| 72 | Moderated communities | `~/code/nips/72.md` | `src/wrappers/nip72.ts` | `src/wrappers/nip72.test.ts` |
| 73 | External content IDs | `~/code/nips/73.md` | `src/wrappers/nip73.ts` | `src/wrappers/nip73.test.ts` |
| 75 | Zap goals | `~/code/nips/75.md` | `src/wrappers/nip75.ts` | `src/core/Nip75.test.ts` |
| 7D | Threads | `~/code/nips/7D.md` | `src/client/Nip7DService.ts` | `src/client/Nip7DService.test.ts` |
| 77 | Negentropy syncing | `~/code/nips/77.md` | `src/client/Nip77Service.ts`, `src/relay/core/nip/modules/Nip77Module.ts`, `src/relay/core/MessageHandler.ts` | `src/client/Nip77Service.test.ts`, `src/relay/Nip77Negentropy.test.ts` |
| 78 | Arbitrary custom app data | `~/code/nips/78.md` | `src/client/AppDataService.ts` | `src/client/AppDataService.test.ts` |
| 84 | Highlights | `~/code/nips/84.md` | `src/wrappers/nip84.ts` | `src/wrappers/nip84.test.ts` |
| 85 | Trusted Assertions | `~/code/nips/85.md` | `src/client/Nip85Service.ts`, `src/wrappers/nip85.ts` | `src/client/Nip85Service.test.ts` |
| 86 | Relay Management API | `~/code/nips/86.md` | `src/relay/core/nip/modules/Nip86Module.ts`, `src/relay/backends/bun/BunServer.ts` | `src/relay/Nip86Management.test.ts` |
| 87 | Ecash mint discoverability | `~/code/nips/87.md` | `src/client/MintDiscoverabilityService.ts` | `src/client/MintDiscoverabilityService.test.ts` |
| 88 | Polls | `~/code/nips/88.md` | `src/client/Nip88Service.ts` | `src/client/Nip88Service.test.ts` |
| 89 | Recommended application handlers | `~/code/nips/89.md` | `src/client/HandlerService.ts` | `src/client/HandlerService.test.ts` |
| 90 | Data vending machine | `~/code/nips/90.md` | `src/client/DVMService.ts` | `src/client/DVMService.test.ts` |
| 92 | Media attachments | `~/code/nips/92.md` | `src/wrappers/nip92.ts` | `src/wrappers/nip92.test.ts` |
| 94 | File metadata | `~/code/nips/94.md` | `src/core/Nip94.ts`, `src/wrappers/nip94.ts` | `src/core/Nip94.test.ts` |
| 96 | HTTP file storage | `~/code/nips/96.md` | `src/wrappers/nip96.ts` | `src/wrappers/nip96.test.ts` |
| 98 | HTTP auth | `~/code/nips/98.md` | `src/wrappers/nip98.ts` | `src/core/Nip98.test.ts` |
| 99 | Classified listings | `~/code/nips/99.md` | `src/wrappers/nip99.ts` | `src/core/Nip99.test.ts` |

Notes
- Registry modules live under `src/relay/core/nip/modules/**`. Default relay modules: NIP-01, NIP-11, NIP-16/33. Others (e.g., NIP-28, NIP-57, NIP-42) are available but may not be in `DefaultModules`.
- Client services live under `src/client/**`. Wrappers for specific NIPs live under `src/wrappers/**`.
- Some NIPs are primarily policy/behavior and validated by integration tests rather than a dedicated “NipXXService”.

Lettered NIPs (Definitive)

| NIP | Title | Spec | Code (service/module) | Tests |
|-----|-------|------|------------------------|-------|
| 5A | Static Websites (nsites) | `~/code/nips/5A.md` | `src/client/Nip5AService.ts`, `src/wrappers/nip5a.ts` | `src/client/parity-batch-e.test.ts` |
| A0 | Voice Messages | `~/code/nips/A0.md` | `src/client/NipA0Service.ts`, `src/relay/core/nip/modules/NipA0Module.ts` | `src/client/NipA0Service.test.ts`, `src/relay/NipA0Module.test.ts` |
| A4 | Public Messages | `~/code/nips/A4.md` | `src/client/NipA4Service.ts`, `src/wrappers/nipA4.ts` | `src/client/parity-batch-e.test.ts` |
| B0 | Web Bookmarking | `~/code/nips/B0.md` | `src/client/NipB0Service.ts`, `src/relay/core/nip/modules/NipB0Module.ts` | `src/client/NipB0Service.test.ts` |
| B7 | Blossom Media | `~/code/nips/B7.md` | `src/client/BlossomService.ts` (BUD-03 10063), `src/wrappers/nipb7.ts` | `src/parity-depth-g.test.ts` |
| BE | BLE Communications | `~/code/nips/BE.md` | `src/client/NipBEService.ts` | `src/client/NipBEService.test.ts` |
| C0 | Code Snippets | `~/code/nips/C0.md` | `src/client/NipC0Service.ts` | `src/client/NipC0Service.test.ts` |
| C7 | Chats | `~/code/nips/C7.md` | `src/client/NipC7Service.ts` | `src/client/NipC7Service.test.ts` |
| CC | Geocaching Events | `~/code/nips/CC.md` | `src/client/NipCCService.ts`, `src/wrappers/nipCC.ts` | `src/client/parity-batch-e.test.ts` |
| F4 | Podcasts | `~/code/nips/F4.md` | `src/client/NipF4Service.ts`, `src/wrappers/nipF4.ts` | `src/client/parity-batch-e.test.ts` |

### OpenAgents draft NIPs (non-upstream)

| Spec | Title | Spec path | Code | Tests |
| --- | --- | --- | --- | --- |
| SA | Sovereign Agents | `~/work/openagents/docs/nips/SA.md` | `src/core/OpenAgentsDrafts.ts` | `src/parity-100.test.ts` |
| AC | Agent Credit | `~/work/openagents/docs/nips/AC.md` | `src/core/OpenAgentsDrafts.ts` | `src/parity-100.test.ts` |
| SKL | Skills | `~/work/openagents/docs/nips/SKL.md` | `src/core/OpenAgentsDrafts.ts` | `src/parity-100.test.ts` |
| TRN | Training Network | `~/work/openagents/docs/nips/TRN.md` | `src/core/OpenAgentsDrafts.ts` | `src/parity-100.test.ts` |
| LBR | Agentic Labor | `~/work/openagents/docs/nips/LBR.md` | `src/core/Nip90.ts` + OpenAgentsDrafts | `src/parity-100.test.ts` |
| DS | Datasets | `~/work/openagents/docs/nips/DS.md` | `src/core/Nip90.ts` + OpenAgentsDrafts | `src/parity-100.test.ts` |
| EE | MLS E2EE Messaging | `~/code/nips/EE.md` | `src/client/NipEEService.ts` | `src/client/NipEEService.test.ts` |
| SB | Remote Sandbox Protocol | `docs/mechacoder/NIP-SB.md` (OpenAgents) | `src/core/NipSB.ts`, `src/client/SandboxService.ts` | `src/client/SandboxService.test.ts` |

### Buzz-parity custom NIPs (agent NIP family)

Custom (non-upstream) NIPs implemented for buzz parity. These advertise via NIP-11
`supported_extensions: ["nip-xx"]`, never `supported_nips`. See the gap analysis at
`docs/2026-07-21-buzz-nip-gap-analysis.md`. NIP-OA is the shared cryptographic root
reused by NIP-AA, NIP-GS, and NIP-IA.

| NIP | Title | Spec | Code (service/module) | Tests |
| --- | --- | --- | --- | --- |
| OA | Owner Attestation | `~/work/projects/repos/buzz/docs/nips/NIP-OA.md` | `src/services/OwnerAttestationService.ts` | `src/services/OwnerAttestationService.test.ts` |
| AA | Agent Authentication | `~/work/projects/repos/buzz/docs/nips/NIP-AA.md` | `src/client/AgentAuthService.ts` (kind 22242 + NIP-OA `auth` tag), `src/core/NipAA.ts` (`verifyAgentAuth`), `src/relay/core/nip/modules/NipAaModule.ts` (opt-in) | `src/client/AgentAuthService.test.ts`, `src/core/NipAA.test.ts` |
| AP | Agent Personas | `~/work/projects/repos/buzz/docs/nips/NIP-AP.md` | `src/client/NipAPService.ts` (plaintext addressable `kind:30175` + `30177`), `src/wrappers/kinds.ts` (`AgentPersona`, `AgentInstanceState`) | `src/client/NipAPService.test.ts` |
| AE | Agent Engrams | `~/work/projects/repos/buzz/docs/nips/NIP-AE.md` | `src/client/EngramService.ts` (addressable `kind:30174`, NIP-44 agent↔owner, HMAC-blinded `d`), `src/wrappers/kinds.ts` (`AgentEngram`) | `src/client/EngramService.test.ts` |
| AM | Agent Turn Metrics | `~/work/projects/repos/buzz/docs/nips/NIP-AM.md` | `src/client/AgentMetricsService.ts`, `src/core/NipAM.ts` (regular append-only `kind:44200`, NIP-44 encrypt-to-owner; tags `p`+`agent`) | `src/client/AgentMetricsService.test.ts` |
| AO | Agent Observability | `~/work/projects/repos/buzz/docs/nips/NIP-AO.md` | `src/client/AgentObservabilityService.ts`, `src/core/NipAO.ts` (ephemeral `kind:24200`, NIP-44 bidirectional, optional NIP-59) | `src/client/AgentObservabilityService.test.ts` |
| ER | Event Reminders | `~/work/projects/repos/buzz/docs/nips/NIP-ER.md` | `src/client/EventReminderService.ts` (addressable `kind:30300`, NIP-44 encrypt-to-self + NIP-40) | `src/client/EventReminderService.test.ts` |
| RS | Read State Sync | `~/work/projects/repos/buzz/docs/nips/NIP-RS.md` | `src/client/ReadStateService.ts` (reuses `kind:30078`, NIP-44 encrypt-to-self, max-register CvRDT merge) | `src/client/ReadStateService.test.ts` |
| GS | Git Object Signing | `~/work/projects/repos/buzz/docs/nips/NIP-GS.md` | `src/services/GitObjectSigningService.ts` (Schnorr over `nostr:git:v1:`, armor, optional NIP-OA `oa`) | `src/services/GitObjectSigningService.test.ts` |
| CW | Channel Window | `~/work/projects/repos/buzz/docs/nips/NIP-CW.md` | `src/client/ChannelWindowService.ts` (reader/verify for relay-signed `kind:39005`/`39006`, extended filter helpers), `src/wrappers/kinds.ts` (`ChannelThreadSummary`, `ChannelWindowBounds`) | `src/client/ChannelWindowService.test.ts` |
| DV | DM Visibility | `~/work/projects/repos/buzz/docs/nips/NIP-DV.md` | `src/client/DmVisibilityService.ts` (relay-signed `kind:30622` verifying reader; pure parse/filter helpers), `src/wrappers/kinds.ts` (`DmVisibilitySnapshot`) | `src/client/DmVisibilityService.test.ts` |
| IA | Identity Archival | `~/work/projects/repos/buzz/docs/nips/NIP-IA.md` | `src/client/NipIAService.ts` (kinds 9035/9036/8002/8003/13535; NIP-70 + NIP-OA), `src/wrappers/nipIA.ts`, `src/wrappers/kinds.ts`, `src/relay/core/nip/modules/NipIAModule.ts` | `src/client/NipIAService.test.ts` |
| WP | Workspace Profile | `~/work/projects/repos/buzz/docs/nips/NIP-WP.md` | `src/client/WorkspaceProfileService.ts` (`kind:9033` set/clear icon; read via NIP-11), `src/wrappers/kinds.ts` (`SetWorkspaceProfile`) | `src/client/WorkspaceProfileService.test.ts` |
| AB | Device Pairing | `~/work/projects/repos/buzz/crates/buzz-core/src/pairing/NIP-AB.md` | `src/core/NipAB.ts` (ECDH+HKDF+SAS+NIP-44 crypto, QR, `PairingSession` state machine; kind `24134`) | `src/core/NipAB.test.ts` |
| PL | Push Leases | `~/work/projects/repos/buzz/docs/nips/NIP-PL.md` | `src/client/PushLeaseService.ts` (**wire format only**: addressable `kind:30350`, public tags `d`/`expiration`/`exec`/`alt`, NIP-44 encrypt-to-executor, restricted filter grammar). Out of scope: push.buzz.xyz APNs gateway, App Attest, buzz-relay dispatch. | `src/client/PushLeaseService.test.ts` |
