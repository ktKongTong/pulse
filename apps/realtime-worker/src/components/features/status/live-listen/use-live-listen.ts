import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { joinLiveListen, leaveLiveListen, liveListenDefaults, liveListenParticipantId } from "@/lib/live-listen";

type LiveListenConnectionState = "idle" | "joining" | "connected" | "listening" | "error";

const MEDIA_ROOM_ID = "room-test-1";
const INITIAL_BUFFER_SECONDS = 3;

export type LiveListenMediaRoomStats = {
  chunkCount: number;
  queuedSeconds: number;
  receivedBytes: number;
  receiveBitrateKbps: number | null;
  lastChunkBytes: number;
};

export function useLiveListen() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const lastBitrateSampleRef = useRef({ at: 0, bytes: 0 });
  const [connectionState, setConnectionState] = useState<LiveListenConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveListenMediaRoomStats>({
    chunkCount: 0,
    queuedSeconds: 0,
    receivedBytes: 0,
    receiveBitrateKbps: null,
    lastChunkBytes: 0,
  });

  const join = useCallback(async () => {
    if (connectionState === "joining" || connectionState === "connected" || connectionState === "listening") return;
    setConnectionState("joining");
    setError(null);

    try {
      const defaults = liveListenDefaults();
      const participantId = participantIdRef.current ?? liveListenParticipantId();
      participantIdRef.current = participantId;
      await joinLiveListen({
        workspaceId: defaults.workspaceId,
        roomId: defaults.roomId,
        participantId,
      });
      joinedRef.current = true;

      const audioContext = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      nextStartTimeRef.current = audioContext.currentTime + INITIAL_BUFFER_SECONDS;
      lastBitrateSampleRef.current = { at: performance.now(), bytes: 0 };
      setStats({
        chunkCount: 0,
        queuedSeconds: INITIAL_BUFFER_SECONDS,
        receivedBytes: 0,
        receiveBitrateKbps: null,
        lastChunkBytes: 0,
      });

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/media-room/${MEDIA_ROOM_ID}?role=consumer`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        setConnectionState("connected");
        socket.send("stats");
      };
      socket.onclose = () => {
        setConnectionState((current) => current === "idle" ? current : "idle");
      };
      socket.onerror = () => {
        setConnectionState("error");
        setError("media_room_ws_error");
      };
      socket.onmessage = async (event) => {
        if (typeof event.data === "string") {
          console.log("media-room control", event.data);
          return;
        }
        try {
          await scheduleAudioChunk(event.data, audioContext);
          setConnectionState("listening");
        } catch (cause) {
          setConnectionState("error");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      };
    } catch (cause) {
      if (joinedRef.current && participantIdRef.current) {
        joinedRef.current = false;
        leaveLiveListen({ participantId: participantIdRef.current }).catch(() => undefined);
      }
      setConnectionState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [connectionState]);

  const leave = useCallback(() => {
    socketRef.current?.close(1000, "listener leave");
    socketRef.current = null;
    if (joinedRef.current && participantIdRef.current) {
      joinedRef.current = false;
      leaveLiveListen({ participantId: participantIdRef.current }).catch(() => undefined);
    }
    setConnectionState("idle");
  }, []);

  const scheduleAudioChunk = useCallback(async (arrayBuffer: ArrayBuffer, audioContext: AudioContext) => {
    // 每个 native chunk 是独立 WAV；decode 后按 Web Audio 时间线首尾相接。
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const source = audioContext.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(audioContext.destination);

    const start = Math.max(audioContext.currentTime, nextStartTimeRef.current);
    source.start(start);
    nextStartTimeRef.current = start + decodedBuffer.duration;

    setStats((current) => {
      const receivedBytes = current.receivedBytes + arrayBuffer.byteLength;
      const now = performance.now();
      const elapsedMs = now - lastBitrateSampleRef.current.at;
      let receiveBitrateKbps = current.receiveBitrateKbps;
      if (elapsedMs >= 1000) {
        const deltaBytes = receivedBytes - lastBitrateSampleRef.current.bytes;
        receiveBitrateKbps = (deltaBytes * 8) / elapsedMs;
        lastBitrateSampleRef.current = { at: now, bytes: receivedBytes };
      }
      return {
        chunkCount: current.chunkCount + 1,
        queuedSeconds: Math.max(0, nextStartTimeRef.current - audioContext.currentTime),
        receivedBytes,
        receiveBitrateKbps,
        lastChunkBytes: arrayBuffer.byteLength,
      };
    });
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.close(1000, "component unmount");
      socketRef.current = null;
      if (joinedRef.current && participantIdRef.current) {
        joinedRef.current = false;
        leaveLiveListen({ participantId: participantIdRef.current }).catch(() => undefined);
      }
    };
  }, []);

  return useMemo(() => ({
    canJoin: true,
    connectionState,
    error,
    join,
    leave,
    stats,
  }), [connectionState, error, join, leave, stats]);
}
