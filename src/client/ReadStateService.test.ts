/**
 * Tests for ReadStateService (NIP-RS: Cross-Device Read State Sync)
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ReadStateService,
  ReadStateServiceLive,
  READ_STATE_KIND,
  READ_STATE_T_VALUE,
  READ_STATE_VERSION,
  MAX_CONTEXT_ENTRIES,
  MAX_CONTEXT_TIMESTAMP,
  buildDTag,
  parseSlotId,
  validateReadStateTags,
  validateBlob,
  mergeContexts,
  parseThreadContext,
  parseMsgContext,
  threadContextKey,
  msgContextKey,
  effective,
  monotonicCreatedAt,
  evictDominated,
  generateSlotId,
  generateClientId,
  selectOwnBlob,
  type ReadContexts,
  type ReadStateBlob,
} from "./ReadStateService.js";
import { RelayService, makeRelayService } from "./RelayService.js";
import { startTestRelay, type RelayHandle } from "../relay/backends/bun/index.js";
import { CryptoService, CryptoServiceLive } from "../services/CryptoService.js";
import { EventServiceLive } from "../services/EventService.js";
import { Nip44Service, Nip44ServiceLive } from "../services/Nip44Service.js";

// ---------------------------------------------------------------------------
// Pure helper tests (no relay)
// ---------------------------------------------------------------------------

describe("NIP-RS helpers", () => {
  test("generateSlotId / generateClientId are fresh 128-bit hex ids", () => {
    const a = generateSlotId();
    const b = generateSlotId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(generateClientId()).toMatch(/^[0-9a-f]{32}$/);
  });

  test("buildDTag / parseSlotId round-trip valid slot-ids", () => {
    expect(buildDTag("aaa111")).toBe("read-state:aaa111");
    expect(parseSlotId("read-state:aaa111")).toBe("aaa111");
    expect(buildDTag("1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d")).toBe(
      "read-state:1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"
    );
  });

  test("buildDTag rejects empty, non-ASCII, and overlong slot-ids", () => {
    expect(buildDTag("")).toBeNull();
    expect(buildDTag("café")).toBeNull(); // non-ASCII
    expect(buildDTag("a".repeat(65))).toBeNull();
    expect(buildDTag("a".repeat(64))).toBe("read-state:" + "a".repeat(64));
  });

  test("parseSlotId rejects missing prefix and invalid remainders", () => {
    expect(parseSlotId("other:foo")).toBeNull();
    expect(parseSlotId("read-state:")).toBeNull();
    expect(parseSlotId("read-state:hello world\n")).toBeNull();
  });

  test("validateReadStateTags requires exactly one d and one t=read-state", () => {
    expect(
      validateReadStateTags({
        tags: [
          ["d", "read-state:slot1"],
          ["t", "read-state"],
        ],
      })
    ).toBe("slot1");

    // zero d
    expect(validateReadStateTags({ tags: [["t", "read-state"]] })).toBeNull();
    // two d
    expect(
      validateReadStateTags({
        tags: [
          ["d", "read-state:a"],
          ["d", "read-state:b"],
          ["t", "read-state"],
        ],
      })
    ).toBeNull();
    // d without prefix
    expect(
      validateReadStateTags({
        tags: [
          ["d", "appdata"],
          ["t", "read-state"],
        ],
      })
    ).toBeNull();
    // missing t
    expect(
      validateReadStateTags({ tags: [["d", "read-state:slot1"]] })
    ).toBeNull();
    // two t=read-state
    expect(
      validateReadStateTags({
        tags: [
          ["d", "read-state:slot1"],
          ["t", "read-state"],
          ["t", "read-state"],
        ],
      })
    ).toBeNull();
  });

  test("validateBlob accepts a well-formed v1 blob (test vector shape)", () => {
    const plaintext = JSON.stringify({
      v: 1,
      client_id: "client-aabbccdd",
      contexts: {
        "group:general": 1700001000,
        "group:dev": 1700000500,
      },
    });
    const blob = validateBlob(plaintext);
    expect(blob).not.toBeNull();
    expect(blob?.v).toBe(READ_STATE_VERSION);
    expect(blob?.client_id).toBe("client-aabbccdd");
    expect(blob?.contexts["group:general"]).toBe(1700001000);
    expect(blob?.contexts["group:dev"]).toBe(1700000500);
  });

  test("validateBlob rejects missing/invalid top-level fields", () => {
    expect(validateBlob("not json")).toBeNull();
    expect(validateBlob(JSON.stringify(["a"]))).toBeNull();
    expect(validateBlob(JSON.stringify({ client_id: "x", contexts: {} }))).toBeNull(); // missing v
    expect(
      validateBlob(JSON.stringify({ v: "1", client_id: "x", contexts: {} }))
    ).toBeNull(); // non-integer v
    expect(
      validateBlob(JSON.stringify({ v: 2, client_id: "x", contexts: {} }))
    ).toBeNull(); // unknown version
    expect(
      validateBlob(JSON.stringify({ v: 1, contexts: {} }))
    ).toBeNull(); // missing client_id
    expect(
      validateBlob(JSON.stringify({ v: 1, client_id: "", contexts: {} }))
    ).toBeNull(); // empty client_id
    expect(
      validateBlob(
        JSON.stringify({ v: 1, client_id: "a".repeat(65), contexts: {} })
      )
    ).toBeNull(); // overlong client_id
    expect(
      validateBlob(JSON.stringify({ v: 1, client_id: "x", contexts: [] }))
    ).toBeNull(); // contexts not object
    expect(
      validateBlob(JSON.stringify({ v: 1, client_id: "x" }))
    ).toBeNull(); // missing contexts
  });

  test("validateBlob drops bad entries but keeps the rest", () => {
    const blob = validateBlob({
      v: 1,
      client_id: "ok",
      contexts: {
        good: 42,
        badString: "yesterday",
        badFloat: 1.5,
        badNeg: -1,
        badHuge: MAX_CONTEXT_TIMESTAMP + 1,
        ["x".repeat(257)]: 10, // overlong context id (byte length)
        edge: 0,
        max: MAX_CONTEXT_TIMESTAMP,
      },
    });
    expect(blob).not.toBeNull();
    expect(blob?.contexts).toEqual({ good: 42, edge: 0, max: MAX_CONTEXT_TIMESTAMP });
  });

  test("validateBlob rejects more than 10_000 context entries", () => {
    const contexts: Record<string, number> = {};
    for (let i = 0; i < MAX_CONTEXT_ENTRIES + 1; i++) {
      contexts[`c${i}`] = i;
    }
    expect(
      validateBlob({ v: 1, client_id: "x", contexts })
    ).toBeNull();
  });

  test("validateBlob ignores unknown top-level keys", () => {
    const blob = validateBlob({
      v: 1,
      client_id: "x",
      contexts: { a: 1 },
      extra: true,
    });
    expect(blob?.contexts).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// CvRDT merge laws (associative, commutative, idempotent)
// ---------------------------------------------------------------------------

describe("NIP-RS mergeContexts (max-register CvRDT)", () => {
  const A: ReadContexts = {
    "group:general": 1700001000,
    "group:dev": 1700000500,
  };
  const B: ReadContexts = {
    "group:general": 1700001200,
    "group:random": 1700000800,
  };
  const C: ReadContexts = {
    "group:dev": 1700000900,
    "group:random": 1700000700,
    "group:ops": 1700000600,
  };

  const expectedAB: ReadContexts = {
    "group:general": 1700001200,
    "group:dev": 1700000500,
    "group:random": 1700000800,
  };

  test("matches the NIP-RS test-vector merge of A and B", () => {
    expect(mergeContexts(A, B)).toEqual(expectedAB);
  });

  test("commutative: merge(A,B) == merge(B,A)", () => {
    expect(mergeContexts(A, B)).toEqual(mergeContexts(B, A));
  });

  test("associative: merge(merge(A,B),C) == merge(A,merge(B,C))", () => {
    const left = mergeContexts(mergeContexts(A, B), C);
    const right = mergeContexts(A, mergeContexts(B, C));
    expect(left).toEqual(right);
  });

  test("idempotent: merge(A,A) == A", () => {
    expect(mergeContexts(A, A)).toEqual(A);
  });

  test("identity: merge(A, {}) == A", () => {
    expect(mergeContexts(A, {})).toEqual(A);
  });

  test("grow-only: never lowers a timestamp", () => {
    const merged = mergeContexts(A, B, C);
    for (const [ctx, ts] of Object.entries(A)) {
      expect(merged[ctx]!).toBeGreaterThanOrEqual(ts);
    }
    for (const [ctx, ts] of Object.entries(B)) {
      expect(merged[ctx]!).toBeGreaterThanOrEqual(ts);
    }
    for (const [ctx, ts] of Object.entries(C)) {
      expect(merged[ctx]!).toBeGreaterThanOrEqual(ts);
    }
  });

  test("n-ary merge equals pairwise reduction", () => {
    const nary = mergeContexts(A, B, C);
    const pairwise = mergeContexts(mergeContexts(A, B), C);
    expect(nary).toEqual(pairwise);
  });
});

// ---------------------------------------------------------------------------
// Optional context schemes + hierarchical frontier
// ---------------------------------------------------------------------------

describe("NIP-RS read context schemes", () => {
  const root =
    "7b4f3c2a1e9d8c7061524334aabbccddeeff00112233445566778899aabbccdd";
  const msg =
    "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
  const channel = "channel-event-id-or-opaque";

  test("parseThreadContext / parseMsgContext accept well-formed keys", () => {
    expect(parseThreadContext(threadContextKey(root))).toBe(root);
    expect(parseMsgContext(msgContextKey(msg))).toBe(msg);
  });

  test("malformed thread:/msg: prefixes are treated as opaque (null)", () => {
    expect(parseThreadContext("thread:SHORT")).toBeNull();
    expect(parseThreadContext("thread:" + "A".repeat(64))).toBeNull(); // uppercase
    expect(parseMsgContext("msg:not-hex")).toBeNull();
    expect(parseThreadContext("channel:foo")).toBeNull();
  });

  test("effective(thread) = max(own, channel) — hierarchical frontier", () => {
    const merged: ReadContexts = {
      [threadContextKey(root)]: 100,
      [channel]: 150,
    };
    // Spec example: max(100, 150) = 150
    expect(effective(merged, threadContextKey(root), channel)).toBe(150);
    // Reply at 140 is covered by channel frontier 150
    expect(140 <= effective(merged, threadContextKey(root), channel)!).toBe(true);
    // Reply at 160 is still unread
    expect(160 > effective(merged, threadContextKey(root), channel)!).toBe(true);
  });

  test("effective(msg) uses channel parent, not thread", () => {
    const merged: ReadContexts = {
      [msgContextKey(msg)]: 90,
      [threadContextKey(root)]: 200,
      [channel]: 50,
    };
    // Parent is channel, not thread → max(90, 50) = 90
    expect(effective(merged, msgContextKey(msg), channel)).toBe(90);
  });

  test("effective without parent degrades to own value", () => {
    const merged: ReadContexts = { a: 10 };
    expect(effective(merged, "a")).toBe(10);
    expect(effective(merged, "missing")).toBeUndefined();
  });

  test("evictDominated drops entries covered by parent frontier", () => {
    const merged: ReadContexts = {
      [threadContextKey(root)]: 100,
      [channel]: 150,
      other: 20,
    };
    const pruned = evictDominated(merged, (id) =>
      parseThreadContext(id) ? channel : null
    );
    expect(pruned[threadContextKey(root)]).toBeUndefined();
    expect(pruned[channel]).toBe(150);
    expect(pruned["other"]).toBe(20);
  });
});

describe("NIP-RS clock skew helper", () => {
  test("monotonicCreatedAt advances past max fetched", () => {
    // Spec clock-skew vector: local 1700001200, max fetched 1700001500 → 1700001501
    expect(monotonicCreatedAt(1700001200, 1700001500)).toBe(1700001501);
    expect(monotonicCreatedAt(1700001600, 1700001500)).toBe(1700001600);
    expect(monotonicCreatedAt(100, undefined)).toBe(100);
    expect(monotonicCreatedAt(5, 5)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Encrypt/decrypt round-trip (no relay) + ciphertext test vector
// ---------------------------------------------------------------------------

describe("NIP-RS encrypt-to-self", () => {
  const layers = Layer.merge(CryptoServiceLive, Nip44ServiceLive);

  test("encrypt → decrypt round-trip recovers plaintext blob", async () => {
    const program = Effect.gen(function* () {
      const crypto = yield* CryptoService;
      const nip44 = yield* Nip44Service;

      const sk = yield* crypto.generatePrivateKey();
      const pk = yield* crypto.getPublicKey(sk);
      // conversation key = nip44(user_priv, user_pub) — encrypt-to-self
      const ck = yield* nip44.getConversationKey(sk, pk);

      const blob: ReadStateBlob = {
        v: 1,
        client_id: "test-vector-client",
        contexts: {
          "group:general": 1700001000,
          "group:dev": 1700000500,
        },
      };
      const plaintext = JSON.stringify(blob);
      const cipher = yield* nip44.encrypt(plaintext, ck);
      expect(cipher.startsWith("{")).toBe(false);

      const recovered = yield* nip44.decrypt(cipher, ck);
      expect(validateBlob(recovered)).toEqual(blob);
    });
    await Effect.runPromise(program.pipe(Effect.provide(layers)));
  });

  test("spec ciphertext test vector decrypts with scalar-1 key", async () => {
    // private_key = 1; public_key = 79be667e... (secp256k1 G.x)
    const program = Effect.gen(function* () {
      const nip44 = yield* Nip44Service;
      const sk =
        "0000000000000000000000000000000000000000000000000000000000000001" as const;
      const pk =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" as const;
      const ck = yield* nip44.getConversationKey(sk as never, pk as never);

      const ciphertext =
        "Akt10yui5aDIjfH+xED2Dr1NJ/SGWp85SC/r/bloiLRtj8K59rJrYhcfsNQMoMhpLlvhKqrN0HIGb9/V9BcYKxWV8HT/jjDdvfHLUVfo688I6WpapcX41GzL4VnGGDdFyUom53odJncjHszS3dpTrG1OKp2x9dtdG+924/+Ne49KN4nztd1pikqYeqQuxflKCmh+VcCFbDclQ8a9NUpqWkPpeoweISVVuZDnP9WFoKG5X6YcpXBWH6wjc69xK4cs6KkJ";

      const plaintext = yield* nip44.decrypt(ciphertext as never, ck);
      const blob = validateBlob(plaintext);
      expect(blob).toEqual({
        v: 1,
        client_id: "test-vector-client",
        contexts: {
          "group:general": 1700001000,
          "group:dev": 1700000500,
        },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(layers)));
  });
});

// ---------------------------------------------------------------------------
// Local relay round-trip
// ---------------------------------------------------------------------------

describe("ReadStateService (NIP-RS)", () => {
  let relay: RelayHandle;
  let port: number;

  beforeAll(async () => {
    port = 28600 + Math.floor(Math.random() * 10000);
    relay = await startTestRelay(port);
  });

  afterAll(async () => {
    await Effect.runPromise(relay.stop());
  });

  const makeTestLayers = () => {
    const RelayLayer = makeRelayService({
      url: `ws://localhost:${port}`,
      reconnect: false,
    });
    const ServiceLayer = Layer.mergeAll(
      CryptoServiceLive,
      EventServiceLive.pipe(Layer.provide(CryptoServiceLive)),
      Nip44ServiceLive
    );
    return Layer.merge(
      RelayLayer,
      Layer.merge(
        ServiceLayer,
        ReadStateServiceLive.pipe(
          Layer.provide(RelayLayer),
          Layer.provide(ServiceLayer)
        )
      )
    );
  };

  test("publish → fetch round-trip self-decrypts and merges", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService;
      const svc = yield* ReadStateService;
      const crypto = yield* CryptoService;
      yield* relayService.connect();

      const sk = yield* crypto.generatePrivateKey();
      const author = yield* crypto.getPublicKey(sk);

      const slotId = generateSlotId();
      const clientId = "desktop-v2-prod";
      const contexts: ReadContexts = {
        "ctx:AAA": 1700000100,
        "ctx:BBB": 1700000050,
      };

      const { result, d, contexts: published } = yield* svc.publishReadState(
        { slotId, clientId, contexts, createdAt: 1700000100 },
        sk
      );
      expect(result.accepted).toBe(true);
      expect(d).toBe(`read-state:${slotId}`);
      expect(published).toEqual(contexts);

      // Second device publishes a different slot with overlapping contexts.
      const slotB = generateSlotId();
      const clientB = "mobile-ios-v1";
      yield* svc.publishReadState(
        {
          slotId: slotB,
          clientId: clientB,
          contexts: {
            "ctx:AAA": 1700000200,
            "ctx:CCC": 1700000080,
          },
          createdAt: 1700000200,
        },
        sk
      );

      const fetched = yield* svc.fetchReadState({
        author,
        authorPrivateKey: sk,
        clientId,
        since: 0,
        timeoutMs: 1500,
      });

      expect(fetched.blobs.length).toBeGreaterThanOrEqual(2);
      expect(fetched.own?.content?.client_id).toBe(clientId);
      expect(fetched.own?.d).toBe(d);

      // Spec example merged effective state
      expect(fetched.merged).toEqual({
        "ctx:AAA": 1700000200,
        "ctx:BBB": 1700000050,
        "ctx:CCC": 1700000080,
      });

      // Outer event is ciphertext, not plaintext JSON.
      const ownEvent = fetched.own!.event;
      expect(ownEvent.kind as number).toBe(READ_STATE_KIND);
      expect(ownEvent.content.startsWith("{")).toBe(false);
      expect(ownEvent.tags.some((t) => t[0] === "t" && t[1] === READ_STATE_T_VALUE)).toBe(
        true
      );

      // decryptReadState recovers the blob.
      const decrypted = yield* svc.decryptReadState({
        event: ownEvent,
        authorPrivateKey: sk,
      });
      expect(decrypted?.client_id).toBe(clientId);
      expect(decrypted?.contexts["ctx:AAA"]).toBe(1700000100);

      // A different key must NOT decrypt (encrypt-to-self).
      const otherSk = yield* crypto.generatePrivateKey();
      const other = yield* svc.decryptReadState({
        event: ownEvent,
        authorPrivateKey: otherSk,
      });
      expect(other).toBeNull();

      yield* relayService.disconnect();
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())));
  });

  test("read-before-write merges prior own contexts and is monotonic", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService;
      const svc = yield* ReadStateService;
      const crypto = yield* CryptoService;
      yield* relayService.connect();

      const sk = yield* crypto.generatePrivateKey();
      const author = yield* crypto.getPublicKey(sk);
      const slotId = generateSlotId();
      const clientId = generateClientId();

      yield* svc.publishReadState(
        {
          slotId,
          clientId,
          contexts: { a: 10, b: 5 },
          createdAt: 1000,
        },
        sk
      );

      // Advance only `a`; `b` must survive via read-before-write max-merge.
      // createdAt deliberately behind the previous event → monotonic bump.
      const second = yield* svc.publishReadState(
        {
          slotId,
          clientId,
          contexts: { a: 20 },
          createdAt: 999, // behind previous → must become 1001
          timeoutMs: 1500,
        },
        sk
      );
      expect(second.contexts).toEqual({ a: 20, b: 5 });

      const fetched = yield* svc.fetchReadState({
        author,
        authorPrivateKey: sk,
        clientId,
        since: 0,
        timeoutMs: 1500,
      });
      expect(fetched.own?.event.created_at).toBeGreaterThanOrEqual(1001);
      expect(fetched.merged).toEqual({ a: 20, b: 5 });

      yield* relayService.disconnect();
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())));
  });

  test("slot-id conflict refuses to publish", async () => {
    const program = Effect.gen(function* () {
      const relayService = yield* RelayService;
      const svc = yield* ReadStateService;
      const crypto = yield* CryptoService;
      yield* relayService.connect();

      const sk = yield* crypto.generatePrivateKey();
      const slotId = "aaa111";

      // Device B claims the coordinate first.
      yield* svc.publishReadState(
        {
          slotId,
          clientId: "client-B",
          contexts: { x: 1 },
          createdAt: 2000,
        },
        sk
      );

      // Device A tries the same slot with a different client_id → conflict.
      const err = yield* svc
        .publishReadState(
          {
            slotId,
            clientId: "client-A",
            contexts: { y: 2 },
            createdAt: 2001,
            timeoutMs: 1500,
          },
          sk
        )
        .pipe(Effect.flip);
      expect(String(err.message)).toMatch(/slot-id conflict/i);

      yield* relayService.disconnect();
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayers())));
  });

  test("selectOwnBlob picks highest created_at for matching client_id", () => {
    const makeDecoded = (
      clientId: string,
      createdAt: number,
      id: string
    ) =>
      ({
        event: { created_at: createdAt, id },
        d: "read-state:s",
        slotId: "s",
        content: {
          v: 1 as const,
          client_id: clientId,
          contexts: {},
        },
      }) as never;
    const blobs = [
      makeDecoded("A", 10, "bbb"),
      makeDecoded("A", 20, "aaa"),
      makeDecoded("B", 30, "ccc"),
    ];
    const own = selectOwnBlob(blobs, "A");
    expect(Number(own?.event.created_at)).toBe(20);
    expect(selectOwnBlob(blobs, "Z")).toBeNull();
  });
});
