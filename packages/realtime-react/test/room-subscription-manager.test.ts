import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/realtime", () => ({
  fetchRealtimeMeta: vi.fn().mockResolvedValue({
    serverVersion: "2026.04.19",
    ingestProtocols: {
      presence: ["presence.v2"],
      web: ["web.v1"],
    },
    streamProtocols: ["realtime.ws.v2"],
    capabilities: {
      presence: true,
      multiRoom: true,
      chat: true,
      richMedia: true,
      interaction: true,
    },
    interactionProtocols: [],
    supportedInteractionCommands: [],
  }),
}));

import { RoomSubscriptionManager } from "../src/room-subscription-manager";
import type { PulseRealtimeConfig } from "../src/types";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly listeners = new Map<string, Set<(event?: any) => void>>();
  readonly sent: string[] = [];
  readyState = MockWebSocket.CONNECTING;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event?: any) => void) {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  emit(type: string, event?: any) {
    if (type === "open") {
      this.readyState = MockWebSocket.OPEN;
    }
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

const config: PulseRealtimeConfig = {
  baseUrl: "https://pulse.example.com",
  workspaceId: "pulse-demo",
  siteId: "status-site",
};

describe("RoomSubscriptionManager", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        setTimeout,
        clearTimeout,
        location: { origin: "https://pulse.example.com" },
        __PULSE_REALTIME_DEBUG__: false,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: originalWebSocket,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  });

  it("opens one websocket per unique room and reuses the same room transport", async () => {
    const manager = new RoomSubscriptionManager(config);

    await manager.subscribePresence(
      { capability: "presence", scope: "site", subject: "global" },
      () => {},
    );
    await manager.subscribePresence(
      { capability: "presence", scope: "site", subject: "global" },
      () => {},
    );
    await manager.subscribePresence(
      {
        capability: "presence",
        scope: "page",
        canonicalUrl: "https://example.com/article",
      },
      () => {},
    );
    await manager.subscribeChatRoom(
      "chat:general",
      { displayName: "KT", userId: "user-1" },
      () => {},
    );

    expect(MockWebSocket.instances).toHaveLength(3);
    expect(MockWebSocket.instances.map((socket) => socket.url)).toEqual([
      "wss://pulse.example.com/api/v1/realtime/ws?workspaceId=pulse-demo&roomId=global",
      "wss://pulse.example.com/api/v1/realtime/ws?workspaceId=pulse-demo&roomId=page%3Ahttps%3A%2F%2Fexample.com%2Farticle",
      "wss://pulse.example.com/api/v1/realtime/ws?workspaceId=pulse-demo&roomId=chat%3Ageneral",
    ]);
  });

  it("bootstraps chat and presence transports on hello and reconnect per room", async () => {
    const manager = new RoomSubscriptionManager(config);

    manager.setPresenceContext({
      sessionId: "session-1",
      tabId: "tab-1",
      page: {
        title: "Article",
        url: "https://example.com/article",
      },
    });

    await manager.subscribePresence(
      { capability: "presence", scope: "site", subject: "global" },
      () => {},
    );
    await manager.subscribePresence(
      {
        capability: "presence",
        scope: "page",
        canonicalUrl: "https://example.com/article",
      },
      () => {},
    );
    await manager.subscribeChatRoom(
      "chat:general",
      { displayName: "KT", userId: "user-1" },
      () => {},
    );

    const [globalSocket, pageSocket, chatSocket] = MockWebSocket.instances;
    for (const socket of [globalSocket, pageSocket, chatSocket]) {
      socket!.emit("open");
      socket!.emit("message", {
        data: JSON.stringify({
          protocol: "realtime.ws.v2",
          type: "hello_ack",
          selectedProtocol: "realtime.ws.v2",
          capabilities: {
            presence: true,
            multiRoom: true,
            chat: true,
            richMedia: true,
            interaction: true,
          },
        }),
      });
    }

    expect(globalSocket!.sent.map((payload) => JSON.parse(payload))).toContainEqual(
      expect.objectContaining({
        type: "presence_context",
      }),
    );
    expect(pageSocket!.sent.map((payload) => JSON.parse(payload))).toContainEqual(
      expect.objectContaining({
        type: "presence_context",
      }),
    );
    expect(chatSocket!.sent.map((payload) => JSON.parse(payload))).toContainEqual(
      expect.objectContaining({
        type: "chat_join",
        roomId: "chat:general",
      }),
    );

    pageSocket!.emit("close");
    vi.advanceTimersByTime(1000);
    const reconnectedPageSocket = MockWebSocket.instances[3]!;
    reconnectedPageSocket.emit("open");
    reconnectedPageSocket.emit("message", {
      data: JSON.stringify({
        protocol: "realtime.ws.v2",
        type: "hello_ack",
        selectedProtocol: "realtime.ws.v2",
        capabilities: {
          presence: true,
          multiRoom: true,
          chat: true,
          richMedia: true,
          interaction: true,
        },
      }),
    });

    expect(
      reconnectedPageSocket.sent.map((payload) => JSON.parse(payload)),
    ).toContainEqual(expect.objectContaining({ type: "presence_context" }));
  });

  it("disconnects only the room transport whose last subscriber leaves", async () => {
    const manager = new RoomSubscriptionManager(config);

    const stopGlobal = await manager.subscribePresence(
      { capability: "presence", scope: "site", subject: "global" },
      () => {},
    );
    const stopPage = await manager.subscribePresence(
      {
        capability: "presence",
        scope: "page",
        canonicalUrl: "https://example.com/article",
      },
      () => {},
    );

    const [globalSocket, pageSocket] = MockWebSocket.instances;
    globalSocket!.emit("open");
    globalSocket!.emit("message", {
      data: JSON.stringify({
        protocol: "realtime.ws.v2",
        type: "hello_ack",
        selectedProtocol: "realtime.ws.v2",
        capabilities: {
          presence: true,
          multiRoom: true,
          chat: true,
          richMedia: true,
          interaction: true,
        },
      }),
    });
    pageSocket!.emit("open");
    pageSocket!.emit("message", {
      data: JSON.stringify({
        protocol: "realtime.ws.v2",
        type: "hello_ack",
        selectedProtocol: "realtime.ws.v2",
        capabilities: {
          presence: true,
          multiRoom: true,
          chat: true,
          richMedia: true,
          interaction: true,
        },
      }),
    });

    stopPage();
    expect(pageSocket!.readyState).toBe(MockWebSocket.CLOSED);
    expect(globalSocket!.readyState).toBe(MockWebSocket.OPEN);

    stopGlobal();
    expect(globalSocket!.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("exposes aggregate and per-room transport debug state", async () => {
    const manager = new RoomSubscriptionManager(config);
    const debugStates: ReturnType<typeof manager["onDebugState"]>[] = [];
    let latest: ReturnType<typeof manager["onDebugState"]> | undefined;

    const unsubscribeDebug = manager.onDebugState((state) => {
      latest = state;
      debugStates.push(() => {});
    });
    await manager.subscribePresence(
      { capability: "presence", scope: "site", subject: "global" },
      () => {},
    );

    const socket = MockWebSocket.instances[0]!;
    socket.emit("open");
    socket.emit("message", {
      data: JSON.stringify({
        protocol: "realtime.ws.v2",
        type: "hello_ack",
        selectedProtocol: "realtime.ws.v2",
        capabilities: {
          presence: true,
          multiRoom: true,
          chat: true,
          richMedia: true,
          interaction: true,
        },
      }),
    });

    expect(latest?.transport.status).toBe("ready");
    expect(latest?.transports).toEqual([
      expect.objectContaining({
        roomId: "global",
        status: "ready",
      }),
    ]);

    unsubscribeDebug();
    manager.dispose();
  });

  it("sends chat_leave before disposing chat transports", async () => {
    const manager = new RoomSubscriptionManager(config);

    await manager.subscribeChatRoom(
      "chat:general",
      { displayName: "KT", userId: "user-1" },
      () => {},
    );

    const chatSocket = MockWebSocket.instances[0]!;
    chatSocket.emit("open");
    chatSocket.emit("message", {
      data: JSON.stringify({
        protocol: "realtime.ws.v2",
        type: "hello_ack",
        selectedProtocol: "realtime.ws.v2",
        capabilities: {
          presence: true,
          multiRoom: true,
          chat: true,
          richMedia: true,
          interaction: true,
        },
      }),
    });

    manager.dispose();

    const sentMessages = chatSocket.sent.map((payload) => JSON.parse(payload));
    expect(sentMessages).toContainEqual(
      expect.objectContaining({
        type: "chat_leave",
        roomId: "chat:general",
      }),
    );
    expect(chatSocket.readyState).toBe(MockWebSocket.CLOSED);
  });
});
