import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  CLIENT_COMMON_WS_PROTOCOL,
  CLIENT_MEDIA_WS_PROTOCOL,
  CLIENT_PAGE_WS_PROTOCOL,
  DEVICE_MEDIA_PROTOCOL,
} from "@pulse/v2-realtime-protocol";
import type { Env } from "../src/env";
import {
  connectClientMedia,
  connectCommon,
  connectDevice,
  connectDeviceMedia,
  nextMessage,
  nextRawMessage,
  sendReadyStreamState,
  tick,
  wsRequest,
} from "./ws-helpers";

describe("realtime-worker-v2 client ws", () => {
  it("claims a session and connects common ws", async () => {
    const { common } = await connectCommon(env as Env, "tab-1");
    common.close();
    await tick();
  });

  it("publishes page snapshots through PageDO", async () => {
    const suffix = crypto.randomUUID();
    const page = (env as Env).PAGE_DO.getByName(`page:${suffix}`);
    const { claim, common } = await connectCommon(env as Env, "tab-1");
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
    common.close();
    pageSocket.close();
    await tick();
  });

  it("accepts client media stream requests when device source is ready", async () => {
    const media = (env as Env).MEDIA_DO.getByName(`media:${crypto.randomUUID()}`);
    const { claim, common } = await connectCommon(env as Env, "media-tab");
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, media, device.deviceSessionId);
    sendReadyStreamState(deviceMedia);
    const clientMedia = await connectClientMedia(media, claim.sessionId, "media-tab");
    expect(await nextMessage(clientMedia)).toMatchObject({ type: "state", stream: { source: { state: "ready" } } });
    clientMedia.send(JSON.stringify({ protocol: CLIENT_MEDIA_WS_PROTOCOL, type: "stream.request", requestId: "req-1" }));
    expect(await nextMessage(clientMedia)).toMatchObject({ type: "stream.accepted", requestId: "req-1" });
    expect(await nextMessage(deviceMedia)).toMatchObject({ type: "command", payload: { command: { type: "stream.requested" } } });
    common.close();
    clientMedia.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });

  it("returns disabled source after device rejects requested stream", async () => {
    const media = (env as Env).MEDIA_DO.getByName(`media:${crypto.randomUUID()}`);
    const { claim, common } = await connectCommon(env as Env, "reject-tab");
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, media, device.deviceSessionId);
    sendReadyStreamState(deviceMedia);
    const clientMedia = await connectClientMedia(media, claim.sessionId, "reject-tab");
    await nextMessage(clientMedia);
    clientMedia.send(JSON.stringify({ protocol: CLIENT_MEDIA_WS_PROTOCOL, type: "stream.request", requestId: "req-reject" }));
    await nextMessage(clientMedia);
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
    expect(await nextMessage(clientMedia)).toMatchObject({
      type: "state",
      stream: { source: { state: "disabled" } },
    });
    common.close();
    clientMedia.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });

  it("forwards binary audio chunks and accepts client ack", async () => {
    const media = (env as Env).MEDIA_DO.getByName(`media:${crypto.randomUUID()}`);
    const { claim, common } = await connectCommon(env as Env, "audio-tab");
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, media, device.deviceSessionId);
    sendReadyStreamState(deviceMedia);
    const clientMedia = await connectClientMedia(media, claim.sessionId, "audio-tab");
    await nextMessage(clientMedia);
    clientMedia.send(JSON.stringify({ protocol: CLIENT_MEDIA_WS_PROTOCOL, type: "stream.request", requestId: "req-audio" }));
    const accepted = await nextMessage(clientMedia) as { stream: { streamId: string; generation: number } };
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
      },
    }));
    deviceMedia.send(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(await nextMessage(clientMedia)).toMatchObject({ type: "audio.chunk", seq: 2, byteLength: 4 });
    const raw = await nextRawMessage(clientMedia);
    expect(raw instanceof ArrayBuffer || raw instanceof Blob).toBe(true);
    clientMedia.send(JSON.stringify({
      protocol: CLIENT_MEDIA_WS_PROTOCOL,
      type: "ack",
      streamId: accepted.stream.streamId,
      generation: accepted.stream.generation,
      seq: 2,
    }));
    common.close();
    clientMedia.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });

  it("does not let unsupported stream sources appear disabled", async () => {
    const media = (env as Env).MEDIA_DO.getByName(`media:${crypto.randomUUID()}`);
    const { claim, common } = await connectCommon(env as Env, "idle-tab");
    const device = await connectDevice(env as Env);
    const deviceMedia = await connectDeviceMedia(env as Env, media, device.deviceSessionId);
    deviceMedia.send(JSON.stringify({
      protocol: DEVICE_MEDIA_PROTOCOL,
      type: "stream.state.updated",
      payload: {
        sentAt: new Date().toISOString(),
        state: { permission: "disallow", playback: "playing", capture: "no-capture" },
      },
    }));
    const clientMedia = await connectClientMedia(media, claim.sessionId, "idle-tab");
    expect(await nextMessage(clientMedia)).toMatchObject({
      type: "state",
      stream: { source: { state: "idle" } },
    });
    common.close();
    clientMedia.close();
    deviceMedia.close();
    device.common.close();
    await tick();
  });
});
