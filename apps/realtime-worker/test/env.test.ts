import { describe, expect, it } from "vitest";

import {
  aggregateFlushMs,
  allowedOrigins,
  deviceSessionTtlMs,
  webHeartbeatSeconds,
  webSessionTtlMs,
  type Env,
} from "../src/env";

function env(overrides: Partial<Env> = {}): Env {
  return {
    WORKSPACE_ID: "pulse-demo",
    SITE_ID: "blog-demo",
    DEVICE_API_KEY: "device-secret",
    ALLOWED_ORIGINS: "https://pulse.ktlab.io,http://localhost:8900",
    ROOM_SESSION_TTL_SECONDS: "45",
    WEB_HEARTBEAT_SECONDS: "30",
    AGGREGATE_FLUSH_SECONDS: "15",
    ...overrides,
  } as Env;
}

describe("worker env", () => {
  it("loads required values directly from env", () => {
    expect([...allowedOrigins(env())]).toEqual([
      "https://pulse.ktlab.io",
      "http://localhost:8900",
    ]);
    expect(webSessionTtlMs(env())).toBe(45_000);
    expect(webHeartbeatSeconds(env())).toBe(30);
    expect(deviceSessionTtlMs(env())).toBe(60_000);
    expect(aggregateFlushMs(env())).toBe(15_000);
  });

  it("throws when required env values are missing", () => {
    expect(() => webHeartbeatSeconds(env({ WEB_HEARTBEAT_SECONDS: "" }))).toThrow(
      "Missing required environment variable: WEB_HEARTBEAT_SECONDS",
    );
    expect(() => aggregateFlushMs(env({ AGGREGATE_FLUSH_SECONDS: undefined }))).toThrow(
      "Missing required environment variable: AGGREGATE_FLUSH_SECONDS",
    );
    expect(() => allowedOrigins(env({ ALLOWED_ORIGINS: " " }))).toThrow(
      "Missing required environment variable: ALLOWED_ORIGINS",
    );
  });

  it("throws when required numeric env values are invalid", () => {
    expect(() => webSessionTtlMs(env({ ROOM_SESSION_TTL_SECONDS: "abc" }))).toThrow(
      "Invalid numeric environment variable: ROOM_SESSION_TTL_SECONDS",
    );
    expect(() => webHeartbeatSeconds(env({ WEB_HEARTBEAT_SECONDS: "0" }))).toThrow(
      "Invalid numeric environment variable: WEB_HEARTBEAT_SECONDS",
    );
  });
});
