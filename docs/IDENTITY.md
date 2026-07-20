# Identity façade (Phase B)

**Status:** Implemented  
**Related:** [IDR_9092_NIP_PARITY_ROADMAP.md](./IDR_9092_NIP_PARITY_ROADMAP.md), [OpenAgents #9092](https://github.com/OpenAgentsInc/openagents/issues/9092)

This module is the **recommended way** for OpenAgents (`packages/sovereign-identity`, Pylon, Desktop) to use Nostr crypto without re-implementing NIP-06/19/44/98 or leaking root secrets through casual APIs.

## Install / import

```ts
import {
  IdentityKeys,
  LocalKeySigner,
  type LocalSignerPort,
  type PublicIdentityManifest,
  NIP06_ACCOUNT_PATH,
  OPENAGENTS_LEGACY_IDENTITY_PROFILE,
} from "nostr-effect/identity"
```

Also available from `nostr-effect` root and `nostr-effect/signer` (`LocalKeySigner`).

## Concepts

| Type | Role |
| --- | --- |
| **`IdentityKeys`** | NIP-06 derive from mnemonic → public identity + signer |
| **`LocalSignerPort`** | Safe ops: `getPublicKey`, `signEvent`, `nip44Encrypt`/`Decrypt`, `createHttpAuthToken` |
| **`LocalKeySigner`** | Port implementation holding a 32-byte key |
| **`PublicIdentityManifest`** | `{ pubkey, npub, accountPath?, profileId? }` — safe to log / persist |

### Secret boundary (mandatory)

| Allowed for normal callers | Escape hatches only (custody import / recovery) |
| --- | --- |
| `getPublicKey`, `npub`, `toPublicManifest` | `exportPrivateKeyBytes()` |
| `signEvent` | `exportNsec()` |
| `nip44Encrypt` / `nip44Decrypt` | |
| `createHttpAuthToken` | |

- **Do not log** mnemonic, nsec, private key hex, or seed bytes.
- Prefer platform Keychain (OpenAgents `local-secret-store`) over holding escape-hatch exports.
- Tests must use **fixture mnemonics** only (e.g. `zoo zoo … wrong`).
- `toJSON()` / `toString()` / Node `inspect` expose **public** data only.

## OpenAgents legacy path (#9092)

Historical Nostr identity:

- Path: `m/44'/1237'/0'/0/0` → `NIP06_ACCOUNT_PATH`
- BIP-39 passphrase: **empty string**
- Profile id: `openagents.legacy_unified_nostr_spark.v1` → `OPENAGENTS_LEGACY_IDENTITY_PROFILE`

```ts
const id = IdentityKeys.fromOpenAgentsLegacyMnemonic(mnemonicFromSecretStore)
// BOOT SEQUENCE / manifest:
const publicOnly = id.toPublicManifest()
// app crypto:
const signer: LocalSignerPort = id.asSigner()
```

Spark derivation (`m/44'/0'/0'/0/0`) is **not** in this package — keep it in the wallet adapter with a limited callback that clears buffers.

## Examples

### Sign a kind-1 note

```ts
const id = IdentityKeys.fromMnemonic(mnemonic) // empty passphrase default
const event = await id.asSigner().signEvent({
  kind: 1,
  content: "hello",
  tags: [],
})
```

### NIP-44 DM payload

```ts
const alice = IdentityKeys.fromMnemonic(aliceMnemonic)
const bob = IdentityKeys.fromMnemonic(bobMnemonic)
const ct = await alice.asSigner().nip44Encrypt(bob.publicKey, "hi")
const pt = await bob.asSigner().nip44Decrypt(alice.publicKey, ct)
```

### NIP-98 HTTP auth

```ts
const token = await id.asSigner().createHttpAuthToken(
  "https://relay.example/.well-known/nostr.json",
  "GET",
  { includeAuthorizationScheme: true }
)
// Authorization: Nostr <base64 event>
```

### Generate new identity (show mnemonic once)

```ts
const { mnemonic, identity } = IdentityKeys.generate() // 12 words
// or IdentityKeys.generate({ strength: 256 }) for 24 words
// Display mnemonic once for backup UI, then store in Keychain — never in logs/SQLite plaintext
```

### From existing private key bytes (already in custody)

```ts
import { LocalKeySigner } from "nostr-effect/identity"

const signer = LocalKeySigner.fromPrivateKey(keyBytesFromKeychain)
await signer.signEvent({ kind: 0, content: "{}", tags: [] })
signer.dispose() // zeroize when done
```

## Mapping to OpenAgents packages

| OpenAgents concern | Use from nostr-effect |
| --- | --- |
| Derive Nostr key from root mnemonic | `IdentityKeys.fromOpenAgentsLegacyMnemonic` / `fromMnemonic` |
| Public boot / receipt fields | `toPublicManifest()` |
| Sign / NIP-44 for apps | `asSigner(): LocalSignerPort` |
| NIP-98 to local services | `createHttpAuthToken` |
| Remote web signing later | `Nip46Service` (separate); local port stays the same shape |
| Secret storage | **Not here** — `packages/local-secret-store` |
| Spark wallet key | **Not here** — wallet package + path `m/44'/0'/0'/0/0` |

Suggested TypeScript port in `sovereign-identity`:

```ts
import type { LocalSignerPort } from "nostr-effect/identity"

export interface NostrSignerPort extends LocalSignerPort {}
// Implement by wrapping IdentityKeys.asSigner() after Keychain load
```

## Files

| Path | Role |
| --- | --- |
| `src/core/LocalSigner.ts` | `LocalSignerPort`, `LocalKeySigner` |
| `src/core/IdentityKeys.ts` | Mnemonic → identity |
| `src/wrappers/identity.ts` | Package export `nostr-effect/identity` |
| `src/wrappers/signer.ts` | `PlainKeySigner` + re-export `LocalKeySigner` |
| `src/core/*Keys*.test.ts`, `LocalSigner.test.ts` | Fixture-only tests |

## Safety checklist for implementers

- [ ] No `console.log(mnemonic|nsec|sk)`
- [ ] No secrets in `Error.message` or telemetry
- [ ] Unit tests use fixtures only
- [ ] Call `dispose()` when identity is unloaded if process stays long-lived
- [ ] Prefer `asSigner()` over `exportPrivateKeyBytes` / `exportNsec`
