import type { PulseRealtimeV2Config } from "@ktfun/pulse";
import { pushAudioChunk } from "./audio-stream-player";

const baseURL = import.meta.env.VITE_REALTIME_V2_BASE_URL ||
  'https://pulse.koft.fun'
console.log(baseURL)
export const realtimeConfig: PulseRealtimeV2Config = {
  baseUrl: baseURL,
  sdkVersion: "example-v2",
  autoConnectCommon: true,
  autoConnectMedia: true,
  onAudioChunk: pushAudioChunk,
};
