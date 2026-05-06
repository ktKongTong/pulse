import { describe, expect, it } from "vitest";

import {
  LiveListenDeviceCommandEnvelopeSchema,
  LiveListenDeviceFrameSchema,
  LiveListenMediaSessionClientMessageSchema,
  LiveListenMediaSessionEnvelopeSchema,
  LiveListenSessionEnvelopeSchema,
  LiveListenSnapshotSchema,
} from "@pulse/realtime-protocol";

const snapshot = {
  protocol: "live-listen.server.v1",
  roomId: "live-listen:owner",
  workspaceId: "pulse-demo",
  listeners: { activeCount: 2, graceCount: 0, demand: "wanted" },
  nativeLink: {
    state: "connected",
    deviceId: "macbook",
    connectedAt: "2026-05-03T12:00:00.000Z",
  },
  admission: { state: "open" },
  streamDemand: { state: "wanted", reason: "listener-demand", updatedAt: "2026-05-03T12:00:00.000Z" },
  audioFlow: {
    state: "flowing",
    streamId: "stream_abc",
    generation: 2,
    latestSeq: 260,
    availableFromSeq: 231,
    lastChunkAt: "2026-05-03T12:00:03.000Z",
  },
  media: {
    current: {
      providerId: "spotify",
      provider: "spotify",
      title: "Everything In Its Right Place",
      artist: "Radiohead",
      playbackState: "playing",
    },
    recent: [],
    playback: "playing",
    clock: {
      mediaProgressSeconds: 42.5,
      observedAt: "2026-05-03T12:00:01.000Z",
      streamLatencyMs: 1500,
      sequence: 7,
    },
    sourceDeviceId: "macbook",
    updatedAt: "2026-05-03T12:00:01.000Z",
  },
  updatedAt: "2026-05-03T12:00:01.000Z",
};

describe("live listen protocol", () => {
  it("parses the document-defined room snapshot", () => {
    const parsed = LiveListenSnapshotSchema.parse(snapshot);

    expect(parsed.protocol).toBe("live-listen.server.v1");
    expect(parsed.media.current?.title).toBe("Everything In Its Right Place");
    expect(parsed.streamDemand.state).toBe("wanted");
  });

  it("parses listener session accepted and audio chunk envelopes", () => {
    const accepted = LiveListenSessionEnvelopeSchema.parse({
      protocol: "live-listen.media-session.v1",
      type: "session.accepted",
      participantId: "listener_abc",
      resumeToken: "resume_xxx",
      serverTime: "2026-05-03T12:00:00.000Z",
      snapshot,
    });
    const chunk = LiveListenSessionEnvelopeSchema.parse({
      protocol: "live-listen.media-session.v1",
      type: "audio.chunk",
      workspaceId: "pulse-demo",
      roomId: "live-listen:owner",
      streamId: "stream_abc",
      generation: 2,
      seq: 241,
      sentAt: "2026-05-03T12:00:03.000Z",
      durationMs: 1000,
      codec: "pcm16-wav",
      byteLength: 4,
      data: "AQIDBA==",
      replayed: false,
    });

    expect(accepted.type).toBe("session.accepted");
    expect(chunk.seq).toBe(241);
  });

  it("parses media-session snapshots and listen request messages", () => {
    const mediaSnapshot = LiveListenMediaSessionEnvelopeSchema.parse({
      protocol: "live-listen.media-session.v1",
      type: "media.snapshot.updated",
      snapshot: {
        ...snapshot,
        protocol: "live-listen.media-session.v1",
        nativeMediaState: {
          permission: "allow",
          playback: "playing",
          capture: "no-capture",
          media: snapshot.media.current,
        },
      },
    });
    const request = LiveListenMediaSessionClientMessageSchema.parse({
      protocol: "live-listen.media-session.v1",
      type: "listen.request",
      participantId: "web-listener-1",
      fromSeq: 241,
    });
    const accepted = LiveListenMediaSessionEnvelopeSchema.parse({
      protocol: "live-listen.media-session.v1",
      type: "session.accepted",
      participantId: "web-listener-1",
      resumeToken: "resume_xxx",
      snapshot,
    });

    expect(mediaSnapshot.type).toBe("media.snapshot.updated");
    expect(request.type).toBe("listen.request");
    expect(accepted.type).toBe("session.accepted");
  });

  it("parses native hello and stream command frames", () => {
    const hello = LiveListenDeviceFrameSchema.parse({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      lastStreamId: "stream_abc",
      lastGeneration: 2,
      lastSeq: 240,
      capabilities: { binaryAudio: true, localRingBuffer: true, localRingBufferSeconds: 30 },
      mediaState: {
        permission: "allow",
        playback: "playing",
        capture: "no-capture",
        media: {
          provider: "spotify",
          title: "Everything In Its Right Place",
          playbackState: "playing",
        },
      },
    });
    const command = LiveListenDeviceCommandEnvelopeSchema.parse({
      protocol: "live-listen.device.v1",
      type: "command",
      commandId: "cmd_start_1",
      sentAt: "2026-05-03T12:00:00.000Z",
      expiresAt: "2026-05-03T12:00:10.000Z",
      command: {
        type: "stream.start",
        streamId: "stream_abc",
        generation: 1,
        capture: {
          mode: "current-media-app",
          preferredProvider: "spotify",
          fallback: "selected",
        },
        audio: {
          codec: "pcm16-wav",
          chunkDurationMs: 1000,
          targetLatencyMs: 3000,
        },
      },
    });

    expect(hello.type).toBe("device.hello");
    expect(command.command.type).toBe("stream.start");
  });

  it("does not allow missing or paused mediaState for a playable device", () => {
    expect(() => LiveListenDeviceFrameSchema.parse({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
    })).toThrow();
    const parsed = LiveListenDeviceFrameSchema.parse({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: {
        permission: "allow",
        playback: "paused",
        capture: "no-capture",
        reason: "no_playable_media",
      },
    });
    expect(parsed.type).toBe("device.hello");
  });
});
