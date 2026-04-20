import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeTransport } from "../src/realtime-transport";
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

describe("RealtimeTransport", () => {
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

  it("sends hello and becomes ready after hello_ack", () => {
    const transport = new RealtimeTransport(config, "global");
    const ready = vi.fn();
    transport.onReady(ready);

    transport.connect();
    const socket = MockWebSocket.instances[0]!;
    expect(socket.url).toBe(
      "wss://pulse.example.com/api/v1/realtime/ws?workspaceId=pulse-demo&roomId=global",
    );

    socket.emit("open");
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: "hello",
      supportedProtocols: ["realtime.ws.v2"],
    });

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

    expect(transport.isReady).toBe(true);
    expect(transport.snapshot.status).toBe("ready");
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("reconnects after an unexpected close", () => {
    const transport = new RealtimeTransport(config, "page:https://example.com/a");

    transport.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.emit("open");
    socket.emit("close");

    expect(transport.snapshot.status).toBe("reconnecting");
    vi.advanceTimersByTime(1000);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1]?.url).toContain(
      "roomId=page%3Ahttps%3A%2F%2Fexample.com%2Fa",
    );
  });
});
