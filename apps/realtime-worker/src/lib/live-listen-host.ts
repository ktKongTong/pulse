import {
  LiveListenHostHeartbeatRequestSchema,
  LiveListenHostStartRequestSchema,
  LiveListenHostStopRequestSchema,
  type LiveListenAudioSession,
  type LiveListenClock,
  type LiveListenMedia,
  type LiveListenSnapshot,
  LiveListenSnapshotSchema,
  LiveListenTokenResponseSchema,
  type LiveListenTokenResponse,
} from "@pulse/realtime-protocol";

import { liveListenDefaults } from "./live-listen";

export async function startLiveListenHost(init: {
  apiKey: string;
  workspaceId?: string;
  roomId?: string;
  hostDeviceId: string;
  audio?: LiveListenAudioSession;
  signal?: AbortSignal;
}): Promise<LiveListenTokenResponse> {
  const defaults = liveListenDefaults();
  const payload = LiveListenHostStartRequestSchema.parse({
    workspaceId: init.workspaceId ?? defaults.workspaceId,
    roomId: init.roomId ?? defaults.roomId,
    hostDeviceId: init.hostDeviceId,
    requestedAt: new Date().toISOString(),
    audio: init.audio,
  });
  const response = await fetch("/api/v1/live-listen/host/start", {
    method: "POST",
    headers: hostHeaders(init.apiKey),
    body: JSON.stringify(payload),
    signal: init.signal,
  });
  if (!response.ok) throw new Error(`live_listen_host_start_failed:${response.status}`);
  return LiveListenTokenResponseSchema.parse(await response.json());
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
  const defaults = liveListenDefaults();
  const payload = LiveListenHostHeartbeatRequestSchema.parse({
    workspaceId: init.workspaceId ?? defaults.workspaceId,
    roomId: init.roomId ?? defaults.roomId,
    hostDeviceId: init.hostDeviceId,
    sentAt: new Date().toISOString(),
    audio: init.audio,
    media: init.media,
    clock: init.clock,
  });
  const response = await fetch("/api/v1/live-listen/host/heartbeat", {
    method: "POST",
    headers: hostHeaders(init.apiKey),
    body: JSON.stringify(payload),
    signal: init.signal,
  });
  if (!response.ok) throw new Error(`live_listen_host_heartbeat_failed:${response.status}`);
  return LiveListenSnapshotSchema.parse(await response.json());
}

export async function stopLiveListenHost(init: {
  apiKey: string;
  workspaceId?: string;
  roomId?: string;
  hostDeviceId: string;
  reason?: string;
  signal?: AbortSignal;
}): Promise<LiveListenSnapshot> {
  const defaults = liveListenDefaults();
  const payload = LiveListenHostStopRequestSchema.parse({
    workspaceId: init.workspaceId ?? defaults.workspaceId,
    roomId: init.roomId ?? defaults.roomId,
    hostDeviceId: init.hostDeviceId,
    stoppedAt: new Date().toISOString(),
    reason: init.reason,
  });
  const response = await fetch("/api/v1/live-listen/host/stop", {
    method: "POST",
    headers: hostHeaders(init.apiKey),
    body: JSON.stringify(payload),
    signal: init.signal,
  });
  if (!response.ok) throw new Error(`live_listen_host_stop_failed:${response.status}`);
  return LiveListenSnapshotSchema.parse(await response.json());
}

function hostHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}
