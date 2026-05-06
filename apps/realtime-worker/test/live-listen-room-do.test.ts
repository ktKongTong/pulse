import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { Env } from "@/api/config/env";
import { LiveListenRoom } from "@/api/do/live-listen/room-do";

function liveListenStub(name = `pulse-demo:live-listen:owner:${crypto.randomUUID()}`) {
  const liveListenRoom = (env as Env).LIVE_LISTEN_ROOM;
  const id = liveListenRoom.idFromName(name);
  return liveListenRoom.get(id);
}

function setLiveListenStreamEnv(config: {
  chunkDurationMs?: string;
  targetLatencyMs?: string;
  ringBufferSeconds?: string;
}) {
  const mutableEnv = env as Env;
  const previous = {
    chunkDurationMs: mutableEnv.LIVE_LISTEN_CHUNK_DURATION_MS,
    targetLatencyMs: mutableEnv.LIVE_LISTEN_TARGET_LATENCY_MS,
    ringBufferSeconds: mutableEnv.LIVE_LISTEN_RING_BUFFER_SECONDS,
  };
  mutableEnv.LIVE_LISTEN_CHUNK_DURATION_MS = config.chunkDurationMs;
  mutableEnv.LIVE_LISTEN_TARGET_LATENCY_MS = config.targetLatencyMs;
  mutableEnv.LIVE_LISTEN_RING_BUFFER_SECONDS = config.ringBufferSeconds;
  return () => {
    mutableEnv.LIVE_LISTEN_CHUNK_DURATION_MS = previous.chunkDurationMs;
    mutableEnv.LIVE_LISTEN_TARGET_LATENCY_MS = previous.targetLatencyMs;
    mutableEnv.LIVE_LISTEN_RING_BUFFER_SECONDS = previous.ringBufferSeconds;
  };
}

async function openSocket(stub: DurableObjectStub, path: string) {
  const response = await stub.fetch(
    new Request(`https://pulse.test/internal/live-listen/${path}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket as WebSocket;
  socket.accept();
  return socket;
}

function nextJson<T extends { type?: string; protocol?: string }>(socket: WebSocket, type?: string): Promise<T> {
  return new Promise((resolve) => {
    socket.addEventListener("message", function onMessage(event) {
      if (typeof event.data !== "string") return;
      const parsed = JSON.parse(String(event.data)) as T;
      if (!type || parsed.type === type) {
        socket.removeEventListener("message", onMessage);
        resolve(parsed);
      }
    });
  });
}

function nextBinary(socket: WebSocket): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    socket.addEventListener("message", function onMessage(event) {
      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((data) => {
          socket.removeEventListener("message", onMessage);
          resolve(data);
        });
        return;
      }
      if (!(event.data instanceof ArrayBuffer)) return;
      socket.removeEventListener("message", onMessage);
      resolve(event.data);
    });
  });
}

async function waitForSnapshot(
  stub: DurableObjectStub,
  predicate: (snapshot: Awaited<ReturnType<LiveListenRoom["getSnapshot"]>>) => boolean,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await runInDurableObject(stub, async (room: LiveListenRoom) => {
      return room.getSnapshot("pulse-demo", "live-listen:owner");
    });
    if (predicate(snapshot)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("snapshot predicate not reached");
}

function playableMediaState() {
  return {
    permission: "allow" as const,
    playback: "playing" as const,
    capture: "no-capture" as const,
    media: { provider: "spotify" as const, title: "Song A", artist: "Artist A", playbackState: "playing" as const },
  };
}

async function openMediaSession(stub: DurableObjectStub) {
  const socket = await openSocket(stub, "media-session?workspaceId=pulse-demo&roomId=live-listen:owner");
  await nextJson(socket, "media.snapshot.updated");
  return socket;
}

function requestListen(
  socket: WebSocket,
  init: {
    participantId?: string;
    resumeToken?: string;
    streamId?: string;
    sourceGeneration?: number;
    fromSeq?: number;
  } = {},
) {
  socket.send(JSON.stringify({
    protocol: "live-listen.media-session.v1",
    type: "listen.request",
    participantId: init.participantId ?? `web-${crypto.randomUUID()}`,
    resumeToken: init.resumeToken,
    streamId: init.streamId,
    sourceGeneration: init.sourceGeneration,
    fromSeq: init.fromSeq,
  }));
}

async function openListeningMediaSession(
  stub: DurableObjectStub,
  init?: Parameters<typeof requestListen>[1],
) {
  const socket = await openMediaSession(stub);
  requestListen(socket, init);
  return socket;
}

describe("LiveListenRoom", () => {
  it("exposes the document snapshot shape while idle", async () => {
    const stub = liveListenStub();

    const snapshot = await runInDurableObject(stub, async (room: LiveListenRoom) => {
      return room.getSnapshot("pulse-demo", "live-listen:owner");
    });

    expect(snapshot).toMatchObject({
      protocol: "live-listen.server.v1",
      workspaceId: "pulse-demo",
      roomId: "live-listen:owner",
      listeners: { activeCount: 0, graceCount: 0, demand: "not-wanted" },
      nativeLink: { state: "disconnected" },
      admission: { state: "blocked", reason: "device_offline" },
      media: { current: null, recent: [], playback: "paused" },
      streamDemand: { state: "not-wanted" },
      audioFlow: { state: "none" },
    });
  });

  it("rejects listen requests when the device is unavailable", async () => {
    const stub = liveListenStub();
    const socket = await openMediaSession(stub);
    requestListen(socket, { participantId: "web-listener-1" });

    const rejected = await nextJson(socket, "session.rejected");

    expect(rejected).toMatchObject({
      protocol: "live-listen.media-session.v1",
      type: "session.rejected",
      participantId: "web-listener-1",
      reason: "device_offline",
      snapshot: {
        admission: { state: "blocked", reason: "device_offline" },
        media: { recent: [] },
      },
    });
  });

  it("keeps recent media in rejected listener responses", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: playableMediaState(),
    }));
    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "media.state.updated",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:01.000Z",
      mediaState: {
        permission: "disallow",
        playback: "paused",
        capture: "no-capture",
        reason: "live_listen_disabled",
      },
    }));
    await waitForSnapshot(stub, (snapshot) => snapshot.admission.state === "blocked");

    const listener = await openMediaSession(stub);
    requestListen(listener, { participantId: "web-listener-1" });
    const rejected = await nextJson(listener, "session.rejected");

    expect(rejected).toMatchObject({
      type: "session.rejected",
      reason: "live_listen_disabled",
      snapshot: {
        admission: { state: "blocked", reason: "live_listen_disabled" },
        media: {
          recent: [
            { provider: "spotify", title: "Song A", artist: "Artist A" },
          ],
        },
      },
    });
  });

  it("streams media-session snapshots without starting listener audio", async () => {
    const stub = liveListenStub();
    const mediaSession = await openSocket(stub, "media-session?workspaceId=pulse-demo&roomId=live-listen:owner");
    const initial = await nextJson(mediaSession, "media.snapshot.updated");

    expect(initial).toMatchObject({
      protocol: "live-listen.media-session.v1",
      type: "media.snapshot.updated",
      snapshot: {
        protocol: "live-listen.media-session.v1",
        listeners: { activeCount: 0, graceCount: 0, demand: "not-wanted" },
        media: { current: null, recent: [] },
        nativeLink: { state: "disconnected" },
        streamDemand: { state: "not-wanted" },
        audioFlow: { state: "none" },
      },
    });

    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    let receivedCommand: { type?: string } | null = null;
    device.addEventListener("message", (event) => {
      receivedCommand = JSON.parse(String(event.data)) as { type?: string };
    });

    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: playableMediaState(),
    }));

    const updated = await nextJson(mediaSession, "media.snapshot.updated");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(updated).toMatchObject({
      protocol: "live-listen.media-session.v1",
      type: "media.snapshot.updated",
      snapshot: {
        nativeLink: { state: "connected" },
        media: {
          current: { provider: "spotify", title: "Song A", artist: "Artist A" },
          recent: [
            { provider: "spotify", title: "Song A", artist: "Artist A" },
          ],
        },
      },
    });
    expect(receivedCommand).toBeNull();
  });

  it("does not expose stale current media after native disconnect", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: playableMediaState(),
    }));
    await waitForSnapshot(stub, (snapshot) => snapshot.media.current?.title === "Song A");

    device.close(1001, "native closed");
    const disconnected = await waitForSnapshot(stub, (snapshot) => snapshot.nativeLink.state === "disconnected");

    expect(disconnected).toMatchObject({
      nativeLink: { state: "disconnected" },
      media: {
        current: null,
        recent: [
          { provider: "spotify", title: "Song A", artist: "Artist A" },
        ],
      },
    });
  });

  it("moves current media to recent when native reports no playable media", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: playableMediaState(),
    }));
    await waitForSnapshot(stub, (snapshot) => snapshot.media.current?.title === "Song A");

    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "media.state.updated",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:01.000Z",
      mediaState: {
        permission: "allow",
        playback: "paused",
        capture: "no-capture",
        reason: "no_playable_media",
      },
    }));
    const paused = await waitForSnapshot(stub, (snapshot) => snapshot.admission.state === "blocked");

    expect(paused).toMatchObject({
      nativeLink: { state: "connected" },
      admission: { state: "blocked", reason: "no_playable_media" },
      media: {
        current: null,
        recent: [
          { provider: "spotify", title: "Song A", artist: "Artist A" },
        ],
      },
    });
  });

  it("starts listening from the existing media-session websocket", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    const nativeCommand = nextJson(device, "command");

    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      capabilities: { binaryAudio: true, localRingBuffer: true, localRingBufferSeconds: 30 },
      mediaState: playableMediaState(),
    }));

    const mediaSession = await openSocket(stub, "media-session?workspaceId=pulse-demo&roomId=live-listen:owner");
    await nextJson(mediaSession, "media.snapshot.updated");
    mediaSession.send(JSON.stringify({
      protocol: "live-listen.media-session.v1",
      type: "listen.request",
      participantId: "web-listener-1",
    }));

    const accepted = await nextJson<{
      protocol: string;
      type: string;
      participantId: string;
      resumeToken: string;
      snapshot: { audioFlow: { streamId: string; generation: number } };
    }>(mediaSession, "session.accepted");
    const command = await nativeCommand;
    const audio = nextJson(mediaSession, "audio.chunk");
    const binary = nextBinary(mediaSession);
    device.send(new Uint8Array([1, 2, 3, 4]).buffer);

    expect(accepted).toMatchObject({
      protocol: "live-listen.media-session.v1",
      type: "session.accepted",
      participantId: "web-listener-1",
      resumeToken: expect.stringMatching(/^resume_/),
    });
    expect(command).toMatchObject({
      protocol: "live-listen.device.v1",
      type: "command",
      command: { type: "stream.start" },
    });
    const audioMetadata = await audio;
    expect(audioMetadata).toMatchObject({
      protocol: "live-listen.media-session.v1",
      type: "audio.chunk",
      streamId: accepted.snapshot.audioFlow.streamId,
      generation: accepted.snapshot.audioFlow.generation,
      seq: 1,
    });
    expect(audioMetadata).not.toHaveProperty("data");
    expect([...new Uint8Array(await binary)]).toEqual([1, 2, 3, 4]);
  });

  it("accepts listen requests, returns a resume token, and commands native start", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    const nativeCommand = nextJson(device, "command");

    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      capabilities: { binaryAudio: true, localRingBuffer: true, localRingBufferSeconds: 30 },
      mediaState: playableMediaState(),
    }));

    const listener = await openListeningMediaSession(stub, { participantId: "web-listener-1" });
    const accepted = await nextJson(listener, "session.accepted");
    const command = await nativeCommand;

    expect(accepted).toMatchObject({
      protocol: "live-listen.media-session.v1",
      type: "session.accepted",
      participantId: "web-listener-1",
      resumeToken: expect.stringMatching(/^resume_/),
      snapshot: {
        listeners: { activeCount: 1, graceCount: 0, demand: "wanted" },
        admission: { state: "open" },
        streamDemand: { state: "wanted", reason: "listener-demand" },
        audioFlow: {
          state: "starting",
          generation: 1,
        },
      },
    });
    expect(command).toMatchObject({
      protocol: "live-listen.device.v1",
      type: "command",
      command: {
        type: "stream.start",
        generation: 1,
        audio: { codec: "pcm16-wav", chunkDurationMs: 500, targetLatencyMs: 2000 },
      },
    });
  });

  it("rejects listener sessions and does not command native capture without playable media", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    let receivedCommand: { type?: string } | null = null;
    device.addEventListener("message", (event) => {
      receivedCommand = JSON.parse(String(event.data)) as { type?: string };
    });

    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: { permission: "allow", playback: "paused", capture: "no-capture", reason: "no_playable_media" },
    }));

    const listener = await openMediaSession(stub);
    requestListen(listener, { participantId: "web-listener-1" });
    const rejected = await nextJson(listener, "session.rejected");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rejected).toMatchObject({
      type: "session.rejected",
      reason: "no_playable_media",
      snapshot: {
        nativeLink: { state: "connected" },
        admission: { state: "blocked", reason: "no_playable_media" },
        streamDemand: { state: "not-wanted" },
        audioFlow: { state: "none" },
      },
    });
    expect(receivedCommand).toBeNull();
  });

  it("does not restart native capture when stale running intent has no listeners", async () => {
    const stub = liveListenStub();
    const firstDevice = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    const nativeCommand = nextJson(firstDevice, "command");

    firstDevice.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: playableMediaState(),
    }));

    const listener = await openListeningMediaSession(stub, { participantId: "web-listener-1" });
    const accepted = await nextJson<{
      type: string;
      snapshot: { audioFlow: { streamId: string; generation: number } };
    }>(listener, "session.accepted");
    await nativeCommand;

    listener.close(1001, "gone");
    await waitForSnapshot(stub, (snapshot) => snapshot.listeners.graceCount === 1);

    await runInDurableObject(stub, async (room: LiveListenRoom) => {
      const roomWithState = room as unknown as {
        ctx: DurableObjectState;
        roomState?: { listeners: Record<string, { state: string; graceDeadlineAt?: string }> };
      };
      const stored = await roomWithState.ctx.storage.get("live-listen-state") as {
        listeners: Record<string, { state: string; graceDeadlineAt?: string }>;
      };
      for (const listener of Object.values(stored.listeners)) {
        listener.graceDeadlineAt = "2026-05-03T12:00:00.000Z";
      }
      if (roomWithState.roomState) {
        for (const listener of Object.values(roomWithState.roomState.listeners)) {
          listener.graceDeadlineAt = "2026-05-03T12:00:00.000Z";
        }
      }
      await roomWithState.ctx.storage.put("live-listen-state", stored);
    });

    const nextDevice = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    let receivedCommand: { command?: { type?: string } } | null = null;
    nextDevice.addEventListener("message", (event) => {
      const parsed = JSON.parse(String(event.data)) as { type?: string; command?: { type?: string } };
      if (parsed.type === "command") receivedCommand = parsed;
    });
    nextDevice.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:01:00.000Z",
      lastStreamId: accepted.snapshot.audioFlow.streamId,
      lastGeneration: accepted.snapshot.audioFlow.generation,
      mediaState: playableMediaState(),
    }));

    const snapshot = await waitForSnapshot(stub, (next) => next.listeners.activeCount === 0 && next.streamDemand.state === "not-wanted");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(receivedCommand).toMatchObject({ command: { type: "stream.stop" } });
    expect(snapshot).toMatchObject({
      listeners: { activeCount: 0, graceCount: 0, demand: "not-wanted" },
      streamDemand: { state: "not-wanted" },
      audioFlow: { state: "none" },
    });
  });

  it("requires device.hello as the first native frame", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    const close = new Promise<CloseEvent>((resolve) => {
      device.addEventListener("close", (event) => resolve(event), { once: true });
    });

    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "media.updated",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      media: { provider: "spotify", title: "Song A" },
    }));

    expect(await close).toMatchObject({
      code: 1008,
      reason: "device hello required",
    });
  });

  it("fans native binary audio through the room ring buffer to the session websocket", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: playableMediaState(),
    }));

    const listener = await openListeningMediaSession(stub, { participantId: "web-listener-1" });
    const accepted = await nextJson<{ type: string; streamId?: string; generation?: number; snapshot: { audioFlow: { streamId: string; generation: number } } }>(listener, "session.accepted");
    const audio = nextJson(listener, "audio.chunk");
    const binary = nextBinary(listener);
    device.send(new Uint8Array([1, 2, 3, 4]).buffer);

    const audioMetadata = await audio;
    expect(audioMetadata).toMatchObject({
      protocol: "live-listen.media-session.v1",
      type: "audio.chunk",
      streamId: accepted.snapshot.audioFlow.streamId,
      generation: accepted.snapshot.audioFlow.generation,
      seq: 1,
      codec: "pcm16-wav",
      byteLength: 4,
      replayed: false,
    });
    expect(audioMetadata).not.toHaveProperty("data");
    expect([...new Uint8Array(await binary)]).toEqual([1, 2, 3, 4]);

    const persisted = await runInDurableObject(stub, async (room: LiveListenRoom) => {
      return (room as unknown as { ctx: DurableObjectState }).ctx.storage.get("live-listen-state");
    }) as { audioRing?: unknown };
    expect(persisted.audioRing).toBeUndefined();
  });

  it("uses server stream config for native commands and audio chunk metadata", async () => {
    const restoreEnv = setLiveListenStreamEnv({
      chunkDurationMs: "125",
      targetLatencyMs: "500",
      ringBufferSeconds: "10",
    });
    try {
      const stub = liveListenStub();
      const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
      const nativeCommand = nextJson<{
        type: string;
        command: { type: string; audio?: { codec: string; chunkDurationMs: number; targetLatencyMs: number } };
      }>(device, "command");
      device.send(JSON.stringify({
        protocol: "live-listen.device.v1",
        type: "device.hello",
        deviceId: "owner",
        sentAt: "2026-05-03T12:00:00.000Z",
        mediaState: playableMediaState(),
      }));

      const listener = await openListeningMediaSession(stub, { participantId: "web-listener-1" });
      await nextJson(listener, "session.accepted");
      expect(await nativeCommand).toMatchObject({
        command: {
          type: "stream.start",
          audio: { codec: "pcm16-wav", chunkDurationMs: 125, targetLatencyMs: 500 },
        },
      });

      const audio = nextJson(listener, "audio.chunk");
      const binary = nextBinary(listener);
      device.send(new Uint8Array([1, 2]).buffer);

      expect(await audio).toMatchObject({
        type: "audio.chunk",
        durationMs: 125,
        byteLength: 2,
      });
      expect([...new Uint8Array(await binary)]).toEqual([1, 2]);
    } finally {
      restoreEnv();
    }
  });

  it("resumes a recovering web listener and replays buffered audio from fromSeq", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: playableMediaState(),
    }));

    const listener = await openListeningMediaSession(stub, { participantId: "web-listener-1" });
    const accepted = await nextJson<{
      type: string;
      participantId: string;
      resumeToken: string;
      snapshot: { audioFlow: { streamId: string; generation: number } };
    }>(listener, "session.accepted");
    device.send(new Uint8Array([1]).buffer);
    await nextJson(listener, "audio.chunk");
    listener.close(1001, "network drop");
    await waitForSnapshot(stub, (snapshot) => snapshot.listeners.graceCount === 1);
    device.send(new Uint8Array([2]).buffer);

    const resumedSocket = await openMediaSession(stub);
    requestListen(resumedSocket, {
      participantId: accepted.participantId,
      resumeToken: accepted.resumeToken,
      streamId: accepted.snapshot.audioFlow.streamId,
      sourceGeneration: accepted.snapshot.audioFlow.generation,
      fromSeq: 2,
    });
    const resumed = await nextJson(resumedSocket, "session.resumed");
    const replayed = nextJson(resumedSocket, "audio.chunk");
    const replayedBinary = nextBinary(resumedSocket);

    expect(resumed).toMatchObject({
      type: "session.resumed",
      requestedFromSeq: 2,
      latestSeq: 2,
      availableFromSeq: 1,
    });
    expect(await replayed).toMatchObject({
      type: "audio.chunk",
      seq: 2,
      replayed: true,
    });
    expect(await replayed).not.toHaveProperty("data");
    expect([...new Uint8Array(await replayedBinary)]).toEqual([2]);
  });

  it("keeps stream demand wanted during native reconnect and sends stream.resume on hello", async () => {
    const stub = liveListenStub();
    const device = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    device.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:00.000Z",
      mediaState: playableMediaState(),
    }));
    const listener = await openListeningMediaSession(stub, { participantId: "web-listener-1" });
    const accepted = await nextJson<{
      type: string;
      snapshot: { audioFlow: { streamId: string; generation: number } };
    }>(listener, "session.accepted");
    device.close(1001, "native reconnect");

    const disconnected = await waitForSnapshot(stub, (snapshot) => snapshot.nativeLink.state === "disconnected");
    expect(disconnected.streamDemand).toMatchObject({
      state: "wanted",
      reason: "listener-demand",
    });

    const nextDevice = await openSocket(stub, "device-session?workspaceId=pulse-demo&roomId=live-listen:owner&deviceId=owner");
    const resumeCommand = nextJson(nextDevice, "command");
    nextDevice.send(JSON.stringify({
      protocol: "live-listen.device.v1",
      type: "device.hello",
      deviceId: "owner",
      sentAt: "2026-05-03T12:00:02.000Z",
      lastStreamId: accepted.snapshot.audioFlow.streamId,
      lastGeneration: accepted.snapshot.audioFlow.generation,
      lastSeq: 0,
      mediaState: playableMediaState(),
    }));

    expect(await resumeCommand).toMatchObject({
      type: "command",
      command: {
        type: "stream.resume",
        streamId: accepted.snapshot.audioFlow.streamId,
        generation: accepted.snapshot.audioFlow.generation,
        fromSeq: 1,
      },
    });
  });

  it("emits observer telemetry without counting observers as listeners", async () => {
    const stub = liveListenStub();
    const observer = await openSocket(stub, "observe?workspaceId=pulse-demo&roomId=live-listen:owner");

    const telemetry = await nextJson(observer, "telemetry");

    expect(telemetry).toMatchObject({
      protocol: "live-listen.observe.v1",
      type: "telemetry",
      snapshot: {
        roomId: "live-listen:owner",
        listeners: { activeCount: 0, graceCount: 0 },
        chunksIn: 0,
        chunksOut: 0,
      },
    });
  });
});
