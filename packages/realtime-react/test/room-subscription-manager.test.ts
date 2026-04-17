import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/realtime", () => ({
  fetchRealtimeMeta: vi.fn().mockResolvedValue({
    serverVersion: "2026.04.17",
    ingestProtocols: {
      presence: ["presence.v2"],
      web: ["web.v1"],
    },
    streamProtocols: ["realtime.ws.v1"],
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

  it("joins chat rooms after websocket hello and resubscribes on reconnect", async () => {
    const manager = new RoomSubscriptionManager(config);

    await manager.subscribeChatRoom(
      "chat:general",
      { displayName: "KT", userId: "user-1" },
      () => {},
    );

    const socket = MockWebSocket.instances[0]!;
    socket.emit("open");
    socket.emit("message", {
      data: JSON.stringify({
        protocol: "realtime.ws.v1",
        type: "hello_ack",
        selectedProtocol: "realtime.ws.v1",
        capabilities: {
          presence: true,
          multiRoom: true,
          chat: true,
          richMedia: true,
          interaction: true,
        },
      }),
    });

    const sentMessages = socket.sent.map((payload) => JSON.parse(payload));
    expect(sentMessages.some((message) => message.type === "subscribe")).toBe(true);
    expect(
      sentMessages.some(
        (message) =>
          message.type === "chat_join" &&
          message.roomId === "chat:general" &&
          message.displayName === "KT",
      ),
    ).toBe(true);

    socket.emit("close");
    vi.advanceTimersByTime(1000);
    const nextSocket = MockWebSocket.instances[1]!;
    nextSocket.emit("open");
    nextSocket.emit("message", {
      data: JSON.stringify({
        protocol: "realtime.ws.v1",
        type: "hello_ack",
        selectedProtocol: "realtime.ws.v1",
        capabilities: {
          presence: true,
          multiRoom: true,
          chat: true,
          richMedia: true,
          interaction: true,
        },
      }),
    });

    const resentMessages = nextSocket.sent.map((payload) => JSON.parse(payload));
    expect(resentMessages.some((message) => message.type === "subscribe")).toBe(true);
    expect(resentMessages.some((message) => message.type === "chat_join")).toBe(true);
  });
});
