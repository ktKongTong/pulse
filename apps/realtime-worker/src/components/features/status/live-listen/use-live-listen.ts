import "webrtc-adapter";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { of, type Subscription } from "rxjs";
import { PartyTracks, createAudioSink, type TrackMetadata } from "partytracks/client";
import type { LiveListenSnapshot } from "@pulse/realtime-protocol";

import {
  fetchLiveListenSnapshot,
  joinLiveListen,
  liveListenParticipantId,
  openLiveListenEvents,
} from "@/lib/live-listen";
import {
  emptyAudioStats,
  startPartyTracksAudioStats,
  type LiveListenAudioStats,
} from "@/lib/webrtc-audio-stats";

type LiveListenConnectionState = "idle" | "joining" | "connected" | "listening" | "error";

const LIVE_LISTEN_JITTER_BUFFER_MS = 1_500;

export function useLiveListen() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const partyTracksRef = useRef<PartyTracks | null>(null);
  const sinkSubscriptionRef = useRef<Subscription | null>(null);
  const statsSubscriptionRef = useRef<Subscription | null>(null);
  const transceiverSubscriptionRef = useRef<Subscription | null>(null);
  const [snapshot, setSnapshot] = useState<LiveListenSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<LiveListenConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioStats, setAudioStats] = useState<LiveListenAudioStats>(() => emptyAudioStats("inbound"));

  useEffect(() => {
    const controller = new AbortController();
    fetchLiveListenSnapshot({ signal: controller.signal })
      .then(setSnapshot)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause));
      });
    const socket = openLiveListenEvents({
      onMessage: (event) => {
        if (event.snapshot) setSnapshot(event.snapshot);
      },
      onError: () => setError("live_listen_events_error"),
    });
    return () => {
      controller.abort();
      socket.close();
    };
  }, []);

  const canJoin = snapshot?.state === "starting" || snapshot?.state === "live";
  const track = snapshot?.audio?.track;
  const partyTracksPrefix = snapshot?.audio?.partyTracksPrefix ?? "/api/v1/live-listen/partytracks";

  const join = useCallback(async () => {
    if (!snapshot || !canJoin) return;
    setConnectionState("joining");
    setError(null);
    try {
      await joinLiveListen({
        workspaceId: snapshot.workspaceId,
        roomId: snapshot.roomId,
        participantId: liveListenParticipantId(),
      });
      if (!track?.sessionId || !track.trackName) {
        setConnectionState("idle");
        setError("live_listen_track_not_ready");
        return;
      }
      const audioElement = audioRef.current;
      if (!audioElement) return;
      sinkSubscriptionRef.current?.unsubscribe();
      statsSubscriptionRef.current?.unsubscribe();
      const partyTracks = new PartyTracks({ prefix: partyTracksPrefix });
      partyTracksRef.current = partyTracks;
      statsSubscriptionRef.current = startPartyTracksAudioStats(partyTracks, "inbound", setAudioStats);
      transceiverSubscriptionRef.current?.unsubscribe();
      transceiverSubscriptionRef.current = partyTracks.transceiver$.subscribe((transceiver) => {
        configureReceiverJitterBuffer(transceiver.receiver, LIVE_LISTEN_JITTER_BUFFER_MS);
      });
      const metadata: TrackMetadata = {
        location: "remote",
        sessionId: track.sessionId,
        trackName: track.trackName,
        mid: track.mid ?? undefined,
      };
      const remoteTrack$ = partyTracks.pull(of(metadata));
      const audioSink = createAudioSink({ audioElement });
      sinkSubscriptionRef.current = audioSink.attach(remoteTrack$);
      setConnectionState("connected");
    } catch (cause) {
      setConnectionState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [canJoin, partyTracksPrefix, snapshot, track?.mid, track?.sessionId, track?.trackName]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const handlePlay = () => setConnectionState("listening");
    const handlePlaying = () => setConnectionState("listening");
    const handlePause = () => {
      setConnectionState((current) => current === "listening" ? "connected" : current);
    };

    audioElement.addEventListener("play", handlePlay);
    audioElement.addEventListener("playing", handlePlaying);
    audioElement.addEventListener("pause", handlePause);

    return () => {
      audioElement.removeEventListener("play", handlePlay);
      audioElement.removeEventListener("playing", handlePlaying);
      audioElement.removeEventListener("pause", handlePause);
      transceiverSubscriptionRef.current?.unsubscribe();
      statsSubscriptionRef.current?.unsubscribe();
      statsSubscriptionRef.current = null;
      setAudioStats(emptyAudioStats("inbound"));
      sinkSubscriptionRef.current?.unsubscribe();
      partyTracksRef.current = null;
    };
  }, []);

  return useMemo(() => ({
    audioRef,
    audioStats,
    canJoin,
    connectionState,
    error,
    join,
    snapshot,
  }), [audioStats, canJoin, connectionState, error, join, snapshot]);
}

function configureReceiverJitterBuffer(receiver: RTCRtpReceiver, targetMs: number) {
  const configurableReceiver = receiver as RTCRtpReceiver & {
    jitterBufferTarget?: number;
  };
  if (typeof configurableReceiver.jitterBufferTarget !== "number") return;
  configurableReceiver.jitterBufferTarget = Math.min(Math.max(targetMs, 0), 4_000);
}
