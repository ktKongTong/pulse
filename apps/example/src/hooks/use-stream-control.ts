import {
  useClientStreamControlState,
  usePulseRealtimeV2Client,
} from "@pulse/v2-realtime-react";
import { unlockAudioStream } from "../lib/audio-stream-player";

export const useStreamControl = () => {
    const client = usePulseRealtimeV2Client();
    const { streaming, streamable, disabled } = useClientStreamControlState();
    const request = () => {
        if (!streamable) return;
        unlockAudioStream();
        client.requestStream()
    }
    const stop = () => {
        if (streaming) client.stopStream()
    }
    return {
        streaming,
        streamable,
        disabled,
        requestStream: request,
        stopStream: stop
    }
}
