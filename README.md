# nostr-effect

A type-safe, composable Nostr library built with [Effect](https://effect.website/).

## Why Effect?

- **Typed errors** - No `catch (e: unknown)`
- **Resource safety** - WebSocket connections and subscriptions automatically cleaned up
- **Composability** - Services and layers that mix and match
- **Cross-runtime** - Works on Node, Bun, Deno, and browsers

## Roadmap

Implementing NIPs across phases: encoding/identity (NIP-19, NIP-05, NIP-06), encryption (NIP-44, NIP-17), social features (profiles, reactions, follows, threading, chat), payments (zaps, wallet connect), and AI/agent support (DVMs, app handlers).
