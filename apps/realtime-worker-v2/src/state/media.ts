import type {
  ClientMediaNowPlaying,
  ClientMediaStreamSource,
  DeviceStreamState,
  StreamCodec,
  StreamFormat,
} from "@ktfun/pulse-protocol";

export interface DeviceMediaConnection {
  connectionId: string;
  deviceId: string;
  deviceSessionId: string;
  connectedAt: string;
  capabilities: { streaming: boolean };
}

export interface MediaClientConnection {
  connectionId: string;
  sessionId: string;
  tabId: string;
  connectedAt: string;
  lastSeenAt: string;
}

export interface ClientAttachment {
  kind: "client";
  connectionId: string;
  sessionId: string;
  tabId: string;
}

export interface DeviceAttachment {
  kind: "device";
  connectionId: string;
  deviceId: string;
  deviceSessionId: string;
}

export interface PendingDeviceAttachment {
  kind: "pending-device";
  deviceSessionId: string;
}

export interface StreamClient {
  connectionId: string;
  sessionId: string;
  tabId: string;
  acceptedAt: string;
  lastAckSeq?: number;
}

export interface StreamContext {
  streamId: string;
  generation: number;
  latestSeq: number;
  availableFromSeq: number;
  codec: StreamCodec;
  format?: StreamFormat;
  openedAt: string;
  updatedAt: string;
}

export interface AudioChunkMeta {
  streamId: string;
  generation: number;
  seq: number;
  sentAt: string;
  durationMs: number;
  byteLength: number;
  codec: StreamCodec;
}

export interface PendingDeviceCommand {
  commandId: string;
  type: "stream.requested" | "stream.stop";
  streamId?: string;
  generation?: number;
  expiresAt: string;
}

export interface BufferedAudioChunk {
  meta: AudioChunkMeta;
  bytes: ArrayBuffer;
}

export interface MediaStoredState {
  device: DeviceMediaConnection | null;
  deviceStreamState: DeviceStreamState | null;
  currentMedia: ClientMediaNowPlaying | null;
  streamContext: StreamContext | null;
  pendingCommand: PendingDeviceCommand | null;
  streamRequestRejectedAt?: string;
  revision: number;
  updatedAt: string;
}

export function emptyMediaState(now: string): MediaStoredState {
  return {
    device: null,
    deviceStreamState: null,
    currentMedia: null,
    streamContext: null,
    pendingCommand: null,
    revision: 0,
    updatedAt: now,
  };
}

export function sourceFromState(state: MediaStoredState): ClientMediaStreamSource {
  if (state.streamRequestRejectedAt) return { state: "disabled" };
  if (!state.device) return { state: "offline" };
  if (!state.device.capabilities.streaming) return { state: "idle" };
  const stream = state.deviceStreamState;
  if (!stream) return { state: "offline" };
  if (stream.permission === "disallow") return { state: "idle" };
  if (stream.playback !== "playing") return { state: "idle" };
  return { state: "ready" };
}

export function mediaStateFrame(state: MediaStoredState) {
  return {
    protocol: "client.media.ws.v1" as const,
    type: "state" as const,
    revision: state.revision,
    updatedAt: state.updatedAt,
    media: state.currentMedia,
    stream: { source: sourceFromState(state) },
  };
}
