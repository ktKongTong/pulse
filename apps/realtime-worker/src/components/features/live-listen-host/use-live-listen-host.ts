import "webrtc-adapter";

import { useCallback, useEffect, useRef, useState } from "react";
import { BehaviorSubject, of, type Subscription } from "rxjs";
import { PartyTracks, type TrackMetadata } from "partytracks/client";
import type { LiveListenAudioSession } from "@pulse/realtime-protocol";

import {
  heartbeatLiveListenHost,
  startLiveListenHost,
  stopLiveListenHost,
} from "@/lib/live-listen-host";
import {
  emptyAudioStats,
  startPartyTracksAudioStats,
  type LiveListenAudioStats,
} from "@/lib/webrtc-audio-stats";

type HostState = "idle" | "starting" | "live" | "stopping" | "error";

const LIVE_LISTEN_AUDIO_MAX_BITRATE = 320_000;
const LIVE_LISTEN_OPUS_FMTP = `stereo=1;sprop-stereo=1;maxaveragebitrate=${LIVE_LISTEN_AUDIO_MAX_BITRATE};useinbandfec=1`;

type LiveListenAudioSource = {
  audioContext: AudioContext;
  sourceNode: AudioBufferSourceNode;
  stream: MediaStream;
};

export function useLiveListenHost(args: {
  apiKey: string;
  hostDeviceId: string;
  audioFile: File | null;
  forceTurnRelay?: boolean;
  partyTracksPrefix?: string;
}) {
  const [state, setState] = useState<HostState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [trackMetadata, setTrackMetadata] = useState<TrackMetadata | null>(null);
  const [audioStats, setAudioStats] = useState<LiveListenAudioStats>(() => emptyAudioStats("outbound"));
  const audioSourceRef = useRef<LiveListenAudioSource | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceTrackRef = useRef<BehaviorSubject<MediaStreamTrack> | null>(null);
  const trackMetadataRef = useRef<TrackMetadata | null>(null);
  const metadataSubscriptionRef = useRef<Subscription | null>(null);
  const statsSubscriptionRef = useRef<Subscription | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const partyTracksRef = useRef<PartyTracks | null>(null);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const cleanupMedia = useCallback(() => {
    metadataSubscriptionRef.current?.unsubscribe();
    metadataSubscriptionRef.current = null;
    statsSubscriptionRef.current?.unsubscribe();
    statsSubscriptionRef.current = null;
    trackMetadataRef.current = null;
    sourceTrackRef.current?.complete();
    sourceTrackRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    stopAudioSource(audioSourceRef.current);
    audioSourceRef.current = null;
    partyTracksRef.current = null;
    setAudioStats(emptyAudioStats("outbound"));
  }, []);

  const start = useCallback(async () => {
    if (!args.apiKey.trim()) {
      setError("Missing device API key.");
      setState("error");
      return;
    }
    if (!args.audioFile) {
      setError("Choose an MP3 file before starting.");
      setState("error");
      return;
    }
    setState("starting");
    setError(null);

    try {
      const prefix = args.partyTracksPrefix ?? "/api/v1/live-listen/partytracks";
      if (args.forceTurnRelay === true) {
        await assertTurnIceServersAvailable(prefix);
      }
      const audioSource = await createAudioFileStream(args.audioFile);
      audioSourceRef.current = audioSource;
      const { stream } = audioSource;
      const [audioTrack] = stream.getAudioTracks();
      if (!audioTrack) throw new Error("No audio track available.");
      setAudioTrackContentHint(audioTrack, "music");
      mediaStreamRef.current = stream;

      setPeerConnectionRelayPolicy(args.forceTurnRelay === true);
      const partyTracks = new PartyTracks({ prefix });
      partyTracksRef.current = partyTracks;
      patchOpusSenderSdp(LIVE_LISTEN_OPUS_FMTP);
      statsSubscriptionRef.current = startPartyTracksAudioStats(partyTracks, "outbound", setAudioStats);
      const sourceTrack$ = new BehaviorSubject<MediaStreamTrack>(audioTrack);
      sourceTrackRef.current = sourceTrack$;
      const metadata$ = partyTracks.push(sourceTrack$, {
        sendEncodings$: of([{ maxBitrate: LIVE_LISTEN_AUDIO_MAX_BITRATE }]),
      });

      await startLiveListenHost({
        apiKey: args.apiKey,
        hostDeviceId: args.hostDeviceId,
        audio: buildAudioSession(prefix, {
          location: "remote",
          trackName: "host-audio",
        }),
      });

      await audioSource.audioContext.resume();
      audioSource.sourceNode.start();

      metadataSubscriptionRef.current = metadata$.subscribe({
        next: (metadata) => {
          trackMetadataRef.current = metadata;
          setTrackMetadata(metadata);
          const audio = buildAudioSession(prefix, metadata);
          void heartbeatLiveListenHost({
            apiKey: args.apiKey,
            hostDeviceId: args.hostDeviceId,
            audio,
          });
        },
        error: (cause) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          setState("error");
        },
      });

      heartbeatTimerRef.current = window.setInterval(() => {
        const metadata = trackMetadataRef.current;
        void heartbeatLiveListenHost({
          apiKey: args.apiKey,
          hostDeviceId: args.hostDeviceId,
          audio: metadata ? buildAudioSession(prefix, metadata) : undefined,
        });
      }, 1_000);
      setState("live");
    } catch (cause) {
      cleanupMedia();
      setState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [args.apiKey, args.audioFile, args.forceTurnRelay, args.hostDeviceId, args.partyTracksPrefix, cleanupMedia]);

  const stop = useCallback(async () => {
    setState("stopping");
    stopHeartbeat();
    cleanupMedia();
    try {
      await stopLiveListenHost({
        apiKey: args.apiKey,
        hostDeviceId: args.hostDeviceId,
        reason: "host stopped",
      });
      trackMetadataRef.current = null;
      setTrackMetadata(null);
      setState("idle");
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [args.apiKey, args.hostDeviceId, cleanupMedia, stopHeartbeat]);

  useEffect(() => {
    return () => {
      stopHeartbeat();
      cleanupMedia();
    };
  }, [cleanupMedia, stopHeartbeat]);

  return { audioStats, error, start, state, stop, trackMetadata };
}

function setAudioTrackContentHint(track: MediaStreamTrack, hint: "music") {
  try {
    track.contentHint = hint;
  } catch {
  }
}

function patchOpusSenderSdp(opusFmtp: string) {
  const originalSetLocalDescription = RTCPeerConnection.prototype.setLocalDescription;
  if ((originalSetLocalDescription as { __pulseLiveListenPatched?: boolean }).__pulseLiveListenPatched) return;

  const patchedSetLocalDescription: RTCPeerConnection["setLocalDescription"] = function setLocalDescription(description) {
    if (description?.type === "offer" && description.sdp?.includes("opus/48000")) {
      const tunedDescription = new RTCSessionDescription({
        type: description.type,
        sdp: tuneOpusSdp(description.sdp, opusFmtp),
      });
      return originalSetLocalDescription.call(this, tunedDescription);
    }
    return originalSetLocalDescription.call(this, description);
  };

  (patchedSetLocalDescription as { __pulseLiveListenPatched?: boolean }).__pulseLiveListenPatched = true;
  RTCPeerConnection.prototype.setLocalDescription = patchedSetLocalDescription;
}

function setPeerConnectionRelayPolicy(forceRelay: boolean) {
  const peerConnection = window.RTCPeerConnection as typeof RTCPeerConnection & {
    __pulseLiveListenOriginal?: typeof RTCPeerConnection;
    __pulseLiveListenForceRelay?: boolean;
  };
  if (!peerConnection.__pulseLiveListenOriginal) {
    const OriginalPeerConnection = window.RTCPeerConnection;
    const PatchedPeerConnection = function RTCPeerConnectionWithRelay(
      this: RTCPeerConnection,
      configuration?: RTCConfiguration,
    ) {
      const constructorRef = window.RTCPeerConnection as typeof RTCPeerConnection & {
        __pulseLiveListenForceRelay?: boolean;
      };
      const nextConfiguration = constructorRef.__pulseLiveListenForceRelay
        ? { ...(configuration ?? {}), iceTransportPolicy: "relay" satisfies RTCIceTransportPolicy }
        : configuration;
      return new OriginalPeerConnection(nextConfiguration);
    } as unknown as typeof RTCPeerConnection;
    PatchedPeerConnection.prototype = OriginalPeerConnection.prototype;
    Object.setPrototypeOf(PatchedPeerConnection, OriginalPeerConnection);
    (PatchedPeerConnection as typeof peerConnection).__pulseLiveListenOriginal = OriginalPeerConnection;
    window.RTCPeerConnection = PatchedPeerConnection;
  }

  (window.RTCPeerConnection as typeof RTCPeerConnection & {
    __pulseLiveListenForceRelay?: boolean;
  }).__pulseLiveListenForceRelay = forceRelay;
}

async function assertTurnIceServersAvailable(prefix: string) {
  const response = await fetch(`${prefix}/generate-ice-servers`);
  if (!response.ok) throw new Error(`turn_ice_servers_failed:${response.status}`);
  const body = await response.json() as { iceServers?: RTCIceServer[] };
  const iceServers = body.iceServers ?? [];
  const hasTurnServer = iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => String(url).startsWith("turn:"));
  });
  if (!hasTurnServer) throw new Error("turn_ice_servers_missing_turn_url");
}

function tuneOpusSdp(sdp: string, opusFmtp: string) {
  const lines = sdp.split("\r\n");
  const opusRtpMapIndex = lines.findIndex((line) => /^a=rtpmap:\d+ opus\/48000/i.test(line));
  if (opusRtpMapIndex === -1) return sdp;

  const payloadType = lines[opusRtpMapIndex]?.match(/^a=rtpmap:(\d+) /)?.[1];
  if (!payloadType) return sdp;

  const fmtpLine = `a=fmtp:${payloadType} ${opusFmtp}`;
  const existingFmtpIndex = lines.findIndex((line) => line.startsWith(`a=fmtp:${payloadType} `));
  if (existingFmtpIndex >= 0) {
    lines[existingFmtpIndex] = mergeFmtp(lines[existingFmtpIndex] ?? "", fmtpLine);
  } else {
    lines.splice(opusRtpMapIndex + 1, 0, fmtpLine);
  }

  return lines.join("\r\n");
}

function mergeFmtp(existing: string, desired: string) {
  const [, prefix = "", existingParams = ""] = existing.match(/^(a=fmtp:\d+ )(.*)$/) ?? [];
  const desiredParams = desired.replace(/^a=fmtp:\d+ /, "");
  const params = new Map<string, string>();

  for (const chunk of existingParams.split(";")) {
    const [key, value = ""] = chunk.split("=");
    if (key?.trim()) params.set(key.trim(), value.trim());
  }
  for (const chunk of desiredParams.split(";")) {
    const [key, value = ""] = chunk.split("=");
    if (key?.trim()) params.set(key.trim(), value.trim());
  }

  return `${prefix}${Array.from(params.entries()).map(([key, value]) => `${key}=${value}`).join(";")}`;
}

async function createAudioFileStream(file: File): Promise<LiveListenAudioSource> {
  const audioContext = new AudioContext({ sampleRate: 48_000 });
  const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
  const sourceNode = audioContext.createBufferSource();
  const destinationNode = audioContext.createMediaStreamDestination();
  sourceNode.buffer = audioBuffer;
  sourceNode.loop = true;
  sourceNode.connect(destinationNode);
  return {
    audioContext,
    sourceNode,
    stream: destinationNode.stream,
  };
}

function stopAudioSource(source: LiveListenAudioSource | null) {
  if (!source) return;
  try {
    source.sourceNode.stop();
  } catch {
  }
  void source.audioContext.close().catch(() => undefined);
}

function buildAudioSession(prefix: string, metadata: TrackMetadata): LiveListenAudioSession {
  const sessionId = metadata.sessionId ?? "pending-partytracks-session";
  return {
    transport: "cloudflare-realtime",
    sessionId,
    roomName: "live-listen:owner",
    publishTrackName: metadata.trackName ?? "host-audio",
    partyTracksPrefix: prefix,
    track: {
      location: "remote",
      sessionId,
      trackName: metadata.trackName ?? "host-audio",
      mid: metadata.mid ?? undefined,
    },
  };
}
