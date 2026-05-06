import {
  LIVE_LISTEN_DEVICE_PROTOCOL_V1,
  type LiveListenAudioSession,
  type LiveListenClock,
  type LiveListenMedia,
  type LiveListenSnapshot,
  LiveListenSnapshotSchema,
  type LiveListenTokenResponse,
} from "@pulse/realtime-protocol";

import { fetchLiveListenSnapshot, liveListenDefaults } from "./live-listen";

let deviceSocket: WebSocket | null = null;

export async function startLiveListenHost(init: {
  apiKey: string;
  workspaceId?: string;
  roomId?: string;
  hostDeviceId: string;
  audio?: LiveListenAudioSession;
  signal?: AbortSignal;
}): Promise<LiveListenTokenResponse> {
  const socket = await openDeviceSession(init);
  socket.send(JSON.stringify({
    protocol: LIVE_LISTEN_DEVICE_PROTOCOL_V1,
    type: "device.hello",
    deviceId: init.hostDeviceId,
    sentAt: new Date().toISOString(),
    capabilities: {
      binaryAudio: false,
      localRingBuffer: false,
    },
    mediaState: {
      permission: "allow",
      playback: "playing",
      capture: "no-capture",
      media: {
        provider: "local",
        title: init.audio?.roomName ?? "Live Listen host audio",
        playbackState: "playing",
      },
    },
  }));
  const snapshot = await fetchSnapshot(init);
  return legacyTokenResponse(snapshot, init.hostDeviceId);
}

export async function heartbeatLiveListenHost(init: {
  apiKey: string;
  workspaceId?: string;
  roomId?: string;
  hostDeviceId: string;
  audio?: LiveListenAudioSession;
  media?: LiveListenMedia;
  clock?: LiveListenClock;
  signal?: AbortSignal;
}): Promise<LiveListenSnapshot> {
  const socket = await openDeviceSession(init);
  socket.send(JSON.stringify({
    protocol: LIVE_LISTEN_DEVICE_PROTOCOL_V1,
    type: "media.updated",
    deviceId: init.hostDeviceId,
    sentAt: new Date().toISOString(),
    media: init.media ?? {
      provider: "local",
      title: init.audio?.roomName ?? "Live Listen host audio",
      playbackState: "playing",
    },
    clock: init.clock,
  }));
  return fetchSnapshot(init);
}

export async function stopLiveListenHost(init: {
  apiKey: string;
  workspaceId?: string;
  roomId?: string;
  hostDeviceId: string;
  reason?: string;
  signal?: AbortSignal;
}): Promise<LiveListenSnapshot> {
  const socket = deviceSocket;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      protocol: LIVE_LISTEN_DEVICE_PROTOCOL_V1,
      type: "stream.stopped",
      streamId: "stream_unknown",
      generation: 1,
      reason: "manual_stop",
      sentAt: new Date().toISOString(),
    }));
    socket.close(1000, init.reason ?? "manual_stop");
  }
  deviceSocket = null;
  return fetchSnapshot(init);
}

async function openDeviceSession(init: {
  apiKey: string;
  workspaceId?: string;
  roomId?: string;
  hostDeviceId: string;
  signal?: AbortSignal;
}) {
  if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) return deviceSocket;

  const defaults = liveListenDefaults();
  const params = new URLSearchParams();
  params.set("workspaceId", init.workspaceId ?? defaults.workspaceId);
  params.set("roomId", init.roomId ?? defaults.roomId);
  params.set("deviceId", init.hostDeviceId);
  params.set("apiKey", init.apiKey);
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/live-listen/device-session?${params}`);
  deviceSocket = socket;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      socket.close(1000, "aborted");
      reject(new Error("live_listen_device_session_aborted"));
    };
    init.signal?.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () => {
      init.signal?.removeEventListener("abort", abort);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      init.signal?.removeEventListener("abort", abort);
      reject(new Error("live_listen_device_session_ws_error"));
    }, { once: true });
    socket.addEventListener("close", () => {
      if (deviceSocket === socket) deviceSocket = null;
    });
  });
  return socket;
}

async function fetchSnapshot(init: {
  workspaceId?: string;
  roomId?: string;
  signal?: AbortSignal;
}) {
  return LiveListenSnapshotSchema.parse(await fetchLiveListenSnapshot(init));
}

function legacyTokenResponse(snapshot: LiveListenSnapshot, participantId: string): LiveListenTokenResponse {
  return {
    protocol: "live-listen.server.v1",
    workspaceId: snapshot.workspaceId,
    roomId: snapshot.roomId,
    snapshot,
    token: {
      transport: "cloudflare-realtime",
      sessionId: `pulse:${snapshot.workspaceId}:${snapshot.roomId}`,
      participantId,
      role: "host",
      token: "device-session",
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    },
  };
}
