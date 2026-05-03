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
  lastSeq: number | null;
  replayedChunks: number;
  missedChunks: number;
  availableFromSeq: number | null;
  latestSeq: number | null;
};

type MediaRoomAudioChunkEnvelope = {
  type: "audio-chunk";
  protocol: "pulse.media-room.v1";
  seq: number;
  durationMs: number;
  codec: "pcm16-wav";
  byteLength: number;
  data: string;
  replayed?: true;
};

type MediaRoomReplayMissEnvelope = {
  type: "replay-miss";
  protocol: "pulse.media-room.v1";
  requestedFromSeq: number;
  availableFromSeq: number;
  latestSeq: number;
};

type MediaRoomStatsEnvelope = {
  type: "stats" | "connected";
  protocol?: "pulse.media-room.v1";
  availableFromSeq?: number;
  latestSeq?: number;
  nextSeq?: number;
};

export function useLiveListen() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const lastSeqRef = useRef<number | null>(null);
  const lastBitrateSampleRef = useRef({ at: 0, bytes: 0 });
  const [connectionState, setConnectionState] = useState<LiveListenConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveListenMediaRoomStats>({
    chunkCount: 0,
    queuedSeconds: 0,
    receivedBytes: 0,
    receiveBitrateKbps: null,
    lastChunkBytes: 0,
    lastSeq: null,
    replayedChunks: 0,
    missedChunks: 0,
    availableFromSeq: null,
    latestSeq: null,
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
      setStats((current) => ({
        chunkCount: 0,
        queuedSeconds: INITIAL_BUFFER_SECONDS,
        receivedBytes: 0,
        receiveBitrateKbps: null,
        lastChunkBytes: 0,
        lastSeq: lastSeqRef.current,
        replayedChunks: 0,
        missedChunks: current.missedChunks,
        availableFromSeq: current.availableFromSeq,
        latestSeq: current.latestSeq,
      }));

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({ role: "consumer" });
      if (lastSeqRef.current != null) params.set("fromSeq", String(lastSeqRef.current + 1));
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/media-room/${MEDIA_ROOM_ID}?${params}`);
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
        if (typeof event.data !== "string") return;
        try {
          const parsed = JSON.parse(event.data) as
            | MediaRoomAudioChunkEnvelope
            | MediaRoomReplayMissEnvelope
            | MediaRoomStatsEnvelope
            | { type?: string };
          if (parsed.type === "audio-chunk") {
            await scheduleAudioChunk(base64ToArrayBuffer(parsed.data), audioContext, parsed);
            setConnectionState("listening");
            return;
          }
          if (parsed.type === "replay-miss") {
            lastSeqRef.current = parsed.latestSeq || null;
            nextStartTimeRef.current = audioContext.currentTime + INITIAL_BUFFER_SECONDS;
            setStats((current) => ({
              ...current,
              missedChunks: current.missedChunks + 1,
              availableFromSeq: parsed.availableFromSeq,
              latestSeq: parsed.latestSeq,
              lastSeq: lastSeqRef.current,
            }));
            return;
          }
          if (parsed.type === "stats" || parsed.type === "connected") {
            setStats((current) => ({
              ...current,
              availableFromSeq: parsed.availableFromSeq ?? current.availableFromSeq,
              latestSeq: parsed.latestSeq ?? current.latestSeq,
            }));
          }
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

  const scheduleAudioChunk = useCallback(async (
    arrayBuffer: ArrayBuffer,
    audioContext: AudioContext,
    envelope: MediaRoomAudioChunkEnvelope,
  ) => {
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const source = audioContext.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(audioContext.destination);

    const start = Math.max(audioContext.currentTime, nextStartTimeRef.current);
    source.start(start);
    nextStartTimeRef.current = start + decodedBuffer.duration;
    lastSeqRef.current = envelope.seq;

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
        ...current,
        chunkCount: current.chunkCount + 1,
        queuedSeconds: Math.max(0, nextStartTimeRef.current - audioContext.currentTime),
        receivedBytes,
        receiveBitrateKbps,
        lastChunkBytes: arrayBuffer.byteLength,
        lastSeq: envelope.seq,
        replayedChunks: current.replayedChunks + (envelope.replayed ? 1 : 0),
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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
