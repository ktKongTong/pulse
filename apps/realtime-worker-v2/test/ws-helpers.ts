import {
  CLIENT_WS_PROTOCOL,
  DEVICE_CONNECTION_PROTOCOL,
  DEVICE_MEDIA_CONNECTION_PROTOCOL,
  DEVICE_MEDIA_PROTOCOL,
} from "@ktfun/pulse-protocol";
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

export function nextBinaryMessage(socket: WebSocket): Promise<MessageEvent["data"]> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (typeof event.data === "string") return;
      socket.removeEventListener("message", listener);
      resolve(event.data);
    };
    socket.addEventListener("message", listener);
  });
}

export function tick(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectClient(
  env: Env,
  tabId: string,
) {
  const global = env.GLOBAL_DO.getByName("global");
  const claim = await global.claimSession({ protocol: CLIENT_WS_PROTOCOL, sdkVersion: "test" });
  const client = (await global.fetch(wsRequest("https://pulse.test/api/v1/client/ws"))).webSocket!;
  client.accept();
  client.send(JSON.stringify({
    protocol: CLIENT_WS_PROTOCOL,
    type: "hello",
    supportedProtocols: [CLIENT_WS_PROTOCOL],
    sdkVersion: "test",
    sessionId: claim.sessionId,
    tabId,
  }));
  await nextMessage(client); // hello_ack
  await nextMessage(client); // snapshot
  const state = await nextMessage(client); // state
  return { global, claim, client, state };
}

export async function connectDevice(env: Env, deviceId = "owner") {
  const device = env.DEVICE_DO.getByName(deviceId);
  const common = (await device.fetch(wsRequest(`https://pulse.test/api/v1/device/ws?deviceId=${deviceId}`))).webSocket!;
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
  return { device, common, deviceId, deviceSessionId: ack.payload.deviceSessionId };
}

export async function connectDeviceMedia(env: Env, media: DurableObjectStub, deviceSessionId: string, deviceId = "owner") {
  const socket = (await media.fetch(wsRequest(`https://pulse.test/api/v1/device/media/ws?deviceId=${deviceId}&deviceSessionId=${deviceSessionId}`))).webSocket!;
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
