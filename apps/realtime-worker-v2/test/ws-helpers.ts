import {
  CLIENT_COMMON_WS_PROTOCOL,
  CLIENT_MEDIA_WS_PROTOCOL,
  DEVICE_CONNECTION_PROTOCOL,
  DEVICE_MEDIA_CONNECTION_PROTOCOL,
  DEVICE_MEDIA_PROTOCOL,
} from "@pulse/v2-realtime-protocol";
import type { Env } from "../src/env";

export function wsRequest(url: string) {
  return new Request(url, { headers: { Upgrade: "websocket" } });
}

export function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => {
      resolve(JSON.parse(String(event.data)));
    }, { once: true });
  });
}

export function nextRawMessage(socket: WebSocket): Promise<MessageEvent["data"]> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(event.data), { once: true });
  });
}

export function tick(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectCommon(
  env: Env,
  tabId: string,
) {
  const global = env.GLOBAL_DO.getByName("global");
  const claim = await global.claimSession({ protocol: CLIENT_COMMON_WS_PROTOCOL, sdkVersion: "test" });
  const common = (await global.fetch(wsRequest("https://pulse.test/api/v1/client/ws"))).webSocket!;
  common.accept();
  common.send(JSON.stringify({
    protocol: CLIENT_COMMON_WS_PROTOCOL,
    type: "hello",
    supportedProtocols: [CLIENT_COMMON_WS_PROTOCOL],
    sdkVersion: "test",
    sessionId: claim.sessionId,
    tabId,
  }));
  await nextMessage(common);
  await nextMessage(common);
  return { global, claim, common };
}

export async function connectDevice(env: Env) {
  const device = env.DEVICE_DO.getByName("owner");
  const common = (await device.fetch(wsRequest("https://pulse.test/api/v1/device/ws?deviceId=owner"))).webSocket!;
  common.accept();
  common.send(JSON.stringify({
    protocol: DEVICE_CONNECTION_PROTOCOL,
    type: "hello",
    payload: {
      device: { name: "Mac", platform: "macos" },
      capabilities: { focusApp: true, windowTitle: true, pageTitle: true, pageUrl: true },
      supportedProtocols: [DEVICE_CONNECTION_PROTOCOL],
    },
  }));
  const ack = await nextMessage(common) as { payload: { deviceSessionId: string } };
  return { device, common, deviceSessionId: ack.payload.deviceSessionId };
}

export async function connectDeviceMedia(env: Env, media: DurableObjectStub, deviceSessionId: string) {
  const socket = (await media.fetch(wsRequest(`https://pulse.test/api/v1/device/media/ws?deviceSessionId=${deviceSessionId}`))).webSocket!;
  socket.accept();
  socket.send(JSON.stringify({
    protocol: DEVICE_MEDIA_CONNECTION_PROTOCOL,
    type: "hello",
    payload: {
      capabilities: { media: true, localPlayback: true, remotePlayback: false, binaryAudio: true },
      audio: { codecs: ["pcm16-wav"] },
      supportedProtocols: [DEVICE_MEDIA_PROTOCOL],
    },
  }));
  await nextMessage(socket);
  return socket;
}

export async function connectClientMedia(
  media: DurableObjectStub,
  sessionId: string,
  tabId: string,
) {
  const socket = (await media.fetch(wsRequest("https://pulse.test/api/v1/client/media/ws"))).webSocket!;
  socket.accept();
  socket.send(JSON.stringify({
    protocol: CLIENT_MEDIA_WS_PROTOCOL,
    type: "hello",
    supportedProtocols: [CLIENT_MEDIA_WS_PROTOCOL],
    sdkVersion: "test",
    sessionId,
    tabId,
  }));
  await nextMessage(socket);
  return socket;
}

export function sendReadyStreamState(socket: WebSocket) {
  socket.send(JSON.stringify({
    protocol: DEVICE_MEDIA_PROTOCOL,
    type: "stream.state.updated",
    payload: {
      sentAt: new Date().toISOString(),
      state: { permission: "allow", playback: "playing", capture: "no-capture" },
    },
  }));
}
