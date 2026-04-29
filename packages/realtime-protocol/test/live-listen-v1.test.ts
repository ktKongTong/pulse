import { describe, expect, it } from "vitest";

import {
  LiveListenHostHeartbeatRequestSchema,
  LiveListenSnapshotSchema,
  LiveListenTokenResponseSchema,
} from "@pulse/realtime-protocol";

describe("live listen protocol", () => {
  it("parses audio-only room snapshots", () => {
    const parsed = LiveListenSnapshotSchema.parse({
      roomId: "live-listen:owner",
      workspaceId: "pulse-demo",
      state: "live",
      listenerCount: 2,
      hostDeviceId: "macbook",
      startedAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:01.000Z",
      audio: {
        transport: "cloudflare-realtime",
        sessionId: "pulse:pulse-demo:live-listen:owner",
        roomName: "live-listen:owner",
        publishTrackName: "host-audio",
        mockToken: true,
      },
      media: {
        providerId: "spotify",
        provider: "spotify",
        title: "Everything In Its Right Place",
        artist: "Radiohead",
        playbackState: "playing",
      },
      clock: {
        mediaProgressSeconds: 42.5,
        observedAt: "2026-04-29T00:00:01.000Z",
        streamLatencyMs: 1500,
        sequence: 7,
      },
    });

    expect(parsed.protocol).toBe("live-listen.v1");
    expect(parsed.audio?.transport).toBe("cloudflare-realtime");
    expect(parsed.clock?.sequence).toBe(7);
  });

  it("parses host heartbeat payloads", () => {
    const parsed = LiveListenHostHeartbeatRequestSchema.parse({
      workspaceId: "pulse-demo",
      roomId: "live-listen:owner",
      hostDeviceId: "macbook",
      sentAt: "2026-04-29T00:00:02.000Z",
      media: {
        providerId: "apple-music",
        title: "Intro",
        durationSeconds: 120,
      },
      clock: {
        mediaProgressSeconds: 3,
        observedAt: "2026-04-29T00:00:02.000Z",
        sequence: 1,
      },
    });

    expect(parsed.protocol).toBe("live-listen.v1");
    expect(parsed.media?.providerId).toBe("apple-music");
  });

  it("parses listener token responses", () => {
    const parsed = LiveListenTokenResponseSchema.parse({
      roomId: "live-listen:owner",
      workspaceId: "pulse-demo",
      snapshot: {
        roomId: "live-listen:owner",
        workspaceId: "pulse-demo",
        state: "starting",
        listenerCount: 1,
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      token: {
        transport: "cloudflare-realtime",
        sessionId: "pulse:pulse-demo:live-listen:owner",
        participantId: "visitor-1",
        role: "listener",
        token: "mock.token",
        expiresAt: "2026-04-29T00:15:00.000Z",
      },
    });

    expect(parsed.token.role).toBe("listener");
    expect(parsed.snapshot.listenerCount).toBe(1);
  });
});
