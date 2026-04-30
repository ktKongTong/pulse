import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import app from "@/api/index";
import type { Env } from "@/api/config/env";

function env(): Env {
  return {
    WORKSPACE_ID: "pulse-demo",
    SITE_ID: "blog-demo",
    DEVICE_API_KEY: "device-secret",
    ALLOWED_ORIGINS: "https://pulse.test,https://pulse.koft.space,http://localhost:8900",
    ROOM_SESSION_TTL_SECONDS: "45",
    WEB_HEARTBEAT_SECONDS: "30",
    AGGREGATE_FLUSH_SECONDS: "15",
    REALTIME_SFU_APP_ID: "sfu-app",
    REALTIME_SFU_APP_TOKEN: "sfu-token",
    ASSETS: {
      fetch: () => Response.json({ fallback: true }, { status: 404 }),
    },
  } as unknown as Env;
}

function envWithTurn(): Env {
  return {
    ...env(),
    REALTIME_TURN_APP_ID: "turn-app",
    REALTIME_TURN_APP_TOKEN: "turn-token",
  } as Env;
}

describe("partytracks api", () => {
  it("proxies SDK requests to Cloudflare Realtime SFU", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ sessionId: "session-1" }),
    );

    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/partytracks/sessions/new", {
        method: "POST",
        headers: { origin: "https://pulse.test" },
      }),
      env(),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://rtc.live.cloudflare.com/v1/apps/sfu-app/sessions/new"),
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer sfu-token");
    fetchMock.mockRestore();
  });

  it("proxies SDK requests from worker-mounted /api paths", async () => {
    const mountedApp = new Hono<{ Bindings: Env }>().route("/api", app);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ sessionId: "session-1" }),
    );

    const response = await mountedApp.fetch(
      new Request("https://pulse.test/api/v1/live-listen/partytracks/sessions/new", {
        method: "POST",
        headers: { origin: "https://pulse.test" },
      }),
      env(),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://rtc.live.cloudflare.com/v1/apps/sfu-app/sessions/new"),
      expect.objectContaining({ method: "POST" }),
    );
    fetchMock.mockRestore();
  });

  it("proxies SDK requests from configured secondary origins", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ sessionId: "session-1" }),
    );

    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/partytracks/sessions/new", {
        method: "POST",
        headers: { origin: "https://pulse.koft.space" },
      }),
      env(),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://rtc.live.cloudflare.com/v1/apps/sfu-app/sessions/new"),
      expect.objectContaining({ method: "POST" }),
    );
    fetchMock.mockRestore();
  });

  it("rejects disallowed origins before proxying", async () => {
    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/partytracks/generate-ice-servers", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
      env(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("allows same-origin SDK ice server requests without an Origin header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"] }] }),
    );

    const response = await app.fetch(
      new Request("https://pulse.test/v1/live-listen/partytracks/generate-ice-servers", {
        method: "POST",
      }),
      envWithTurn(),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/turn-app/credentials/generate-ice-servers",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer turn-token" },
      }),
    );
    expect(await response.json()).toEqual({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"] }] });
    fetchMock.mockRestore();
  });
});
