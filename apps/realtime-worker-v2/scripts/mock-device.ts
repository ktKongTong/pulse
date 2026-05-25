import {
  DEVICE_CONNECTION_PROTOCOL,
  DEVICE_MEDIA_CONNECTION_PROTOCOL,
  DEVICE_MEDIA_PROTOCOL,
} from "@ktfun/pulse-protocol";
import {
  buildMediaUpdate,
  buildPresenceSnapshot,
  buildStreamReady,
  focusApps,
  tracks,
} from "./mock-device/frames";
import { connectJsonSocket, type JsonObject, type JsonSocket } from "./mock-device/socket";
import {
  createActiveStream,
  startMp3Stream,
  stopMp3Stream,
  streamRequestedAck,
  streamStoppedAck,
  type ActiveStream,
} from "./mock-device/stream";

const baseUrl = process.env.PULSE_V2_WORKER_URL ?? "http://localhost:8787";
const deviceId = process.env.PULSE_V2_DEVICE_ID ?? "owner";
const intervalMs = Number(process.env.PULSE_V2_MOCK_INTERVAL_MS ?? "2000");

let activeStream: ActiveStream | null = null;
let tickSeq = 0;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const common = await connectJsonSocket(deviceWsUrl());
  common.sendJson({
    protocol: DEVICE_CONNECTION_PROTOCOL,
    type: "hello",
    payload: {
      device: {
        name: "Pulse Mock Device",
        platform: "macos",
        appVersion: "mock-v2",
        mode: "mock",
        displayName: "Mock Mac",
      },
      capabilities: {
        focusApp: true,
        windowTitle: true,
        pageTitle: true,
        pageUrl: true,
      },
      supportedProtocols: [DEVICE_CONNECTION_PROTOCOL],
    },
  });

  const deviceSessionId = readDeviceSessionId(await common.nextJson());
  console.log(`device common connected: ${deviceSessionId}`);

  const media = await connectJsonSocket(mediaWsUrl(deviceSessionId));
  media.onJson((frame) => handleMediaServerFrame(media, frame));
  media.sendJson({
    protocol: DEVICE_MEDIA_CONNECTION_PROTOCOL,
    type: "hello",
    payload: {
      capabilities: {
        media: true,
        localPlayback: true,
        remotePlayback: false,
        binaryAudio: true,
        localRingBuffer: true,
        localRingBufferSeconds: 30,
      },
      audio: { codecs: ["mp3"], chunkDurationMs: 200 },
      supportedProtocols: [DEVICE_MEDIA_PROTOCOL],
    },
  });

  await media.nextJson();
  console.log("device media connected");
  media.sendJson(buildStreamReady());
  publishTick(common, media);
  setInterval(() => publishTick(common, media), 60_000);
}

function publishTick(common: JsonSocket, media: JsonSocket) {
  const seq = tickSeq;
  tickSeq += 1;
  const index = seq % tracks.length;
  const now = new Date().toISOString();
  common.sendJson(buildPresenceSnapshot({
    seq,
    sentAt: now,
    focus: focusApps[index % focusApps.length],
  }));
  media.sendJson(buildMediaUpdate({
    seq,
    sentAt: now,
    track: tracks[index],
  }));
}

function handleMediaServerFrame(socket: JsonSocket, frame: JsonObject) {
  if (frame.type !== "command") return;
  const payload = frame.payload as JsonObject;
  const command = payload.command as JsonObject;
  if (command.type === "stream.requested") {
    stopMp3Stream(activeStream);
    activeStream = createActiveStream(String(command.streamId), Number(command.generation));
    socket.sendJson(streamRequestedAck(payload, activeStream));
    startMp3Stream(socket, activeStream);
    return;
  }
  if (command.type === "stream.stop") {
    if (activeStream) socket.sendJson(streamStoppedAck(payload, activeStream));
    stopMp3Stream(activeStream);
    activeStream = null;
  }
}

function readDeviceSessionId(frame: JsonObject) {
  const payload = frame.payload as JsonObject | undefined;
  const deviceSessionId = payload?.deviceSessionId;
  if (typeof deviceSessionId !== "string") {
    throw new Error(`missing deviceSessionId: ${JSON.stringify(frame)}`);
  }
  return deviceSessionId;
}

function deviceWsUrl() {
  const url = new URL("/api/v1/device/ws", baseUrl);
  url.searchParams.set("deviceId", deviceId);
  return toWsUrl(url);
}

function mediaWsUrl(deviceSessionId: string) {
  const url = new URL("/api/v1/device/media/ws", baseUrl);
  url.searchParams.set("deviceSessionId", deviceSessionId);
  return toWsUrl(url);
}

function toWsUrl(url: URL) {
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
