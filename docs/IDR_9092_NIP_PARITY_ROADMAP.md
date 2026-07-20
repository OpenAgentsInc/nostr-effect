# Roadmap — Issue #9092 sovereign identity × nostr-effect NIP parity

**OpenAgents epic:** [OpenAgentsInc/openagents#9092](https://github.com/OpenAgentsInc/openagents/issues/9092)  
**Source of truth (OpenAgents):** `docs/sol/2026-07-20-pylon-bip39-nostr-spark-identity-recovery-audit.md`  
**This repo:** provide **library-grade NIP primitives** so `packages/sovereign-identity` can stay thin and not re-implement protocol crypto.

## What #9092 needs from Nostr

| Concern | NIP | Role in IDR |
| --- | --- | --- |
| BIP-39 → Nostr key | **06** | `m/44'/1237'/0'/0/0`, empty passphrase (legacy OpenAgents) |
| Public identity display | **19** | `npub` / `nsec` encode for manifest + recovery receipts |
| Sign / encrypt without leaking root | **44** | NIP-44 encrypt/decrypt on derived key |
| Remote / web signing | **46** | Desktop/web may use bunker / nostrconnect later (IDR-08) |
| HTTP auth for local services | **98** | Pylon already validates kind `27235` auth; library must verify sigs |
| Core event id/sig | **01** | finalize/verify already solid via pure + EventService |

Out of scope for **this** repo (lives in OpenAgents packets #9093–#9103):

- Platform Keychain / secret store  
- Spark derivation `m/44'/0'/0'/0/0` and Breez SDK  
- Desktop BOOT SEQUENCE UI  
- Live owner secrets  

## Implementation order

### Phase A — Identity crypto hard floor ✅

1. **NIP-06** perfect parity with NIP-06 test vectors + OpenAgents empty-passphrase path  
2. **NIP-19** integration: nsec/npub from NIP-06 account (fixture-only)  
3. **NIP-98** fix: verify Schnorr signature; hash raw body bytes for `payload`  
4. **NIP-44** re-confirm vector suite still green (no API break)  
5. **NIP-46** re-confirm method surface for connect/sign/nip44_*  

### Phase B — Identity-friendly façade ✅

6. Thin `IdentityKeys` helper: mnemonic → public identity + signer  
7. `LocalSignerPort` + `LocalKeySigner` (sign, NIP-44, NIP-98; no key export on port)  
8. Consumer docs: [`docs/IDENTITY.md`](./IDENTITY.md)  

### Phase C — Broader gap analysis (not #9092-blocking)

Continues from `docs/nip-gap-analysis/`: open tag filters, NIP-58 badges, NIP-57, NIP-47, OpenAgents drafts (SA/AC/SKL/…), etc.  
**Do not block IDR** on those.

## Success criteria

### Phase A

- [x] Official NIP-06 mnemonic vectors match (pk, nsec, pubkey, npub)  
- [x] Explicit constant `NIP06_ACCOUNT_PATH = "m/44'/1237'/0'/0/0"`  
- [x] Empty passphrase default documented and tested  
- [x] 12- and 24-word generation  
- [x] NIP-98 rejects bad signatures  
- [x] NIP-98 payload hash accepts `Uint8Array` / raw string body  
- [x] NIP-44 + NIP-46 existing suites green  
- [x] `bun run verify` green  

### Phase B

- [x] `IdentityKeys.fromOpenAgentsLegacyMnemonic` / `fromMnemonic` / `generate`  
- [x] `asSigner(): LocalSignerPort` without export methods on the port object  
- [x] `LocalKeySigner` NIP-44 + NIP-98 + public manifest  
- [x] Secrets not present in `toJSON` / `toString`  
- [x] `dispose()` zeros key material  
- [x] Package export `nostr-effect/identity`  
- [x] Docs in `docs/IDENTITY.md`  

## Status

| Phase | Status |
| --- | --- |
| A | **Done** |
| B | **Done** |
| C | Separate from #9092 |

## Code touchpoints

| NIP / feature | Paths |
| --- | --- |
| 06 | `src/core/Nip06.ts`, tests, `src/wrappers/nip06.ts` |
| 98 | `src/core/Nip98.ts`, tests, `src/wrappers/nip98.ts` |
| Identity façade | `src/core/IdentityKeys.ts`, `src/core/LocalSigner.ts` |
| Exports | `src/wrappers/identity.ts` → `nostr-effect/identity` |
| Docs | `docs/IDENTITY.md`, this file |
