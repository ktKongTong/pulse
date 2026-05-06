import { describe, expect, it } from "vitest";

import app from "@/api/index";
import type { Env } from "@/api/config/env";

class MemoryLiveListenStub {
  async getSnapshot() {
    return {
      protocol: "live-listen.server.v1",
      workspaceId: "pulse-demo",
      roomId: "live-listen:owner",
      listeners: { activeCount: 0, graceCount: 0, demand: "not-wanted" },
      nativeLink: { state: "disconnected" },
      admission: { state: "blocked", reason: "device_offline" },
      media: { current: null, recent: [], playback: "paused" },
      streamDemand: { state: "not-wanted", reason: "no-listeners", updatedAt: new Date(0).toISOString() },
      audioFlow: {
        state: "none",
        latestSeq: 0,
        availableFromSeq: 0,
      },
      updatedAt: new Date(0).toISOString(),
    };
  }

  fetch(request: Request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client] = Object.values(pair);
    return new Response(null, { status: 101, webSocket: client });
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
      get: () => stub,
    },
    ASSETS: {
      fetch: () => Response.json({ fallback: true }, { status: 404 }),
    },
  } as unknown as Env;
}

describe("live listen api", () => {
  it("returns diagnostic state without changing room state", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/state?workspaceId=pulse-demo&roomId=live-listen:owner"),
      env(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      protocol: "live-listen.server.v1",
      admission: { state: "blocked", reason: "device_offline" },
      streamDemand: { state: "not-wanted" },
    });
  });

  it("requires websocket upgrade for media sessions", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/media-session"),
      env(),
    );

    expect(response.status).toBe(426);
  });

  it("routes media-session websockets to the room DO", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/media-session", {
        headers: { Upgrade: "websocket", Origin: "https://pulse.ktlab.io" },
      }),
      env(),
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

  it("allows media-session websockets from configured secondary origins", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/media-session", {
        headers: { Upgrade: "websocket", Origin: "https://pulse.koft.space" },
      }),
      env(),
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

  it("rejects media-session websockets from unconfigured origins", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/media-session", {
        headers: { Upgrade: "websocket", Origin: "https://evil.test" },
      }),
      env(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("requires device bearer token for native device sessions", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/device-session", {
        headers: { Upgrade: "websocket" },
      }),
      env(),
    );

    expect(response.status).toBe(401);
  });

  it("routes authenticated native device sessions to the room DO", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/device-session", {
        headers: { Upgrade: "websocket", authorization: "Bearer device-secret" },
      }),
      env(),
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

  it("routes observer websockets without counting as listener joins", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/observe", {
        headers: { Upgrade: "websocket", Origin: "https://pulse.ktlab.io" },
      }),
      env(),
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

});
