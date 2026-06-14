import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_COMMON_WS_PROTOCOL,
  CLIENT_MEDIA_WS_PROTOCOL,
  CLIENT_PAGE_WS_PROTOCOL,
} from "@ktfun/pulse-protocol";
import { PulseRealtimeV2Client } from "./client";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly sent: string[] = [];
  binaryType: BinaryType = "blob";
  readyState = MockWebSocket.CONNECTING;
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor(readonly url: string) {
    sockets.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string | ArrayBuffer) {
    this.sent.push(typeof message === "string" ? message : "[binary]");
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", {});
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }

  receive(frame: unknown) {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  failClosed() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", {});
  }

  private emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: MockWebSocket[] = [];

describe("PulseRealtimeV2Client unified connection", () => {
  beforeEach(() => {
    sockets.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        protocol: CLIENT_COMMON_WS_PROTOCOL,
        sessionId: "session-1",
      }),
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connect() opens common first and opens media only after common hello_ack", async () => {
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    const connecting = client.connect();
    await flushPromises();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe("wss://pulse.test/api/v1/client/ws");

    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toMatchObject({
      protocol: CLIENT_COMMON_WS_PROTOCOL,
      type: "hello",
      sessionId: "session-1",
    });
    expect(sockets).toHaveLength(1);

    acceptCommon(sockets[0]!);
    await flushPromises();

    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.url).toBe("wss://pulse.test/api/v1/client/media/ws");
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({
      protocol: CLIENT_MEDIA_WS_PROTOCOL,
      type: "hello",
      sessionId: "session-1",
      tabId: "ssr-tab",
    });
    let resolved = false;
    connecting.then(() => {
      resolved = true;
    });
    await flushPromises();
    expect(resolved).toBe(false);
    acceptMedia(sockets[1]!);
    await connecting;
    expect(resolved).toBe(true);
  });

  it("connect() is idempotent while a connection is in progress", async () => {
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    const first = client.connect();
    const second = client.connect();
    await flushPromises();

    expect(first).toBe(second);
    expect(sockets).toHaveLength(1);

    sockets[0]!.open();
    acceptCommon(sockets[0]!);
    await flushPromises();
    sockets[1]!.open();
    acceptMedia(sockets[1]!);
    await first;

    expect(sockets).toHaveLength(2);
  });

  it("stops retrying common after six failed attempts and never opens media", async () => {
    vi.useFakeTimers();
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    void client.connect().catch(() => undefined);
    await flushPromises();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      sockets[attempt]!.failClosed();
      await vi.advanceTimersByTimeAsync(delayForAttempt(attempt));
      await flushPromises();
    }

    expect(sockets).toHaveLength(7);
    sockets[6]!.failClosed();
    await flushPromises();
    expect(client.getSnapshot().common.connection).toMatchObject({
      status: "failed",
      error: "common_ws_reconnect_exhausted",
      connected: false,
    });
    expect(client.getSnapshot().media.connection.status).toBe("idle");
  });

  it("stops retrying media after six failed attempts while common stays connected", async () => {
    vi.useFakeTimers();
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    void connectFully(client);
    await flushPromises();
    sockets[0]!.open();
    acceptCommon(sockets[0]!);
    await flushPromises();
    sockets[1]!.open();
    acceptMedia(sockets[1]!);
    await flushPromises();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      sockets[attempt + 1]!.failClosed();
      await vi.advanceTimersByTimeAsync(delayForAttempt(attempt));
      await flushPromises();
    }

    expect(sockets).toHaveLength(8);
    sockets[7]!.failClosed();
    await flushPromises();
    expect(client.getSnapshot().common.connection.status).toBe("connected");
    expect(client.getSnapshot().media.connection).toMatchObject({
      status: "failed",
      error: "media_ws_reconnect_exhausted",
      connected: false,
    });
  });

  it("dispose() cancels pending reconnects", async () => {
    vi.useFakeTimers();
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    void connectFully(client);
    await flushPromises();
    sockets[0]!.open();
    acceptCommon(sockets[0]!);
    await flushPromises();
    sockets[1]!.open();
    acceptMedia(sockets[1]!);
    await flushPromises();

    sockets[1]!.failClosed();
    client.dispose();
    await vi.advanceTimersByTimeAsync(500);

    expect(sockets).toHaveLength(2);
  });

  it("connectPage() establishes common before opening page ws", async () => {
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    const connectingPage = client.connectPage("https://example.com/a", {
      title: "A",
      url: "https://example.com/a",
    });
    await flushPromises();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe("wss://pulse.test/api/v1/client/ws");
    sockets[0]!.open();
    acceptCommon(sockets[0]!);
    await connectingPage;

    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.url).toBe(
      "wss://pulse.test/api/v1/client/page/ws?canonicalUrl=https%3A%2F%2Fexample.com%2Fa",
    );
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({
      protocol: CLIENT_PAGE_WS_PROTOCOL,
      type: "hello",
      sessionId: "session-1",
      tabId: "ssr-tab",
      page: { title: "A", url: "https://example.com/a" },
    });
  });
});

async function connectFully(client: PulseRealtimeV2Client) {
  const connecting = client.connect();
  await flushPromises();
  sockets[0]!.open();
  acceptCommon(sockets[0]!);
  await flushPromises();
  sockets[1]!.open();
  acceptMedia(sockets[1]!);
  await connecting;
}

function acceptCommon(socket: MockWebSocket) {
  socket.receive({
    protocol: CLIENT_COMMON_WS_PROTOCOL,
    type: "hello_ack",
    selectedProtocol: CLIENT_COMMON_WS_PROTOCOL,
    connectionId: "common-1",
    session: { sessionId: "session-1", tabId: "ssr-tab" },
  });
}

function acceptMedia(socket: MockWebSocket) {
  socket.receive({
    protocol: CLIENT_MEDIA_WS_PROTOCOL,
    type: "hello_ack",
    selectedProtocol: CLIENT_MEDIA_WS_PROTOCOL,
    connectionId: "media-1",
  });
}

function delayForAttempt(attempt: number) {
  return 500 * 2 ** attempt;
}

async function flushPromises() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}
