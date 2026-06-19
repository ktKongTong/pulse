import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  CLIENT_PAGE_WS_PROTOCOL,
  CLIENT_WS_PROTOCOL,
  DEVICE_MEDIA_PROTOCOL,
  PRESENCE_PROTOCOL,
} from "@ktfun/pulse-protocol";
import app from "../src/index";
import type { Env } from "../src/env";
import {
  connectClient,
  connectDevice,
  connectDeviceMedia,
  nextBinaryMessage,
  nextMessage,
  sendReadyStreamState,
  tick,
  wsRequest,
} from "./ws-helpers";

const ownerMedia = (env as Env).MEDIA_DO.getByName("owner");

describe("realtime-worker-v2 client ws", () => {
  it("claims a session and connects the single client ws", async () => {
    const { client } = await connectClient(env as Env, "tab-1");
    client.close();
    await tick();
  });

  it("removed the legacy /api/v1/client/media/ws endpoint", async () => {
    const res = await app.fetch(new Request("https://pulse.test/api/v1/client/media/ws"), {} as Env);
    expect(res.status).toBe(404);
  });

  it("publishes page snapshots through PageDO", async () => {
    const suffix = crypto.randomUUID();
    const page = (env as Env).PAGE_DO.getByName(`page:${suffix}`);
    const { claim, client } = await connectClient(env as Env, "tab-1");
    const pageResponse = await page.fetch(wsRequest("https://pulse.test/api/v1/client/page/ws?canonicalUrl=https%3A%2F%2Fexample.com%2Fa"));
    const pageSocket = pageResponse.webSocket!;
    pageSocket.accept();
    pageSocket.send(JSON.stringify({
      protocol: CLIENT_PAGE_WS_PROTOCOL,
      type: "hello",
      supportedProtocols: [CLIENT_PAGE_WS_PROTOCOL],
      sdkVersion: "test",
      sessionId: claim.sessionId,
      tabId: "tab-1",
      page: { title: "A", url: "https://example.com/a" },
    }));
    expect(await nextMessage(pageSocket)).toMatchObject({ type: "hello_ack" });
    expect(await nextMessage(pageSocket)).toMatchObject({
      type: "snapshot",
      snapshot: { sessions: { totalCount: 1 } },
    });
    client.close();
    pageSocket.close();
    await tick();
  });

  it("does not rebroadcast unchanged device focus just because presence timestamps changed", async () => {
    const { client } = await connectClient(env as Env, `presence-tab-${crypto.randomUUID()}`);
    const device = await connectDevice(env as Env);

    const presence = (sentAt: string) => ({
      protocol: PRESENCE_PROTOCOL,
      type: "snapshot",
      payload: {
        eventId: crypto.randomUUID(),
        seq: Date.parse(sentAt),
        observedAt: sentAt,
        sentAt,
        state: {
          availability: { state: "active", idleSeconds: 0 },
          focus: { app: { id: "com.microsoft.edgemac", name: "Microsoft Edge" } },
        },
      },
    });

    device.common.send(JSON.stringify(presence("2026-05-24T14:53:56.340Z")));
    expect(await nextMessage(client)).toMatchObject({
      type: "snapshot",
      snapshot: { owner: { focus: { app: { id: "com.microsoft.edgemac" } } } },
    });

    device.common.send(JSON.stringify(presence("2026-05-24T14:54:12.397Z")));
    await expect(Promise.race([
      nextMessage(client),
      tick(50).then(() => "no-message"),
    ])).resolves.toBe("no-message");

    client.close();
    device.common.close();
    await tick();
  });

  it("accepts client media stream requests on the single client ws when device source is ready", async () => {
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, ownerMedia, device.deviceSessionId);
    sendReadyStreamState(deviceMedia);
    const { client, state } = await connectClient(env as Env, "media-tab");
    expect(state).toMatchObject({ type: "state", stream: { source: { state: "ready" } } });
    client.send(JSON.stringify({ protocol: CLIENT_WS_PROTOCOL, type: "stream.request", requestId: "req-1" }));
    expect(await nextMessage(client)).toMatchObject({ type: "stream.accepted", requestId: "req-1" });
    expect(await nextMessage(deviceMedia)).toMatchObject({ type: "command", payload: { command: { type: "stream.requested" } } });
    client.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });

  it("reflects named device media state on the single client ws", async () => {
    const device = await connectDevice(env as Env, "pulse");
    const deviceMedia = await connectDeviceMedia(env as Env, ownerMedia, device.deviceSessionId, device.deviceId);
    sendReadyStreamState(deviceMedia);
    const { client, state } = await connectClient(env as Env, "named-device-tab");
    expect(state).toMatchObject({ type: "state", stream: { source: { state: "ready" } } });
    client.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });

  it("keeps client now playing playback aligned with device stream state", async () => {
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, ownerMedia, device.deviceSessionId);
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "media.updated",
      payload: {
        sentAt: "2026-06-09T00:46:43.000Z",
        media: {
          providerId: "spotify",
          itemType: "track",
          trackId: "spotify:track:days-of-dash",
          title: "DAYS of DASH",
          artist: "Konomi Suzuki",
          progressSeconds: 69,
          durationSeconds: 251.879,
          playbackState: "playing",
        },
      },
    }));
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "stream.state.updated",
      payload: {
        sentAt: "2026-06-09T00:46:44.105Z",
        state: {
          permission: "allow",
          playback: "paused",
          capture: "no-capture",
          streamFormat: { codec: "pcm16-wav", sampleRate: 44100, channels: 2, bitDepth: 16 },
        },
      },
    }));
    const { client, state } = await connectClient(env as Env, "media-playback-tab");
    expect(state).toMatchObject({
      type: "state",
      media: {
        playback: "paused",
        current: { playbackState: "paused" },
        updatedAt: "2026-06-09T00:46:44.105Z",
      },
      stream: { source: { state: "idle" } },
    });
    client.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });

  it("marks now playing paused when the device media socket disconnects", async () => {
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, ownerMedia, device.deviceSessionId);
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "media.updated",
      payload: {
        sentAt: "2026-06-09T01:00:00.000Z",
        media: {
          providerId: "spotify",
          itemType: "track",
          trackId: "spotify:track:disconnect",
          title: "Disconnect",
          artist: "Pulse",
          progressSeconds: 42,
          durationSeconds: 180,
          playbackState: "playing",
        },
      },
    }));
    sendReadyStreamState(deviceMedia);
    const { client, state } = await connectClient(env as Env, "media-disconnect-tab");
    expect(state).toMatchObject({
      type: "state",
      media: { playback: "playing", current: { playbackState: "playing" } },
      stream: { source: { state: "ready" } },
    });

    deviceMedia.close();
    expect(await nextMessage(client)).toMatchObject({
      type: "state",
      media: { playback: "paused", current: { playbackState: "paused" } },
      stream: { source: { state: "offline" } },
    });

    client.close();
    device.common.close();
    await tick();
  });

  it("marks now playing paused when the shared device heartbeat lease expires", async () => {
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, ownerMedia, device.deviceSessionId);
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "media.updated",
      payload: {
        sentAt: "2026-06-09T01:10:00.000Z",
        media: {
          providerId: "spotify",
          itemType: "track",
          trackId: "spotify:track:lease",
          title: "Lease",
          artist: "Pulse",
          progressSeconds: 30,
          durationSeconds: 180,
          playbackState: "playing",
        },
      },
    }));
    sendReadyStreamState(deviceMedia);
    const { client, state } = await connectClient(env as Env, "media-lease-tab");
    expect(state).toMatchObject({
      type: "state",
      media: { playback: "playing", current: { playbackState: "playing" } },
      stream: { source: { state: "ready" } },
    });

    const offlineState = nextMessage(client);
    await device.device.checkHeartbeatLease(Date.now() + 151_000);
    expect(await offlineState).toMatchObject({
      type: "state",
      media: { playback: "paused", current: { playbackState: "paused" } },
      stream: { source: { state: "offline" } },
    });

    client.close();
    device.common.close();
    deviceMedia.close();
    await tick();
  });

  it("returns disabled source after device rejects requested stream", async () => {
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, ownerMedia, device.deviceSessionId);
    sendReadyStreamState(deviceMedia);
    const { client } = await connectClient(env as Env, "reject-tab");
    client.send(JSON.stringify({ protocol: CLIENT_WS_PROTOCOL, type: "stream.request", requestId: "req-reject" }));
    await nextMessage(client);
    const command = await nextMessage(deviceMedia) as { payload: { commandId: string } };
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "ack",
      payload: {
        commandId: command.payload.commandId,
        commandType: "stream.requested",
        status: "rejected",
        rejectedReason: "capture_source_unavailable",
        sentAt: new Date().toISOString(),
      },
    }));
    expect(await nextMessage(client)).toMatchObject({
      type: "state",
      stream: { source: { state: "disabled" } },
    });
    client.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });

  it("forwards binary audio chunks on the single client ws and accepts client ack", async () => {
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, ownerMedia, device.deviceSessionId);
    sendReadyStreamState(deviceMedia);
    const { client } = await connectClient(env as Env, "audio-tab");
    client.send(JSON.stringify({ protocol: CLIENT_WS_PROTOCOL, type: "stream.request", requestId: "req-audio" }));
    const accepted = await nextMessage(client) as { stream: { streamId: string; generation: number } };
    const command = await nextMessage(deviceMedia) as { payload: { commandId: string } };
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "ack",
      payload: {
        commandId: command.payload.commandId,
        commandType: "stream.requested",
        status: "accepted",
        streamId: accepted.stream.streamId,
        generation: accepted.stream.generation,
        firstSeq: 1,
        streamFormat: { codec: "pcm16-wav", sampleRate: 48000, channels: 2 },
        sentAt: new Date().toISOString(),
      },
    }));
    const audioFramePromise = nextMessage(client);
    const rawAudioPromise = nextBinaryMessage(client);
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "audio.chunk",
      payload: {
        streamId: accepted.stream.streamId,
        generation: accepted.stream.generation,
        seq: 2,
        sentAt: new Date().toISOString(),
        durationMs: 20,
        byteLength: 4,
        mediaStartPositionMs: 1_000,
      },
    }));
    await tick();
    deviceMedia.send(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(await audioFramePromise).toMatchObject({ type: "audio.chunk", seq: 2, byteLength: 4 });
    const raw = await rawAudioPromise;
    expect(raw instanceof ArrayBuffer || ArrayBuffer.isView(raw) || raw instanceof Blob).toBe(true);
    client.send(JSON.stringify({
      protocol: CLIENT_WS_PROTOCOL,
      type: "ack",
      streamId: accepted.stream.streamId,
      generation: accepted.stream.generation,
      seq: 2,
    }));
    client.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });

  it("does not let unsupported stream sources appear disabled", async () => {
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, ownerMedia, device.deviceSessionId);
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "stream.state.updated",
      payload: {
        sentAt: new Date().toISOString(),
        state: { permission: "disallow", playback: "playing", capture: "no-capture" },
      },
    }));
    const { client, state } = await connectClient(env as Env, "idle-tab");
    expect(state).toMatchObject({
      type: "state",
      stream: { source: { state: "idle" } },
    });
    client.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });
});
