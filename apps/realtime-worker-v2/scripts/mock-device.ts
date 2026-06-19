import {
  DEVICE_WS_PROTOCOL,
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
  const socket = await connectJsonSocket(deviceWsUrl());
  socket.onJson((frame) => handleServerFrame(socket, frame));
  socket.sendJson({
    protocol: DEVICE_WS_PROTOCOL,
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
      media: {
        capabilities: {
          media: true,
          localPlayback: true,
          remotePlayback: false,
          binaryAudio: true,
          localRingBuffer: true,
          localRingBufferSeconds: 30,
        },
        audio: { codecs: ["mp3"], chunkDurationMs: 200 },
      },
      supportedProtocols: [DEVICE_MEDIA_PROTOCOL],
    },
  });

  const ack = await socket.nextJson();
  const deviceSessionId = readDeviceSessionId(ack);
  console.log(`device connected: ${deviceSessionId}`);
  socket.sendJson(buildStreamReady());
  publishTick(socket);
  setInterval(() => publishTick(socket), 60_000);
}

function publishTick(socket: JsonSocket) {
  const seq = tickSeq;
  tickSeq += 1;
  const index = seq % tracks.length;
  const now = new Date().toISOString();
  socket.sendJson(buildPresenceSnapshot({
    seq,
    sentAt: now,
    focus: focusApps[index % focusApps.length],
  }));
  socket.sendJson(buildMediaUpdate({
    seq,
    sentAt: now,
    track: tracks[index],
  }));
}

function handleServerFrame(socket: JsonSocket, frame: JsonObject) {
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
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
