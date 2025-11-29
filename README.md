# nostr-effect

Nostr relay & client library built with [Effect](https://effect.website/).

Building both sides of the protocol in tandem - using each to test the other.

## Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - Technical overview, Effect patterns, backend abstraction
- **[BUILDOUT.md](docs/BUILDOUT.md)** - Development roadmap and parallel build plan
- **[CLOUDFLARE.md](docs/CLOUDFLARE.md)** - Cloudflare Workers + Durable Objects deployment guide

## Supported NIPs

| NIP | Description | Scope |
|-----|-------------|-------|
| [01](https://github.com/nostr-protocol/nips/blob/master/01.md) | Basic protocol flow | Both |
| [02](https://github.com/nostr-protocol/nips/blob/master/02.md) | Follow list | Client |
| [04](https://github.com/nostr-protocol/nips/blob/master/04.md) | Legacy encrypted DMs | Core |
| [05](https://github.com/nostr-protocol/nips/blob/master/05.md) | DNS-based identifiers | Client |
| [06](https://github.com/nostr-protocol/nips/blob/master/06.md) | Key derivation from mnemonic | Core |
| [10](https://github.com/nostr-protocol/nips/blob/master/10.md) | Reply threading | Client |
| [11](https://github.com/nostr-protocol/nips/blob/master/11.md) | Relay information | Both |
| [13](https://github.com/nostr-protocol/nips/blob/master/13.md) | Proof of Work | Core |
| [16](https://github.com/nostr-protocol/nips/blob/master/16.md) | Event treatment | Relay |
| [17](https://github.com/nostr-protocol/nips/blob/master/17.md) | Private direct messages | Core |
| [18](https://github.com/nostr-protocol/nips/blob/master/18.md) | Reposts | Client |
| [19](https://github.com/nostr-protocol/nips/blob/master/19.md) | bech32 encoding | Core |
| [21](https://github.com/nostr-protocol/nips/blob/master/21.md) | nostr: URI scheme | Core |
| [25](https://github.com/nostr-protocol/nips/blob/master/25.md) | Reactions | Client |
| [27](https://github.com/nostr-protocol/nips/blob/master/27.md) | Content parsing | Core |
| [28](https://github.com/nostr-protocol/nips/blob/master/28.md) | Public chat | Client |
| [30](https://github.com/nostr-protocol/nips/blob/master/30.md) | Custom emoji | Core |
| [33](https://github.com/nostr-protocol/nips/blob/master/33.md) | Parameterized replaceable events | Relay |
| [34](https://github.com/nostr-protocol/nips/blob/master/34.md) | Git collaboration | Core |
| [39](https://github.com/nostr-protocol/nips/blob/master/39.md) | External identities | Client |
| [40](https://github.com/nostr-protocol/nips/blob/master/40.md) | Expiration timestamp | Core |
| [42](https://github.com/nostr-protocol/nips/blob/master/42.md) | Client authentication | Core |
| [44](https://github.com/nostr-protocol/nips/blob/master/44.md) | Versioned encryption | Core |
| [47](https://github.com/nostr-protocol/nips/blob/master/47.md) | Nostr Wallet Connect | Core |
| [49](https://github.com/nostr-protocol/nips/blob/master/49.md) | Encrypted private keys | Core |
| [54](https://github.com/nostr-protocol/nips/blob/master/54.md) | Wiki | Core |
| [57](https://github.com/nostr-protocol/nips/blob/master/57.md) | Lightning zaps | Client |
| [58](https://github.com/nostr-protocol/nips/blob/master/58.md) | Badges | Client |
| [59](https://github.com/nostr-protocol/nips/blob/master/59.md) | Gift wrap | Core |
| [65](https://github.com/nostr-protocol/nips/blob/master/65.md) | Relay list metadata | Client |
| [75](https://github.com/nostr-protocol/nips/blob/master/75.md) | Zap goals | Core |
| [89](https://github.com/nostr-protocol/nips/blob/master/89.md) | Application handlers | Client |
| [90](https://github.com/nostr-protocol/nips/blob/master/90.md) | Data vending machines | Client |
| [94](https://github.com/nostr-protocol/nips/blob/master/94.md) | File metadata | Core |
| [98](https://github.com/nostr-protocol/nips/blob/master/98.md) | HTTP auth | Core |
| [99](https://github.com/nostr-protocol/nips/blob/master/99.md) | Classified listings | Core |

**Scope**: *Core* = shared utilities, *Relay* = relay implementation, *Client* = client library

## Quick Start

```bash
# Install dependencies
bun install

# Run tests
bun test

# Start relay
bun run src/relay/main.ts
```

## Architecture

Built with Effect TypeScript for type-safe, composable services:

- **Branded types** for compile-time safety (EventId, PublicKey, etc.)
- **Effect services** with Layer-based dependency injection
- **@noble libraries** for audited cryptography
- **Bun runtime** for native TypeScript, SQLite, WebSocket

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details.
