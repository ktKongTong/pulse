import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_PAGE_WS_PROTOCOL,
  CLIENT_WS_PROTOCOL,
} from "@ktfun/pulse-protocol";
import { PulseRealtimeV2Client } from "./client";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly sent: Array<string | ArrayBuffer> = [];
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

  receiveBinary(bytes: ArrayBuffer) {
    this.emit("message", { data: bytes });
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
        protocol: CLIENT_WS_PROTOCOL,
        sessionId: "session-1",
      }),
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connect() opens a single client ws and resolves after hello_ack", async () => {
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    const connecting = client.connect();
    await flushPromises();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe("wss://pulse.test/api/v1/client/ws");

    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0] as string)).toMatchObject({
      protocol: CLIENT_WS_PROTOCOL,
      type: "hello",
      sessionId: "session-1",
      tabId: "ssr-tab",
    });
    expect(sockets).toHaveLength(1);

    let resolved = false;
    connecting.then(() => { resolved = true; });
    acceptClient(sockets[0]!);
    await flushPromises();
    expect(resolved).toBe(true);
    await connecting;
    expect(client.getSnapshot().common.connection.connected).toBe(true);
    expect(client.getSnapshot().media.connection.connected).toBe(true);
  });

  it("connect() is idempotent while a connection is in progress", async () => {
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    const first = client.connect();
    const second = client.connect();
    await flushPromises();

    expect(first).toBe(second);
    expect(sockets).toHaveLength(1);

    sockets[0]!.open();
    acceptClient(sockets[0]!);
    await first;

    expect(sockets).toHaveLength(1);
  });

  it("stops retrying after six failed attempts and marks both common and media failed", async () => {
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
      error: "client_ws_reconnect_exhausted",
      connected: false,
    });
    expect(client.getSnapshot().media.connection).toMatchObject({
      status: "failed",
      error: "client_ws_reconnect_exhausted",
      connected: false,
    });
  });

  it("dispose() cancels pending reconnects", async () => {
    vi.useFakeTimers();
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    void connectFully(client);
    await flushPromises();
    sockets[0]!.open();
    acceptClient(sockets[0]!);
    await flushPromises();

    sockets[0]!.failClosed();
    client.dispose();
    await vi.advanceTimersByTimeAsync(500);

    expect(sockets).toHaveLength(1);
  });

  it("connectPage() establishes client ws before opening page ws", async () => {
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    const connectingPage = client.connectPage("https://example.com/a", {
      title: "A",
      url: "https://example.com/a",
    });
    await flushPromises();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe("wss://pulse.test/api/v1/client/ws");
    sockets[0]!.open();
    acceptClient(sockets[0]!);
    await connectingPage;

    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.url).toBe(
      "wss://pulse.test/api/v1/client/page/ws?canonicalUrl=https%3A%2F%2Fexample.com%2Fa",
    );
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0] as string)).toMatchObject({
      protocol: CLIENT_PAGE_WS_PROTOCOL,
      type: "hello",
      sessionId: "session-1",
      tabId: "ssr-tab",
      page: { title: "A", url: "https://example.com/a" },
    });
  });

  it("sends stream.request, stream.stop and ack on the same client socket", async () => {
    const client = new PulseRealtimeV2Client({ baseUrl: "https://pulse.test" });
    await connectFully(client);
    const socket = sockets[0]!;

    socket.receive({
      protocol: CLIENT_WS_PROTOCOL,
      type: "state",
      revision: 1,
      updatedAt: "2026-06-19T00:00:00.000Z",
      media: null,
      stream: { source: { state: "ready" } },
    });
    await flushPromises();
    expect(client.getSnapshot().media.source.state).toBe("ready");

    client.requestStream();
    client.stopStream();
    client.ackStream("stream-1", 1, 2);
    await flushPromises();

    const sentTypes = socket.sent
      .map((entry) => (typeof entry === "string" ? JSON.parse(entry).type : null));
    expect(sentTypes).toContain("stream.request");
    expect(sentTypes).toContain("stream.stop");
    expect(sentTypes).toContain("ack");
    expect(sockets).toHaveLength(1);
  });

  it("delivers media state and audio chunks on the same client socket", async () => {
    const onAudioChunk = vi.fn();
    const client = new PulseRealtimeV2Client({
      baseUrl: "https://pulse.test",
      onAudioChunk,
    });
    await connectFully(client);
    const socket = sockets[0]!;

    socket.receive({
      protocol: CLIENT_WS_PROTOCOL,
      type: "state",
      revision: 1,
      updatedAt: "2026-06-19T00:00:00.000Z",
      media: {
        current: { title: "DAYS of DASH" },
        playback: "playing",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
      stream: { source: { state: "ready" } },
    });
    await flushPromises();
    expect(client.getSnapshot().media.media?.current.title).toBe("DAYS of DASH");

    client.requestStream();
    socket.receive({
      protocol: CLIENT_WS_PROTOCOL,
      type: "stream.accepted",
      requestId: "req-1",
      stream: { streamId: "stream-1", generation: 1 },
    });
    await flushPromises();
    expect(client.getSnapshot().media.stream.state).toBe("active");

    socket.receive({
      protocol: CLIENT_WS_PROTOCOL,
      type: "audio.chunk",
      streamId: "stream-1",
      generation: 1,
      seq: 1,
      sentAt: "2026-06-19T00:00:01.000Z",
      durationMs: 20,
      codec: "pcm16-wav",
      byteLength: 4,
      mediaStartPositionMs: 0,
      replayed: false,
    });
    socket.receiveBinary(new Uint8Array([1, 2, 3, 4]).buffer);
    await flushPromises();

    expect(onAudioChunk).toHaveBeenCalledTimes(1);
    const chunk = onAudioChunk.mock.calls[0]![0];
    expect(chunk.seq).toBe(1);
    expect(chunk.bytes.byteLength).toBe(4);
    expect(client.getSnapshot().media.stream.state).toBe("active");
    expect(sockets).toHaveLength(1);
  });
});

async function connectFully(client: PulseRealtimeV2Client) {
  const connecting = client.connect();
  await flushPromises();
  sockets[0]!.open();
  acceptClient(sockets[0]!);
  await connecting;
}

function acceptClient(socket: MockWebSocket) {
  socket.receive({
    protocol: CLIENT_WS_PROTOCOL,
    type: "hello_ack",
    selectedProtocol: CLIENT_WS_PROTOCOL,
    connectionId: "client-1",
    session: { sessionId: "session-1", tabId: "ssr-tab" },
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
