import type { PulseRealtimeV2Config } from "@pulse/v2-realtime-react";
import { pushAudioChunk } from "./audio-stream-player";

export const realtimeConfig: PulseRealtimeV2Config = {
  baseUrl: import.meta.env.VITE_REALTIME_V2_BASE_URL || undefined,
  sdkVersion: "example-v2",
  autoConnectCommon: true,
  autoConnectMedia: true,
  onAudioChunk: pushAudioChunk,
};
