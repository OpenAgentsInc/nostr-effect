import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import WebSocket from "ws";
import { afterEach, describe, expect, test } from "vite-plus/test";
import type { NostrEvent, RelayMessage } from "../../../core/Schema.js";
import {
  finalizeEvent,
  getPublicKey,
  verifyEvent,
  type Event as PureEvent,
} from "../../../wrappers/pure.js";
import { openNodeSqliteStore } from "./NodeSqliteStore.js";
import { createRelayNip29Host } from "./RelayNip29Host.js";
import { startRelayWithEventStore, type RelayHandle } from "./index.js";

const RELAY_PRIVATE_KEY = "1".repeat(64);
const WRITER_PRIVATE_KEY = Uint8Array.from({ length: 32 }, () => 2);
const SECOND_WRITER_PRIVATE_KEY = Uint8Array.from({ length: 32 }, () => 3);
const GROUP_ID = "public-chat";
const SUPPORTED_KINDS = [5, 7, 9, 1337, 1984];

const asNostrEvent = (event: ReturnType<typeof finalizeEvent>): NostrEvent =>
  event as unknown as NostrEvent;

interface BufferedSocket {
  readonly ws: WebSocket;
  readonly waitForMessage: (
    predicate: (message: RelayMessage) => boolean,
  ) => Promise<RelayMessage>;
}

const connect = (port: number): Promise<BufferedSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const queue: RelayMessage[] = [];
    const waiters: Array<{
      readonly predicate: (message: RelayMessage) => boolean;
      readonly resolve: (message: RelayMessage) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }> = [];
    ws.on("message", (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as RelayMessage;
      const index = waiters.findIndex((waiter) => waiter.predicate(message));
      if (index < 0) {
        queue.push(message);
        return;
      }
      const [waiter] = waiters.splice(index, 1);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
    const waitForMessage: BufferedSocket["waitForMessage"] = (predicate) => {
      const index = queue.findIndex(predicate);
      if (index >= 0) {
        const [message] = queue.splice(index, 1);
        return Promise.resolve(message as RelayMessage);
      }
      return new Promise((waiterResolve, waiterReject) => {
        const timer = setTimeout(
          () => waiterReject(new Error("timeout waiting for relay message")),
          3_000,
        );
        waiters.push({ predicate, resolve: waiterResolve, timer });
      });
    };
    ws.once("open", () => resolve({ ws, waitForMessage }));
    ws.once("error", reject);
  });

const authenticate = async (
  socket: BufferedSocket,
  port: number,
  privateKey: Uint8Array,
): Promise<RelayMessage> => {
  const challengeMessage = await socket.waitForMessage(
    (message) => message[0] === "AUTH",
  );
  const authEvent = asNostrEvent(
    finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", `ws://127.0.0.1:${port}`],
          ["challenge", String(challengeMessage[1])],
        ],
        content: "",
      },
      privateKey,
    ),
  );
  socket.ws.send(JSON.stringify(["AUTH", authEvent]));
  return socket.waitForMessage(
    (message) => message[0] === "OK" && message[1] === authEvent.id,
  );
};

const queryGroupState = (
  store: ReturnType<typeof openNodeSqliteStore>["store"],
  relayPubkey: string,
) =>
  Effect.runPromise(
    store.queryEvents([
      {
        authors: [relayPubkey],
        kinds: [39000, 39001, 39003, 39005],
        "#d": [GROUP_ID],
      } as never,
    ]),
  );

describe("RelayNip29Host", () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  test("persists signed seed state, accepts public kind 9, and survives restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nostr-effect-nip29-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "relay.sqlite");
    const firstStore = openNodeSqliteStore(path);
    cleanup.push(() => firstStore.close());

    const hostConfig = {
      relayPrivateKey: RELAY_PRIVATE_KEY,
      seedGroups: [
        {
          id: GROUP_ID,
          name: "Public Chat",
          about: "A public NIP-29 chat group.",
          isClosed: false,
          isRestricted: false,
          supportedKinds: SUPPORTED_KINDS,
        },
      ],
    } as const;
    const firstHost = await createRelayNip29Host(hostConfig, firstStore.store);
    cleanup.push(firstHost.dispose);

    const initialState = await queryGroupState(firstStore.store, firstHost.relayPubkey);
    expect(initialState).toHaveLength(4);
    expect(initialState.every((event) => verifyEvent(event as unknown as PureEvent))).toBe(true);
    expect(initialState.every((event) => event.pubkey === firstHost.relayPubkey)).toBe(true);
    const metadata = initialState.find((event) => event.kind === 39000);
    expect(metadata?.tags).toContainEqual(["supported_kinds", "5", "7", "9", "1337", "1984"]);

    const port = 33_000 + Math.floor(Math.random() * 5_000);
    const relay: RelayHandle = await startRelayWithEventStore(
      {
        port,
        modules: firstHost.modules,
        relayInfo: {
          self: firstHost.relayPubkey,
          supported_kinds: SUPPORTED_KINDS,
        },
        nip42: {
          relayUrls: [`ws://127.0.0.1:${port}`],
          authRequired: true,
        },
      },
      firstStore.store,
    );
    cleanup.push(() => Effect.runPromise(relay.stop()));

    const infoResponse = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { Accept: "application/nostr+json" },
    });
    const info = (await infoResponse.json()) as {
      self?: string;
      supported_nips?: number[];
      supported_kinds?: number[];
    };
    expect(info.self).toBe(firstHost.relayPubkey);
    expect(info.supported_nips).toContain(29);
    expect(info.supported_kinds).toEqual(SUPPORTED_KINDS);

    const socket = await connect(port);
    cleanup.push(() => socket.ws.terminate());
    const firstMessage = asNostrEvent(
      finalizeEvent(
        {
          kind: 9,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["h", GROUP_ID]],
          content: "hello from an external key",
        },
        WRITER_PRIVATE_KEY,
      ),
    );
    socket.ws.send(JSON.stringify(["EVENT", firstMessage]));
    const unauthenticated = await socket.waitForMessage(
      (message) => message[0] === "OK" && message[1] === firstMessage.id,
    );
    expect(unauthenticated[2]).toBe(false);
    expect(unauthenticated[3]).toContain("auth-required");

    const authOk = await authenticate(socket, port, WRITER_PRIVATE_KEY);
    expect(authOk[2]).toBe(true);

    socket.ws.send(JSON.stringify(["EVENT", firstMessage]));
    const firstOk = await socket.waitForMessage(
      (message) => message[0] === "OK" && message[1] === firstMessage.id,
    );
    expect(firstOk[2]).toBe(true);

    const contextualMessage = asNostrEvent(
      finalizeEvent(
        {
          kind: 9,
          created_at: firstMessage.created_at + 1,
          tags: [
            ["h", GROUP_ID],
            ["previous", firstMessage.id.slice(0, 8)],
          ],
          content: "context-bound reply",
        },
        SECOND_WRITER_PRIVATE_KEY,
      ),
    );
    const secondSocket = await connect(port);
    cleanup.push(() => secondSocket.ws.terminate());
    expect((await authenticate(secondSocket, port, SECOND_WRITER_PRIVATE_KEY))[2]).toBe(true);
    secondSocket.ws.send(JSON.stringify(["EVENT", contextualMessage]));
    const contextualOk = await secondSocket.waitForMessage(
      (message) => message[0] === "OK" && message[1] === contextualMessage.id,
    );
    expect(contextualOk[2]).toBe(true);

    const invalidPrevious = asNostrEvent(
      finalizeEvent(
        {
          kind: 9,
          created_at: firstMessage.created_at + 2,
          tags: [
            ["h", GROUP_ID],
            ["previous", "deadbeef"],
          ],
          content: "invalid context",
        },
        SECOND_WRITER_PRIVATE_KEY,
      ),
    );
    secondSocket.ws.send(JSON.stringify(["EVENT", invalidPrevious]));
    const invalidOk = await secondSocket.waitForMessage(
      (message) => message[0] === "OK" && message[1] === invalidPrevious.id,
    );
    expect(invalidOk[2]).toBe(false);

    const pinned = asNostrEvent(
      finalizeEvent(
        {
          kind: 9010,
          created_at: firstMessage.created_at + 3,
          tags: [
            ["h", GROUP_ID],
            ["e", firstMessage.id],
            ["previous", firstMessage.id.slice(0, 8)],
          ],
          content: "",
        },
        Uint8Array.from(Buffer.from(RELAY_PRIVATE_KEY, "hex")),
      ),
    );
    const relaySocket = await connect(port);
    cleanup.push(() => relaySocket.ws.terminate());
    expect(
      (
        await authenticate(
          relaySocket,
          port,
          Uint8Array.from(Buffer.from(RELAY_PRIVATE_KEY, "hex")),
        )
      )[2],
    ).toBe(true);
    relaySocket.ws.send(JSON.stringify(["EVENT", pinned]));
    const pinnedOk = await relaySocket.waitForMessage(
      (message) => message[0] === "OK" && message[1] === pinned.id,
    );
    expect(pinnedOk[2]).toBe(true);
    const stateAfterPin = await queryGroupState(firstStore.store, firstHost.relayPubkey);
    expect(stateAfterPin.find((event) => event.kind === 39005)?.tags).toContainEqual([
      "e",
      firstMessage.id,
    ]);

    const firstStateIds = new Set(stateAfterPin.map((event) => event.id));
    socket.ws.terminate();
    secondSocket.ws.terminate();
    relaySocket.ws.terminate();
    await Effect.runPromise(relay.stop());
    firstHost.dispose();
    firstStore.close();
    cleanup.splice(1);

    const secondStore = openNodeSqliteStore(path);
    cleanup.push(() => secondStore.close());
    const secondHost = await createRelayNip29Host(hostConfig, secondStore.store);
    cleanup.push(secondHost.dispose);
    expect(secondHost.relayPubkey).toBe(
      getPublicKey(Uint8Array.from(Buffer.from(RELAY_PRIVATE_KEY, "hex"))),
    );
    const restartedState = await queryGroupState(secondStore.store, secondHost.relayPubkey);
    expect(new Set(restartedState.map((event) => event.id))).toEqual(firstStateIds);
    expect(restartedState.find((event) => event.kind === 39005)?.tags).toContainEqual([
      "e",
      firstMessage.id,
    ]);
    const history = await Effect.runPromise(
      secondStore.store.queryEvents([{ kinds: [9], "#h": [GROUP_ID] } as never]),
    );
    expect(history.map((event) => event.id)).toContain(firstMessage.id);
    expect(history.map((event) => event.id)).toContain(contextualMessage.id);
  });
});
