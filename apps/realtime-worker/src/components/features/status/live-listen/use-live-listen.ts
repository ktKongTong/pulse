import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LiveListenMediaSessionEnvelope, LiveListenMediaSessionSnapshot } from "@pulse/realtime-protocol";

import {
  type LiveListenSnapshot,
  liveListenParticipantId,
  liveListenResumeToken,
} from "@/lib/live-listen";
import {
  getLiveListenMediaSessionStoreSnapshot,
  liveListenMediaSessionAck,
  liveListenMediaSessionListenRequest,
  liveListenMediaSessionStop,
  sendLiveListenMediaSessionMessage,
  subscribeLiveListenMediaSessionEvents,
  subscribeLiveListenMediaSessionStore,
} from "@/lib/live-listen-media-session";

type WebLiveListenWsState = "on" | "off" | "half-off" | "error";
type WebLiveListenCommandState = "idle" | "joining" | "leaving" | "reconnecting";
type WebLiveListenStreamable =
  | { value: true }
  | { value: false; reason: string };

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

export function useLiveListen() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const resumeTokenRef = useRef<string | undefined>(undefined);
  const streamRef = useRef<{ streamId?: string; generation?: number }>({});
  const nextStartTimeRef = useRef(0);
  const lastSeqRef = useRef<number | null>(null);
  const lastBitrateSampleRef = useRef({ at: 0, bytes: 0 });
  const shouldReconnectRef = useRef(false);
  const streamingRef = useRef(false);
  const commandRef = useRef<WebLiveListenCommandState>("idle");
  const [ws, setWs] = useState<WebLiveListenWsState>("off");
  const [streaming, setStreaming] = useState(false);
  const [command, setCommand] = useState<WebLiveListenCommandState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LiveListenSnapshot | null>(null);
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
  const mediaSession = useSyncExternalStore(
    subscribeLiveListenMediaSessionStore,
    getLiveListenMediaSessionStoreSnapshot,
    getLiveListenMediaSessionStoreSnapshot,
  );

  useEffect(() => {
    setWs(mediaSession.ws);
    if (mediaSession.snapshot) setSnapshot(snapshotFromMediaSession(mediaSession.snapshot));
  }, [mediaSession.snapshot, mediaSession.ws]);

  useEffect(() => {
    participantIdRef.current ??= liveListenParticipantId();
  }, []);

  useEffect(() => {
    streamingRef.current = streaming;
    commandRef.current = command;
  }, [command, streaming]);

  const resetAudioQueue = useCallback(() => {
    const audioContext = audioContextRef.current;
    if (audioContext) nextStartTimeRef.current = audioContext.currentTime + INITIAL_BUFFER_SECONDS;
  }, []);

  const requestListen = useCallback(async (resuming: boolean) => {
    const participantId = participantIdRef.current ?? liveListenParticipantId();
    participantIdRef.current = participantId;
    resumeTokenRef.current = liveListenResumeToken();

    const audioContext = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = audioContext;
    await audioContext.resume();
    if (!resuming) {
      nextStartTimeRef.current = audioContext.currentTime + INITIAL_BUFFER_SECONDS;
      lastBitrateSampleRef.current = { at: performance.now(), bytes: 0 };
    }

    const sent = sendLiveListenMediaSessionMessage(liveListenMediaSessionListenRequest({
      participantId,
      resumeToken: resuming ? resumeTokenRef.current : undefined,
      streamId: resuming ? streamRef.current.streamId : undefined,
      sourceGeneration: resuming ? streamRef.current.generation : undefined,
      fromSeq: resuming && lastSeqRef.current != null ? lastSeqRef.current + 1 : undefined,
    }));
    if (!sent) {
      setWs("half-off");
      setStreaming(true);
      setCommand("reconnecting");
    }
  }, [resetAudioQueue]);

  const join = useCallback(async () => {
    if (command !== "idle" || streaming) return;
    setCommand("joining");
    setError(null);
    const preflight = mediaSession.snapshot
      ? snapshotFromMediaSession(mediaSession.snapshot)
      : snapshot;
    if (!preflight) {
      setCommand("idle");
      return;
    }
    setSnapshot(preflight);
    if (!canStartSession(preflight)) {
      setCommand("idle");
      setError(null);
      return;
    }
    shouldReconnectRef.current = true;
    setStats((current) => ({
      ...current,
      chunkCount: 0,
      queuedSeconds: INITIAL_BUFFER_SECONDS,
      receivedBytes: 0,
      receiveBitrateKbps: null,
      lastChunkBytes: 0,
      replayedChunks: 0,
    }));
    await requestListen(false);
  }, [command, mediaSession.snapshot, requestListen, snapshot, streaming]);

  const leave = useCallback(() => {
    setCommand("leaving");
    shouldReconnectRef.current = false;
    const participantId = participantIdRef.current ?? undefined;
    if (participantId && (streamingRef.current || commandRef.current === "joining" || commandRef.current === "reconnecting")) {
      sendLiveListenMediaSessionMessage(liveListenMediaSessionStop(participantId));
    }
    setStreaming(false);
    setCommand("idle");
  }, []);

  const scheduleAudioChunk = useCallback(async (
    arrayBuffer: ArrayBuffer,
    audioContext: AudioContext,
    envelope: { seq: number; byteLength: number; replayed?: boolean },
  ) => {
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const source = audioContext.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(audioContext.destination);

    const start = Math.max(audioContext.currentTime, nextStartTimeRef.current);
    source.start(start);
    nextStartTimeRef.current = start + decodedBuffer.duration;
    lastSeqRef.current = envelope.seq;
    sendLiveListenMediaSessionMessage(liveListenMediaSessionAck(envelope.seq));

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
        lastChunkBytes: envelope.byteLength || arrayBuffer.byteLength,
        lastSeq: envelope.seq,
        replayedChunks: current.replayedChunks + (envelope.replayed ? 1 : 0),
      };
    });
  }, []);

  const handleMediaSessionEvent = useCallback(async (event: LiveListenMediaSessionEnvelope) => {
    try {
      if (event.type === "media.snapshot.updated") {
        const next = snapshotFromMediaSession(event.snapshot);
        setSnapshot(next);
        streamRef.current = {
          streamId: next.audioFlow.streamId ?? streamRef.current.streamId,
          generation: next.audioFlow.generation ?? streamRef.current.generation,
        };
        setStats((current) => ({
          ...current,
          availableFromSeq: next.audioFlow.availableFromSeq ?? current.availableFromSeq,
          latestSeq: next.audioFlow.latestSeq ?? current.latestSeq,
        }));
        return;
      }
      if (event.type !== "snapshot.updated") {
        const participantId = participantIdRef.current;
        if (!participantId) return;
        if (event.participantId && event.participantId !== participantId) return;
      }
      if (event.type === "session.rejected") {
        const reason = event.reason ?? "session_rejected";
        setWs(event.snapshot ? "on" : "error");
        setStreaming(false);
        setCommand("idle");
        setError(shouldDisplayError(reason) ? reason : null);
        shouldReconnectRef.current = false;
        if (event.snapshot) setSnapshot(event.snapshot);
        return;
      }
      if (event.type === "session.accepted") {
        if (event.resumeToken) resumeTokenRef.current = liveListenResumeToken(event.resumeToken);
        if (event.snapshot) setSnapshot(event.snapshot);
        streamRef.current = {
          streamId: event.snapshot?.audioFlow.streamId,
          generation: event.snapshot?.audioFlow.generation,
        };
        setWs("on");
        setStreaming(true);
        setCommand("idle");
        return;
      }
      if (event.type === "session.resumed") {
        if (event.snapshot) setSnapshot(event.snapshot);
        streamRef.current = { streamId: event.streamId, generation: event.generation };
        setStats((current) => ({
          ...current,
          availableFromSeq: event.availableFromSeq ?? current.availableFromSeq,
          latestSeq: event.latestSeq ?? current.latestSeq,
        }));
        setWs("on");
        setStreaming(true);
        setCommand("idle");
        return;
      }
      if (event.type === "snapshot.updated") {
        if (event.snapshot) setSnapshot(event.snapshot);
        streamRef.current = {
          streamId: event.snapshot?.audioFlow.streamId ?? streamRef.current.streamId,
          generation: event.snapshot?.audioFlow.generation ?? streamRef.current.generation,
        };
        setStats((current) => ({
          ...current,
          availableFromSeq: event.snapshot?.audioFlow.availableFromSeq ?? current.availableFromSeq,
          latestSeq: event.snapshot?.audioFlow.latestSeq ?? current.latestSeq,
        }));
        return;
      }
      if (event.type === "audio.chunk" && event.data && event.seq != null) {
        const audioContext = audioContextRef.current;
        if (!audioContext) return;
        if (event.streamId !== streamRef.current.streamId || event.generation !== streamRef.current.generation) {
          streamRef.current = { streamId: event.streamId, generation: event.generation };
          resetAudioQueue();
        }
        await scheduleAudioChunk(base64ToArrayBuffer(event.data), audioContext, {
          seq: event.seq,
          byteLength: event.byteLength ?? 0,
          replayed: event.replayed,
        });
        setWs("on");
        setStreaming(true);
        return;
      }
      if (event.type === "replay.miss") {
        lastSeqRef.current = event.latestSeq ?? null;
        resetAudioQueue();
        setStats((current) => ({
          ...current,
          missedChunks: current.missedChunks + 1,
          availableFromSeq: event.availableFromSeq ?? current.availableFromSeq,
          latestSeq: event.latestSeq ?? current.latestSeq,
          lastSeq: lastSeqRef.current,
        }));
        return;
      }
      if (event.type === "stream.gap" || event.type === "stream.transition") {
        resetAudioQueue();
        if (event.type === "stream.transition") {
          streamRef.current = { streamId: event.streamId, generation: event.toGeneration };
          lastSeqRef.current = null;
        }
        return;
      }
      if (event.type === "stream.ended" || event.type === "stream.error") {
        const reason = event.reason ?? "stream_error";
        shouldReconnectRef.current = false;
        setWs(event.type === "stream.error" ? "error" : "on");
        setStreaming(false);
        setCommand("idle");
        setError(event.type === "stream.error" && shouldDisplayError(reason) ? reason : null);
      }
    } catch (cause) {
      setWs("error");
      setStreaming(false);
      setCommand("idle");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [resetAudioQueue, scheduleAudioChunk]);

  useEffect(() => {
    return subscribeLiveListenMediaSessionEvents((event) => {
      void handleMediaSessionEvent(event);
    });
  }, [handleMediaSessionEvent]);

  useEffect(() => {
    if (!shouldReconnectRef.current || !streaming) return;
    if (mediaSession.ws === "half-off" || mediaSession.ws === "error") {
      setWs(mediaSession.ws === "error" ? "error" : "half-off");
      setCommand("reconnecting");
      return;
    }
    if (mediaSession.ws === "on" && command === "reconnecting") {
      void requestListen(true);
    }
  }, [command, mediaSession.ws, requestListen, streaming]);

  useEffect(() => leave, [leave]);

  const streamable = useMemo<WebLiveListenStreamable>(() => deriveStreamable(ws, snapshot), [snapshot, ws]);

  return useMemo(() => ({
    canJoin: ws === "on" && streamable.value && !streaming && command === "idle",
    ws,
    streamable,
    streaming,
    command,
    error,
    join,
    leave,
    stats,
    snapshot,
    remoteAudioTrack: null as MediaStreamTrack | null,
    audioRef,
    audioStats: {
      bitrateKbps: stats.receiveBitrateKbps,
      jitterMs: null as number | null,
      packetsLost: null as number | null,
      bytesDeltaPerSecond: stats.receiveBitrateKbps == null ? null : (stats.receiveBitrateKbps * 1000) / 8,
      codec: "pcm16-wav",
      audioLevel: null as number | null,
      packets: stats.chunkCount,
      packetsDiscarded: null as number | null,
      packetsLostDeltaPerSecond: null as number | null,
      concealmentEventsDeltaPerSecond: null as number | null,
      concealedSamplesDeltaPerSecond: null as number | null,
      jitterBufferDelayMs: null as number | null,
      jitterBufferTargetDelayMs: null as number | null,
      jitterBufferMinimumDelayMs: null as number | null,
      roundTripTimeMs: null as number | null,
      totalAudioEnergy: null as number | null,
    },
  }), [command, error, join, leave, snapshot, stats, streamable, streaming, ws]);
}

function snapshotFromMediaSession(snapshot: LiveListenMediaSessionSnapshot): LiveListenSnapshot {
  return {
    protocol: "live-listen.server.v1",
    workspaceId: snapshot.workspaceId,
    roomId: snapshot.roomId,
    listeners: snapshot.listeners,
    nativeLink: snapshot.nativeLink,
    admission: snapshot.admission,
    streamDemand: snapshot.streamDemand,
    audioFlow: snapshot.audioFlow,
    media: snapshot.media,
    updatedAt: snapshot.updatedAt,
  };
}

function canStartSession(snapshot: LiveListenSnapshot) {
  return snapshot.admission.state === "open";
}

function deriveStreamable(ws: WebLiveListenWsState, snapshot: LiveListenSnapshot | null): WebLiveListenStreamable {
  if (ws === "error") return { value: false, reason: "protocol_error" };
  if (ws === "half-off") return { value: false, reason: "connection_lost" };
  if (!snapshot) return { value: false, reason: "snapshot_unavailable" };
  if (snapshot.admission.state === "open") return { value: true };
  return { value: false, reason: snapshot.admission.reason };
}

function shouldDisplayError(reason: string) {
  return reason === "auth_failed"
    || reason === "protocol_error"
    || reason === "native_error"
    || reason === "live_listen_session_ws_error"
    || reason === "live_listen_media_session_ws_error"
    || reason === "stream_error";
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
