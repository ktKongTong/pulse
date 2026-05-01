import { describe, expect, it } from "vitest";

import app from "@/api/index";
import type { Env } from "@/api/config/env";

type StoredState = Record<string, unknown>;

class MemoryLiveListenStub {
  private state: StoredState = {
    workspaceId: "pulse-demo",
    roomId: "live-listen:owner",
    state: "offline",
    listenerCount: 0,
    updatedAt: new Date(0).toISOString(),
  };

  async getSnapshot() {
    return this.state;
  }

  async startHost(payload: Record<string, unknown>) {
    this.state = {
      ...this.state,
      state: "starting",
      hostDeviceId: payload.hostDeviceId,
      startedAt: payload.requestedAt,
      updatedAt: payload.requestedAt,
      audio: payload.audio ?? {
        transport: "cloudflare-realtime",
        sessionId: "pulse:pulse-demo:live-listen:owner",
        mockToken: true,
      },
    };
    return {
      protocol: "live-listen.v1",
      roomId: "live-listen:owner",
      workspaceId: "pulse-demo",
      snapshot: this.state,
      token: {
        transport: "cloudflare-realtime",
        sessionId: "pulse:pulse-demo:live-listen:owner",
        participantId: payload.hostDeviceId,
        role: "host",
        token: "mock.host",
        expiresAt: "2026-04-29T00:15:00.000Z",
      },
    };
  }

  async heartbeatHost(payload: Record<string, unknown>) {
    this.state = {
      ...this.state,
      state: "live",
      updatedAt: payload.sentAt,
      media: payload.media,
      clock: payload.clock,
    };
    return this.state;
  }

  async stopHost(payload: Record<string, unknown>) {
    this.state = {
      ...this.state,
      state: "ended",
      updatedAt: payload.stoppedAt,
    };
    return this.state;
  }

  async joinListener(payload: Record<string, unknown>) {
    this.state = {
      ...this.state,
      state: this.state.state === "starting" || this.state.state === "live" ? this.state.state : "starting",
      hostDeviceId: this.state.hostDeviceId ?? "owner",
      listenerCount: Number(this.state.listenerCount ?? 0) + 1,
    };
    return {
      protocol: "live-listen.v1",
      roomId: "live-listen:owner",
      workspaceId: "pulse-demo",
      snapshot: this.state,
      token: {
        transport: "cloudflare-realtime",
        sessionId: "pulse:pulse-demo:live-listen:owner",
        participantId: payload.participantId,
        role: "listener",
        token: "mock.listener",
        expiresAt: "2026-04-29T00:15:00.000Z",
      },
    };
  }

  async leaveListener(payload: Record<string, unknown>) {
    this.state = {
      ...this.state,
      listenerCount: Math.max(0, Number(this.state.listenerCount ?? 0) - 1),
      updatedAt: payload.leftAt,
    };
    return this.state;
  }
}

function env(): Env {
  const stub = new MemoryLiveListenStub();
  return {
    WORKSPACE_ID: "pulse-demo",
    SITE_ID: "blog-demo",
    DEVICE_API_KEY: "device-secret",
    ALLOWED_ORIGINS: "https://pulse.ktlab.io,https://pulse.koft.space,http://localhost:8900",
    ROOM_SESSION_TTL_SECONDS: "45",
    WEB_HEARTBEAT_SECONDS: "30",
    AGGREGATE_FLUSH_SECONDS: "15",
    LIVE_LISTEN_ROOM: {
      idFromName: (name: string) => name,
      get: () => Object.assign(stub, {
        fetch: (request: Request) => {
          if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected websocket", { status: 426 });
          }

          const pair = new WebSocketPair();
          const [client] = Object.values(pair);
          return new Response(null, { status: 101, webSocket: client });
        },
      }),
    },
    ASSETS: {
      fetch: () => Response.json({ fallback: true }, { status: 404 }),
    },
  } as unknown as Env;
}

function jsonRequest(path: string, body: unknown, init: RequestInit = {}) {
  return new Request(`https://pulse.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://pulse.test",
      ...init.headers,
    },
    body: JSON.stringify(body),
  });
}

describe("live listen api", () => {
  it("routes host start and heartbeat through live listen DO", async () => {
    const testEnv = env();
    const start = await app.fetch(
      jsonRequest(
        "/v1/live-listen/host/start",
        {
          workspaceId: "pulse-demo",
          roomId: "live-listen:owner",
          hostDeviceId: "macbook",
          requestedAt: "2026-04-29T00:00:00.000Z",
        },
        { headers: { authorization: "Bearer device-secret" } },
      ),
      testEnv,
    );

    expect(start.status).toBe(200);
    expect((await start.json() as { token: { role: string } }).token.role).toBe("host");

    const heartbeat = await app.fetch(
      jsonRequest(
        "/v1/live-listen/host/heartbeat",
        {
          workspaceId: "pulse-demo",
          roomId: "live-listen:owner",
          hostDeviceId: "macbook",
          sentAt: "2026-04-29T00:00:01.000Z",
          media: { title: "Track" },
          clock: {
            mediaProgressSeconds: 1,
            observedAt: "2026-04-29T00:00:01.000Z",
            sequence: 1,
          },
        },
        { headers: { authorization: "Bearer device-secret" } },
      ),
      testEnv,
    );

    expect(heartbeat.status).toBe(200);
    expect((await heartbeat.json() as { state: string }).state).toBe("live");
  });

  it("requires websocket upgrade for live listen events", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/events"),
      env(),
    );

    expect(response.status).toBe(426);
  });

  it("routes live listen event websockets to the room DO", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/events", {
        headers: { Upgrade: "websocket", Origin: "https://pulse.ktlab.io" },
      }),
      env(),
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

  it("allows live listen event websockets from configured secondary origins", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/events", {
        headers: { Upgrade: "websocket", Origin: "https://pulse.koft.space" },
      }),
      env(),
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

  it("rejects live listen event websockets from unconfigured origins", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/events", {
        headers: { Upgrade: "websocket", Origin: "https://evil.test" },
      }),
      env(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("requires device bearer token for host routes", async () => {
    const response = await app.fetch(
      jsonRequest("/v1/live-listen/host/start", {
        workspaceId: "pulse-demo",
        roomId: "live-listen:owner",
        hostDeviceId: "macbook",
        requestedAt: "2026-04-29T00:00:00.000Z",
      }),
      env(),
    );

    expect(response.status).toBe(401);
  });

  it("allows same-origin listener joins and returns listener token", async () => {
    const testEnv = env();
    await app.fetch(
      jsonRequest(
        "/v1/live-listen/host/start",
        {
          workspaceId: "pulse-demo",
          roomId: "live-listen:owner",
          hostDeviceId: "macbook",
          requestedAt: "2026-04-29T00:00:00.000Z",
        },
        { headers: { authorization: "Bearer device-secret" } },
      ),
      testEnv,
    );

    const response = await app.fetch(
      jsonRequest("/v1/live-listen/listener/join", {
        workspaceId: "pulse-demo",
        roomId: "live-listen:owner",
        participantId: "visitor-1",
        joinedAt: "2026-04-29T00:00:02.000Z",
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { token: { role: string }; snapshot: { listenerCount: number } };
    expect(body.token.role).toBe("listener");
    expect(body.snapshot.listenerCount).toBe(1);
  });

  it("allows listener joins to request an inactive room start", async () => {
    const response = await app.fetch(
      jsonRequest("/v1/live-listen/listener/join", {
        workspaceId: "pulse-demo",
        roomId: "live-listen:owner",
        participantId: "visitor-1",
        joinedAt: "2026-04-29T00:00:02.000Z",
      }),
      env(),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { snapshot: { state: string; listenerCount: number } };
    expect(body.snapshot.state).toBe("starting");
    expect(body.snapshot.listenerCount).toBe(1);
  });
});
