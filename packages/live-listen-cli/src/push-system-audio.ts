#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import process, { loadEnvFile } from "node:process";
import path from "node:path";
import { inspect } from "node:util";
import type { Readable } from "node:stream";

import wrtc, { type nonstandard as WrtcNonstandard } from "@roamhq/wrtc";
import { PartyTracks, type TrackMetadata } from "partytracks/client";
import { BehaviorSubject, firstValueFrom } from "rxjs";

import { startAudioPacer } from "./audio-pacer.ts";
import { createSenderWaveformDebugServer, type SenderWaveformDebugServer } from "./waveform-debug.ts";

const { RTCPeerConnection, RTCSessionDescription, nonstandard } = wrtc;
const LIVE_LISTEN_AUDIO_MAX_BITRATE = 320_000;
const LIVE_LISTEN_OPUS_FMTP = `stereo=1;sprop-stereo=1;maxaveragebitrate=${LIVE_LISTEN_AUDIO_MAX_BITRATE};useinbandfec=1`;
const LIVE_LISTEN_FFMPEG_AUDIO_SYNC_FILTER = "aresample=async=1000:first_pts=0";

if (existsSync(".env")) {
  loadEnvFile();
}

const DEFAULTS = {
  roomId: "live-listen:owner",
  hostDeviceId: `native-cli-${randomUUID()}`,
  sampleRate: 48_000,
  channels: 2,
  frameMs: 10,
  startupBufferMs: 200,
  maxQueueMs: 2_000,
  maxBurstFrames: 8,
  sampleTapMode: "auto",
  captureOnly: false,
  debugWaveformBindHost: "127.0.0.1",
  debugWaveformPort: 0,
  maxBitrateBps: LIVE_LISTEN_AUDIO_MAX_BITRATE,
  forceTurnRelay: true,
};

type AudioSourceMode = "device" | "file" | "system-tap";
type SampleCaptureTap = "source" | "sender";
type SampleCaptureTapMode = SampleCaptureTap | "auto";

type Config = typeof DEFAULTS & {
  pulseBaseUrl: string;
  workspaceId: string;
  audioSource: AudioSourceMode;
  deviceApiKey: string;
  ffmpegInput: string;
  ffmpegInputFormat: string;
  audioFile?: string;
  sampleMp3Path?: string;
  sampleWavPath?: string;
  sampleSeconds: number;
  maxBurstFrames: number;
  sampleTapMode: SampleCaptureTapMode;
  captureOnly: boolean;
  debugWaveformBindHost: string;
  debugWaveformPort: number;
  ffmpegAudioDepth?: 16 | 32;
  ffmpegQueueSizeBytes?: number;
};

type CoreAudioCaptureTarget = {
  appPath: string;
  binaryPath: string;
};

type WrtcGlobals = typeof globalThis & {
  RTCPeerConnection: typeof RTCPeerConnection;
  RTCSessionDescription: typeof RTCSessionDescription;
  window: Window & typeof globalThis;
};

function envValue(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function config(): Config {
  return {
    ...DEFAULTS,
    pulseBaseUrl: process.env.PULSE_BASE_URL!,
    workspaceId: process.env.PULSE_WORKSPACE_ID!,
    roomId: process.env.PULSE_LIVE_LISTEN_ROOM_ID ?? DEFAULTS.roomId,
    hostDeviceId: process.env.PULSE_HOST_DEVICE_ID ?? DEFAULTS.hostDeviceId,
    sampleRate: Number(process.env.PULSE_AUDIO_SAMPLE_RATE ?? DEFAULTS.sampleRate),
    channels: Number(process.env.PULSE_AUDIO_CHANNELS ?? DEFAULTS.channels),
    frameMs: Number(process.env.PULSE_AUDIO_FRAME_MS ?? DEFAULTS.frameMs),
    startupBufferMs: Number(process.env.PULSE_AUDIO_STARTUP_BUFFER_MS ?? DEFAULTS.startupBufferMs),
    maxQueueMs: Number(process.env.PULSE_AUDIO_MAX_QUEUE_MS ?? DEFAULTS.maxQueueMs),
    maxBurstFrames: Number(process.env.PULSE_AUDIO_MAX_BURST_FRAMES ?? DEFAULTS.maxBurstFrames),
    sampleTapMode: sampleCaptureTapMode(process.env.PULSE_AUDIO_SAMPLE_TAP ?? DEFAULTS.sampleTapMode),
    captureOnly: parseBoolean(process.env.PULSE_CAPTURE_ONLY, DEFAULTS.captureOnly),
    debugWaveformBindHost: process.env.PULSE_DEBUG_WAVEFORM_BIND_HOST ?? DEFAULTS.debugWaveformBindHost,
    debugWaveformPort: Number(process.env.PULSE_DEBUG_WAVEFORM_PORT ?? DEFAULTS.debugWaveformPort),
    ffmpegAudioDepth: process.env.PULSE_FFMPEG_AUDIO_DEPTH
      ? ffmpegAudioDepth(process.env.PULSE_FFMPEG_AUDIO_DEPTH)
      : undefined,
    ffmpegQueueSizeBytes: process.env.PULSE_FFMPEG_QUEUE_SIZE_BYTES
      ? Number(process.env.PULSE_FFMPEG_QUEUE_SIZE_BYTES)
      : undefined,
    maxBitrateBps: Number(process.env.PULSE_AUDIO_MAX_BITRATE_BPS ?? DEFAULTS.maxBitrateBps),
    forceTurnRelay: parseBoolean(process.env.PULSE_FORCE_TURN_RELAY, DEFAULTS.forceTurnRelay),
    audioSource: audioSourceMode(process.env.PULSE_AUDIO_SOURCE ?? "device"),
    deviceApiKey: process.env.PULSE_DEVICE_API_KEY ?? "",
    ffmpegInput: envValue("PULSE_FFMPEG_INPUT", ":0"),
    ffmpegInputFormat: envValue("PULSE_FFMPEG_INPUT_FORMAT", "avfoundation"),
    audioFile: process.env.PULSE_AUDIO_FILE,
    sampleMp3Path: process.env.PULSE_AUDIO_SAMPLE_MP3_PATH,
    sampleWavPath: process.env.PULSE_AUDIO_SAMPLE_WAV_PATH,
    sampleSeconds: Number(process.env.PULSE_AUDIO_SAMPLE_SECONDS ?? 30),
  };
}

async function main() {
  const cfg = config();
  validateConfig(cfg);
  warnMacOsAudioClockMismatch(cfg);
  installWebRtcGlobals(cfg.forceTurnRelay);
  patchOpusSenderSdp(LIVE_LISTEN_OPUS_FMTP);
  console.log("live-listen cli config", {
    audioSource: cfg.audioSource,
    forceTurnRelay: cfg.forceTurnRelay,
    frameMs: cfg.frameMs,
    startupBufferMs: cfg.startupBufferMs,
    maxQueueMs: cfg.maxQueueMs,
    maxBurstFrames: cfg.maxBurstFrames,
    sampleTapMode: cfg.sampleTapMode,
    captureOnly: cfg.captureOnly,
    debugWaveformBindHost: cfg.debugWaveformBindHost,
    debugWaveformPort: cfg.debugWaveformPort,
    ffmpegAudioDepth: cfg.ffmpegAudioDepth,
    ffmpegQueueSizeBytes: cfg.ffmpegQueueSizeBytes,
  });
  if (parseBoolean(process.env.PULSE_REQUEST_AUDIO_CAPTURE_PERMISSION, false)) {
    await requestCoreAudioCapturePermission();
    return;
  }
  if (cfg.captureOnly) {
    await runCaptureOnly(cfg);
    return;
  }
  const source = new nonstandard.RTCAudioSource();
  const track = source.createTrack();
  setAudioTrackContentHint(track, "music");
  const waveformDebug = createWaveformDebug(cfg);
  const track$ = new BehaviorSubject(track);
  const sampleCapture = createSampleCapture(cfg);
  const sendEncodings$ = new BehaviorSubject<RTCRtpEncodingParameters[]>([
    {
      maxBitrate: cfg.maxBitrateBps,
      priority: "high",
      networkPriority: "high",
    } as RTCRtpEncodingParameters,
  ]);
  let latestMetadata: TrackMetadata | null = null;
  const onMetadata = (metadata: TrackMetadata) => {
    latestMetadata = metadata;
    console.log("published", metadata);
    void heartbeatHost(cfg, metadata).catch((error) => console.error("metadata heartbeat failed", error));
  };
  const partyTracks = createPartyTracks(cfg, onMetadata);

  const metadataPromise = firstValueFrom(partyTracks.push(track$, { sendEncodings$ }));

  await startHost(cfg, null);

  const heartbeat = setInterval(() => {
    void heartbeatHost(cfg, latestMetadata).catch((error) => console.error("heartbeat failed", error));
  }, 1_000);

  const captureProcess = cfg.audioSource === "device" || cfg.audioSource === "system-tap"
    ? spawnDeviceCaptureProcess(cfg)
    : null;
  if (captureProcess) {
    streamPcmFrames({ cfg, ffmpeg: captureProcess, source, sampleCapture, waveformDebug });
  } else {
    streamPredecodedFile({ cfg, source, sampleCapture, waveformDebug });
  }
  console.log("waiting for PartyTracks publish metadata...");

  metadataPromise
    .then(onMetadata)
    .catch((error) => {
      console.error("PartyTracks publish failed", error);
      void stopHost(cfg, "publish_failed").catch((cause) => console.error("stop failed", cause));
      process.exitCode = 1;
    });

  const stop = async (reason: string) => {
    clearInterval(heartbeat);
    track.stop();
    captureProcess?.kill("SIGTERM");
    sampleCapture?.close();
    waveformDebug?.close();
    await stopHost(cfg, reason).catch((error) => console.error("stop failed", error));
    process.exit(0);
  };

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

function createPartyTracks(cfg: Config, onMetadata: (metadata: TrackMetadata) => void) {
  const partyTracks = new PartyTracks({
    prefix: `${cfg.pulseBaseUrl}/api/v1/live-listen/partytracks`,
    apiExtraParams: new URLSearchParams({
      workspaceId: cfg.workspaceId,
      roomId: cfg.roomId,
      forceTurnRelay: cfg.forceTurnRelay ? "1" : "0",
    }).toString(),
    headers: new Headers({ Authorization: `Bearer ${cfg.deviceApiKey}` }),
  });
  partyTracks.history.addEventListener("logentry", () => {
    const entry = partyTracks.history.entries.at(-1);
    if (!entry) return;
    console.log("partytracks", inspect(entry, { depth: 8, colors: false }));
    const metadata = trackMetadataFromHistoryEntry(entry);
    if (metadata) onMetadata(metadata);
  });
  partyTracks.sessionError$.subscribe((error) => console.error("partytracks session error", error));
  partyTracks.peerConnectionState$.subscribe((state) => console.log("peerConnection", state));
  return partyTracks;
}

type PartyTracksHistoryEntry = {
  type: "request" | "response";
  endpoint: string;
  body?: unknown;
};

function trackMetadataFromHistoryEntry(entry: PartyTracksHistoryEntry): TrackMetadata | null {
  if (entry.type !== "response") return null;
  if (!entry.endpoint.includes("/tracks/new")) return null;
  if (!isTrackResponseBody(entry.body)) return null;
  const sessionId = entry.endpoint.match(/\/sessions\/([^/]+)\/tracks\/new/)?.[1];
  const track = entry.body.tracks.find((candidate) => !candidate.errorCode && (candidate.trackName || candidate.mid));
  if (!sessionId || !track?.trackName) return null;
  return {
    trackName: track.trackName,
    sessionId,
    location: "remote",
  };
}

function isTrackResponseBody(
  value: unknown,
): value is { tracks: Array<{ trackName?: string; mid?: string | null; errorCode?: string }> } {
  return typeof value === "object" && value !== null && Array.isArray((value as { tracks?: unknown }).tracks);
}

function installWebRtcGlobals(forceRelay: boolean) {
  const target = globalThis as WrtcGlobals;
  target.RTCPeerConnection = forceRelay ? relayPeerConnection() : RTCPeerConnection;
  target.RTCSessionDescription = RTCSessionDescription;
  target.window = globalThis as Window & typeof globalThis;
}

function relayPeerConnection(): typeof RTCPeerConnection {
  return function RTCPeerConnectionWithRelay(configuration?: RTCConfiguration) {
    return new RTCPeerConnection({
      ...(configuration ?? {}),
      iceTransportPolicy: "relay",
    });
  } as unknown as typeof RTCPeerConnection;
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

  const patchedSetLocalDescription: RTCPeerConnection["setLocalDescription"] = function setLocalDescription(
    this: RTCPeerConnection,
    description,
  ) {
    if (description?.type === "offer" && description.sdp?.includes("opus/48000")) {
      const tunedDescription = new RTCSessionDescription({
        type: description.type,
        sdp: tuneOpusSdp(description.sdp, opusFmtp),
      });
      return (originalSetLocalDescription as (...args: unknown[]) => Promise<void>).call(this, tunedDescription);
    }
    return (originalSetLocalDescription as (...args: unknown[]) => Promise<void>).call(this, description);
  };

  (patchedSetLocalDescription as { __pulseLiveListenPatched?: boolean }).__pulseLiveListenPatched = true;
  RTCPeerConnection.prototype.setLocalDescription = patchedSetLocalDescription;
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function sampleCaptureTapMode(value: string): SampleCaptureTapMode {
  if (value === "auto" || value === "source" || value === "sender") return value;
  throw new Error(`Invalid PULSE_AUDIO_SAMPLE_TAP: ${value}. Expected auto, source, or sender.`);
}

function ffmpegAudioDepth(value: string): 16 | 32 {
  if (value === "16" || value === "32") return Number(value) as 16 | 32;
  throw new Error(`Invalid PULSE_FFMPEG_AUDIO_DEPTH: ${value}. Expected 16 or 32.`);
}

function resolveSampleCaptureTap(cfg: Config): SampleCaptureTap {
  if (cfg.sampleTapMode === "sender") return "sender";
  if (cfg.sampleTapMode === "source" && cfg.audioSource !== "file") return "source";
  if (cfg.audioSource !== "file") return "source";
  return "sender";
}

function useDirectSourceSampleCapture(cfg: Config) {
  return cfg.audioSource === "device"
    && resolveSampleCaptureTap(cfg) === "source"
    && Boolean(cfg.sampleMp3Path || cfg.sampleWavPath);
}

function audioSourceMode(value: string): AudioSourceMode {
  if (value === "device" || value === "file" || value === "system-tap") return value;
  throw new Error(`Invalid PULSE_AUDIO_SOURCE: ${value}. Expected device, system-tap, or file.`);
}

function validateConfig(cfg: Config) {
  if (cfg.captureOnly) {
    if (cfg.audioSource !== "device" && cfg.audioSource !== "system-tap") {
      throw new Error("PULSE_CAPTURE_ONLY currently only supports PULSE_AUDIO_SOURCE=device or system-tap");
    }
    if (!cfg.sampleMp3Path && !cfg.sampleWavPath) {
      throw new Error("PULSE_CAPTURE_ONLY requires PULSE_AUDIO_SAMPLE_WAV_PATH or PULSE_AUDIO_SAMPLE_MP3_PATH");
    }
    return;
  }
  if (!cfg.deviceApiKey.trim()) {
    throw new Error("Missing required env: PULSE_DEVICE_API_KEY");
  }
  if (cfg.audioSource !== "file") return;
  if (!cfg.audioFile) throw new Error("Missing required env: PULSE_AUDIO_FILE for file source mode");
  if (!existsSync(cfg.audioFile)) throw new Error(`PULSE_AUDIO_FILE does not exist: ${cfg.audioFile}`);
}

function createWaveformDebug(cfg: Config): SenderWaveformDebugServer | null {
  if (!Number.isFinite(cfg.debugWaveformPort) || cfg.debugWaveformPort <= 0) return null;
  const debugServer = createSenderWaveformDebugServer({
    bindHost: cfg.debugWaveformBindHost,
    channels: cfg.channels,
    frameMs: cfg.frameMs,
    port: cfg.debugWaveformPort,
    sampleRate: cfg.sampleRate,
  });
  console.log("sender waveform debug", { url: debugServer.url });
  return debugServer;
}

function warnMacOsAudioClockMismatch(cfg: Config) {
  if (process.platform !== "darwin") return;
  if (cfg.audioSource !== "device") return;

  const report = spawnSync("system_profiler", ["SPAudioDataType"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (report.error || report.status !== 0 || !report.stdout) return;

  const devices = parseSystemProfilerAudioDevices(report.stdout);
  const blackHole = devices.find((device) => device.name === "BlackHole 2ch");
  const defaultOutput = devices.find((device) => device.isDefaultOutput || device.isDefaultSystemOutput);
  if (!blackHole?.sampleRateHz || !defaultOutput?.sampleRateHz) return;
  if (blackHole.sampleRateHz === defaultOutput.sampleRateHz) return;

  console.warn("audio clock mismatch detected", {
    blackHole: {
      name: blackHole.name,
      sampleRateHz: blackHole.sampleRateHz,
    },
    defaultOutput: {
      name: defaultOutput.name,
      sampleRateHz: defaultOutput.sampleRateHz,
    },
    note: "Set BlackHole and the active output route to the same sample rate in Audio MIDI Setup. Prefer BlackHole as the master clock and enable drift correction on speakers/headphones in the Multi-Output Device.",
  });
}

type MacAudioDeviceInfo = {
  isDefaultInput: boolean;
  isDefaultOutput: boolean;
  isDefaultSystemOutput: boolean;
  name: string;
  sampleRateHz: number | null;
};

function parseSystemProfilerAudioDevices(report: string): MacAudioDeviceInfo[] {
  const devices: MacAudioDeviceInfo[] = [];
  let current: MacAudioDeviceInfo | null = null;

  for (const rawLine of report.split("\n")) {
    const line = rawLine.replace(/\t/g, "    ");
    const nameMatch = line.match(/^ {8}(.+):$/);
    if (nameMatch) {
      const name = nameMatch[1]?.trim();
      if (!name || name === "Audio" || name === "Devices") continue;
      current = {
        isDefaultInput: false,
        isDefaultOutput: false,
        isDefaultSystemOutput: false,
        name,
        sampleRateHz: null,
      };
      devices.push(current);
      continue;
    }
    if (!current) continue;

    const trimmed = line.trim();
    if (trimmed === "Default Input Device: Yes") {
      current.isDefaultInput = true;
      continue;
    }
    if (trimmed === "Default Output Device: Yes") {
      current.isDefaultOutput = true;
      continue;
    }
    if (trimmed === "Default System Output Device: Yes") {
      current.isDefaultSystemOutput = true;
      continue;
    }
    const sampleRateMatch = trimmed.match(/^Current SampleRate: (\d+)/);
    if (sampleRateMatch) {
      current.sampleRateHz = Number(sampleRateMatch[1]);
    }
  }

  return devices;
}

type SampleCaptureWriter = {
  close(): void;
  writeBuffer(buffer: Buffer): void;
};

type SampleCapture = {
  tap: SampleCaptureTap;
  writeBuffer(buffer: Buffer): void;
  writeSamples(samples: Int16Array): void;
  close(): void;
};

function createSampleCapture(cfg: Config): SampleCapture | null {
  if (!cfg.sampleMp3Path && !cfg.sampleWavPath) return null;

  const tap = resolveSampleCaptureTap(cfg);
  if (useDirectSourceSampleCapture(cfg)) {
    if (!cfg.captureOnly && process.platform === "darwin") {
      console.warn("source sample capture is not emitted during live CoreAudio push; use PULSE_CAPTURE_ONLY=1 for source WAV diagnostics");
    }
    console.log("sample capture delegated to ffmpeg outputs", {
      mp3Path: cfg.sampleMp3Path,
      wavPath: cfg.sampleWavPath,
      seconds: cfg.sampleSeconds,
      tap,
    });
    return {
      tap,
      writeBuffer() {},
      writeSamples() {},
      close() {},
    };
  }

  const maxBytes = Math.max(2, Math.ceil(cfg.sampleSeconds * cfg.sampleRate * cfg.channels * 2));
  let writtenBytes = 0;
  let closed = false;
  let collecting = true;
  let flushed = false;
  const chunks: Buffer[] = [];
  console.log("sample capture started", {
    mp3Path: cfg.sampleMp3Path,
    wavPath: cfg.sampleWavPath,
    seconds: cfg.sampleSeconds,
    requestedTap: cfg.sampleTapMode,
    tap,
  });

  const completeIfNeeded = () => {
    if (!collecting || writtenBytes < maxBytes) return;
    collecting = false;
    console.log("sample capture buffered", {
      mp3Path: cfg.sampleMp3Path,
      wavPath: cfg.sampleWavPath,
      seconds: cfg.sampleSeconds,
      tap,
      writtenBytes,
    });
    queueMicrotask(flush);
  };

  const writeBuffer = (buffer: Buffer) => {
    if (closed || !collecting || writtenBytes >= maxBytes) return;
    const remainingBytes = maxBytes - writtenBytes;
    const writableBytes = Math.min(buffer.byteLength, remainingBytes);
    const alignedBytes = writableBytes - (writableBytes % 2);
    if (alignedBytes <= 0) return;
    const chunk = Buffer.from(buffer.subarray(0, alignedBytes));
    chunks.push(chunk);
    writtenBytes += alignedBytes;
    completeIfNeeded();
  };

  const flush = () => {
    if (flushed) return;
    flushed = true;
    const pcm = Buffer.concat(chunks, writtenBytes);
    if (cfg.sampleMp3Path) {
      flushMp3Sample(cfg, pcm);
    }
    if (cfg.sampleWavPath) {
      flushWavSample(cfg, pcm);
    }
    console.log("sample capture completed", {
      mp3Path: cfg.sampleMp3Path,
      wavPath: cfg.sampleWavPath,
      seconds: cfg.sampleSeconds,
      tap,
      writtenBytes,
    });
  };

  return {
    tap,
    writeBuffer(buffer) {
      writeBuffer(buffer);
    },
    writeSamples(samples) {
      writeBuffer(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    },
    close() {
      if (closed) return;
      closed = true;
      collecting = false;
      flush();
    },
  };
}

function flushMp3Sample(cfg: Config, pcm: Buffer) {
  const sampleMp3Path = cfg.sampleMp3Path;
  if (!sampleMp3Path) throw new Error("Missing sample mp3 path");
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel", "warning",
    "-f", "s16le",
    "-ar", String(cfg.sampleRate),
    "-ac", String(cfg.channels),
    "-i", "pipe:0",
    "-vn",
    "-c:a", "libmp3lame",
    "-b:a", "320k",
    "-y",
    sampleMp3Path,
  ], {
    encoding: "buffer",
    input: pcm,
    maxBuffer: Math.max(16 * 1024 * 1024, pcm.byteLength * 4),
  });
  if (result.error) throw result.error;
  if (result.stderr?.length) process.stderr.write(result.stderr);
  console.log("sample mp3 capture exited", { path: sampleMp3Path, status: result.status });
}

function flushWavSample(cfg: Config, pcm: Buffer) {
  const sampleWavPath = cfg.sampleWavPath;
  if (!sampleWavPath) throw new Error("Missing sample wav path");
  const fd = openSync(sampleWavPath, "w");
  writeSync(fd, createWavHeader({
    channels: cfg.channels,
    dataBytes: pcm.byteLength,
    sampleRate: cfg.sampleRate,
  }));
  writeSync(fd, pcm);
  closeSync(fd);
  console.log("sample wav capture exited", { bytes: pcm.byteLength, path: sampleWavPath });
}

function createWavHeader(args: {
  channels: number;
  dataBytes: number;
  sampleRate: number;
}) {
  const bitsPerSample = 16;
  const blockAlign = args.channels * bitsPerSample / 8;
  const byteRate = args.sampleRate * blockAlign;
  const chunkSize = 36 + args.dataBytes;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(chunkSize, 4);
  header.write("WAVE", 8, 4, "ascii");
  header.write("fmt ", 12, 4, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(args.channels, 22);
  header.writeUInt32LE(args.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, 4, "ascii");
  header.writeUInt32LE(args.dataBytes, 40);
  return header;
}

function spawnFfmpeg(cfg: Config): ChildProcessByStdio<null, Readable, Readable> {
  const args = cfg.audioSource === "file" ? fileFfmpegArgs(cfg) : deviceFfmpegArgs(cfg);
  console.log("ffmpeg", args.join(" "));
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("exit", (code, signal) => {
    console.log("ffmpeg exited", { code, signal });
    if (code !== 0 && signal === null) process.exitCode = code ?? 1;
  });
  return child;
}

function spawnDeviceCaptureProcess(cfg: Config): ChildProcessByStdio<null, Readable, Readable> {
  if (process.platform === "darwin") {
    try {
      return spawnCoreAudioStream(cfg);
    } catch (error) {
      console.error("coreaudio capture failed, falling back to ffmpeg", error);
    }
  }
  if (cfg.audioSource === "system-tap") {
    throw new Error("system_tap_capture_failed");
  }
  return spawnFfmpeg(cfg);
}

function deviceFfmpegArgs(cfg: Config) {
  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-f", cfg.ffmpegInputFormat,
    "-drop_late_frames", "false",
    ...(cfg.ffmpegAudioDepth ? ["-audio_depth", String(cfg.ffmpegAudioDepth)] : []),
    ...(cfg.ffmpegQueueSizeBytes ? ["-queue_size", String(cfg.ffmpegQueueSizeBytes)] : []),
    "-i", cfg.ffmpegInput,
    "-map", "0:a",
    "-vn",
    "-af", LIVE_LISTEN_FFMPEG_AUDIO_SYNC_FILTER,
    "-ac", String(cfg.channels),
    "-ar", String(cfg.sampleRate),
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "pipe:1",
    ...deviceSourceSampleOutputArgs(cfg),
  ];
}

function deviceCaptureOnlyArgs(cfg: Config) {
  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-f", cfg.ffmpegInputFormat,
    "-drop_late_frames", "false",
    ...(cfg.ffmpegAudioDepth ? ["-audio_depth", String(cfg.ffmpegAudioDepth)] : []),
    ...(cfg.ffmpegQueueSizeBytes ? ["-queue_size", String(cfg.ffmpegQueueSizeBytes)] : []),
    "-i", cfg.ffmpegInput,
    ...deviceSourceSampleOutputArgs(cfg),
  ];
}

function deviceSourceSampleOutputArgs(cfg: Config) {
  if (!useDirectSourceSampleCapture(cfg)) return [];

  const args: string[] = [];
  if (cfg.sampleWavPath) {
    args.push(
      "-map", "0:a",
      "-t", String(cfg.sampleSeconds),
      "-vn",
      "-af", LIVE_LISTEN_FFMPEG_AUDIO_SYNC_FILTER,
      "-ac", String(cfg.channels),
      "-ar", String(cfg.sampleRate),
      "-c:a", "pcm_s16le",
      "-y",
      cfg.sampleWavPath,
    );
  }
  if (cfg.sampleMp3Path) {
    args.push(
      "-map", "0:a",
      "-t", String(cfg.sampleSeconds),
      "-vn",
      "-af", LIVE_LISTEN_FFMPEG_AUDIO_SYNC_FILTER,
      "-ac", String(cfg.channels),
      "-ar", String(cfg.sampleRate),
      "-c:a", "libmp3lame",
      "-b:a", "320k",
      "-y",
      cfg.sampleMp3Path,
    );
  }
  return args;
}

async function runCaptureOnly(cfg: Config) {
  if (process.platform === "darwin") {
    try {
      await runCoreAudioCaptureOnly(cfg);
      return;
    } catch (error) {
      console.error("coreaudio capture-only failed, falling back to ffmpeg", error);
      if (cfg.audioSource === "system-tap") throw error;
    }
  }
  const args = deviceCaptureOnlyArgs(cfg);
  console.log("capture-only ffmpeg", args.join(" "));
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      console.log("capture-only ffmpeg exited", { code, signal });
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`capture_only_ffmpeg_failed:${code ?? "null"}:${signal ?? "none"}`));
    });
  });
}

async function runCoreAudioCaptureOnly(cfg: Config) {
  if (!cfg.sampleWavPath) {
    throw new Error("coreaudio capture-only currently requires PULSE_AUDIO_SAMPLE_WAV_PATH");
  }
  const target = buildCoreAudioCaptureBinary();
  const args = [
    "--mode", cfg.audioSource === "system-tap" ? "system-tap" : "device",
    "--output", resolveUserPath(cfg.sampleWavPath),
    "--sample-rate", String(cfg.sampleRate),
    "--channels", String(cfg.channels),
    "--seconds", String(cfg.sampleSeconds),
    "--stdout-pcm", "0",
  ];
  if (cfg.audioSource === "device") {
    args.splice(2, 0, "--device-name", resolveCoreAudioDeviceName(cfg));
  }
  console.log("capture-only coreaudio", target.appPath, args.join(" "));
  const child = spawnCoreAudioCaptureApp(target.appPath, args, "capture-only");
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      console.log("capture-only coreaudio exited", { code, signal, audioSource: cfg.audioSource });
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`capture_only_coreaudio_failed:${code ?? "null"}:${signal ?? "none"}`));
    });
  });
}

function spawnCoreAudioStream(cfg: Config): ChildProcessByStdio<null, Readable, Readable> {
  const target = buildCoreAudioCaptureBinary();
  const args = [
    "--mode", cfg.audioSource === "system-tap" ? "system-tap" : "device",
    "--sample-rate", String(cfg.sampleRate),
    "--channels", String(cfg.channels),
    "--stdout-pcm", "1",
  ];
  if (cfg.audioSource === "device") {
    args.splice(2, 0, "--device-name", resolveCoreAudioDeviceName(cfg));
  }
  console.log("coreaudio capture", target.appPath, args.join(" "));
  const child = spawn(target.binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("exit", (code, signal) => {
    console.log("coreaudio capture exited", { code, signal, audioSource: cfg.audioSource });
    if (code !== 0 && signal === null) process.exitCode = code ?? 1;
  });
  return child;
}

function buildCoreAudioCaptureBinary(): CoreAudioCaptureTarget {
  const sourcePath = path.join(import.meta.dirname, "coreaudio-capture.swift");
  const appPath = path.join("/tmp", "pulse-coreaudio-capture.app");
  const contentsPath = path.join(appPath, "Contents");
  const macosPath = path.join(contentsPath, "MacOS");
  const binaryPath = path.join(macosPath, "pulse-coreaudio-capture");
  const infoPlistPath = path.join(contentsPath, "Info.plist");
  rmSync(appPath, { recursive: true, force: true });
  mkdirSync(macosPath, { recursive: true });
  writeFileSync(infoPlistPath, coreAudioCaptureInfoPlist());
  const build = spawnSync("xcrun", [
    "swiftc",
    "-O",
    "-Xlinker", "-sectcreate",
    "-Xlinker", "__TEXT",
    "-Xlinker", "__info_plist",
    "-Xlinker", infoPlistPath,
    "-framework", "AudioToolbox",
    "-framework", "CoreAudio",
    sourcePath,
    "-o", binaryPath,
  ], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) {
    throw new Error(`coreaudio_capture_build_failed:${build.status}:${build.stderr}`);
  }
  return { appPath, binaryPath };
}

function spawnCoreAudioCaptureApp(
  appPath: string,
  helperArgs: string[],
  mode: "capture-only" | "stream",
): ChildProcessByStdio<null, Readable, Readable> {
  const stdoutPath = mode === "stream" ? path.join("/tmp", `pulse-coreaudio-capture-${process.pid}.pcm`) : "/dev/null";
  const openArgs = [
    "-n",
    "-W",
    appPath,
    "--args",
    ...helperArgs,
    "--stdout-path", stdoutPath,
  ];
  const child = spawn("open", openArgs, { stdio: ["ignore", "pipe", "pipe"] });
  return child as ChildProcessByStdio<null, Readable, Readable>;
}

function resolveUserPath(filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), filePath);
}

async function requestCoreAudioCapturePermission() {
  const { appPath } = buildCoreAudioCaptureBinary();
  const args = [
    "-W",
    appPath,
    "--args",
    "--mode", "system-tap",
    "--sample-rate", String(DEFAULTS.sampleRate),
    "--channels", String(DEFAULTS.channels),
    "--stdout-pcm", "0",
    "--permission-only", "1",
  ];
  console.log("requesting system audio capture permission", { appPath });
  console.log("If no prompt appears, open System Settings > Privacy & Security > Screen & System Audio Recording and enable Pulse Live Listen Capture.");
  const child = spawn("open", args, { stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      console.log("permission request helper exited", { code, signal });
      if (code === 0) resolve();
      else reject(new Error(`permission_request_failed:${code ?? "null"}:${signal ?? "none"}`));
    });
  });
}

function coreAudioCaptureInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>pulse-coreaudio-capture</string>
  <key>CFBundleIdentifier</key>
  <string>io.github.kt.pulse.live-listen.coreaudio-capture</string>
  <key>CFBundleName</key>
  <string>Pulse Live Listen Capture</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSBackgroundOnly</key>
  <true/>
  <key>NSAudioCaptureUsageDescription</key>
  <string>Pulse captures system audio so web listeners can hear the Live Listen stream.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>Pulse may need screen and system audio recording permission to capture system audio.</string>
</dict>
</plist>
`;
}

function resolveCoreAudioDeviceName(cfg: Config) {
  const selector = cfg.ffmpegInput.trim();
  if (!selector.startsWith(":")) return selector;
  const audioIndex = Number(selector.slice(1));
  if (!Number.isInteger(audioIndex) || audioIndex < 0) {
    throw new Error(`invalid_ffmpeg_audio_selector:${selector}`);
  }
  const list = spawnSync("ffmpeg", [
    "-f", "avfoundation",
    "-list_devices", "true",
    "-i", "",
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const output = `${list.stdout ?? ""}\n${list.stderr ?? ""}`;
  const audioSection = output.split("AVFoundation audio devices:")[1] ?? "";
  const matches = Array.from(audioSection.matchAll(/\[(\d+)\]\s+(.+)/g));
  const entry = matches.find((match) => Number(match[1]) === audioIndex);
  const name = entry?.[2]?.trim();
  if (!name) throw new Error(`unable_to_resolve_audio_device_name:${selector}`);
  return name;
}

function fileFfmpegArgs(cfg: Config) {
  const audioFile = cfg.audioFile;
  if (!audioFile) throw new Error("Missing required env: PULSE_AUDIO_FILE for file source mode");
  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-stream_loop", "-1",
    "-i", audioFile,
    "-vn",
    "-ac", String(cfg.channels),
    "-ar", String(cfg.sampleRate),
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "pipe:1",
  ];
}

function streamPcmFrames({
  cfg,
  ffmpeg,
  source,
  sampleCapture,
  waveformDebug,
}: {
  cfg: Config;
  ffmpeg: ChildProcessByStdio<null, Readable, Readable>;
  source: WrtcNonstandard.RTCAudioSource;
  sampleCapture: SampleCapture | null;
  waveformDebug: SenderWaveformDebugServer | null;
}) {
  const bytesPerSample = 2;
  const frameBytes = Math.floor(cfg.sampleRate * cfg.channels * bytesPerSample * cfg.frameMs / 1000);
  const samplesPerFrame = frameBytes / bytesPerSample;
  const framesPerSecond = 1000 / cfg.frameMs;
  const startupFrames = Math.max(1, Math.ceil(cfg.startupBufferMs / cfg.frameMs));
  const maxQueuedFrames = Math.max(startupFrames + 1, Math.ceil(cfg.maxQueueMs / cfg.frameMs));
  const resumeQueuedFrames = Math.max(startupFrames, Math.floor(maxQueuedFrames * 0.5));
  const silence = new Int16Array(samplesPerFrame);
  const queuedFrames: Int16Array[] = [];
  let pendingBytes = Buffer.alloc(0);
  let sentFrames = 0;
  let clockDrops = 0;
  let droppedFrames = 0;
  let underruns = 0;
  let lateTicks = 0;
  let maxLateMs = 0;
  let pausedInput = false;
  let pacer: ReturnType<typeof startAudioPacer> | null = null;

  const dropQueuedFrames = (framesToDrop: number) => {
    if (framesToDrop <= 0) return;
    const dropCount = Math.min(framesToDrop, queuedFrames.length);
    if (dropCount <= 0) return;
    queuedFrames.splice(0, dropCount);
    clockDrops += dropCount;
  };

  const startPacer = () => {
    if (pacer) return;
    console.log("audio pacer started", { frameMs: cfg.frameMs, startupFrames, queuedFrames: queuedFrames.length });
    pacer = startAudioPacer({
      frameMs: cfg.frameMs,
      maxBurstFrames: cfg.maxBurstFrames,
      onTick: ({ droppedFrames: overdueFrames, framesDue, lateFrames, lateMs }) => {
        if (lateFrames > 0) {
          lateTicks += 1;
          maxLateMs = Math.max(maxLateMs, lateMs);
        }
        dropQueuedFrames(overdueFrames);
        for (let frameIndex = 0; frameIndex < framesDue; frameIndex += 1) {
          const samples = queuedFrames.shift() ?? silence;
          if (samples === silence) underruns += 1;
          if (pausedInput && queuedFrames.length <= resumeQueuedFrames) {
            ffmpeg.stdout.resume();
            pausedInput = false;
          }
          if (samples !== silence && sampleCapture?.tap === "sender") {
            sampleCapture.writeSamples(samples);
          }
          waveformDebug?.record(samples);
          waveformDebug?.updateMetrics({
            clockDrops,
            droppedFrames,
            lateTicks,
            maxLateMs,
            queued: queuedFrames.length,
            underruns,
          });
          sendAudioFrame(cfg, source, samples);
          sentFrames += 1;
          if (sentFrames % Math.round(framesPerSecond * 5) === 0) {
            console.log("pushed audio frames", sentFrames, {
              clockDrops,
              droppedFrames,
              lateTicks,
              maxLateMs: Math.round(maxLateMs * 10) / 10,
              queued: queuedFrames.length,
              underruns,
            });
          }
        }
      },
    });
  };

  ffmpeg.stdout.on("data", (chunk: Buffer) => {
    if (sampleCapture?.tap === "source") sampleCapture.writeBuffer(chunk);
    pendingBytes = Buffer.concat([pendingBytes, chunk]);
    while (pendingBytes.length >= frameBytes) {
      const frame = pendingBytes.subarray(0, frameBytes);
      pendingBytes = pendingBytes.subarray(frameBytes);
      const samples = new Int16Array(samplesPerFrame);
      samples.set(new Int16Array(frame.buffer, frame.byteOffset, samplesPerFrame));
      queuedFrames.push(samples);
      if (queuedFrames.length >= maxQueuedFrames && !pausedInput) {
        ffmpeg.stdout.pause();
        pausedInput = true;
      }
      if (queuedFrames.length > maxQueuedFrames) {
        queuedFrames.shift();
        droppedFrames += 1;
      }
    }
    if (queuedFrames.length >= startupFrames) startPacer();
  });
}

function streamPredecodedFile({
  cfg,
  source,
  sampleCapture,
  waveformDebug,
}: {
  cfg: Config;
  source: WrtcNonstandard.RTCAudioSource;
  sampleCapture: SampleCapture | null;
  waveformDebug: SenderWaveformDebugServer | null;
}) {
  const audioFile = cfg.audioFile;
  if (!audioFile) throw new Error("Missing required env: PULSE_AUDIO_FILE for file source mode");
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-i", audioFile,
    "-vn",
    "-ac", String(cfg.channels),
    "-ar", String(cfg.sampleRate),
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "pipe:1",
  ];
  console.log("ffmpeg predecode", args.join(" "));
  const decoded = spawnSync("ffmpeg", args, {
    encoding: "buffer",
    maxBuffer: Number(process.env.PULSE_AUDIO_FILE_MAX_BUFFER_BYTES ?? 512 * 1024 * 1024),
  });
  if (decoded.error) throw decoded.error;
  if (decoded.status !== 0) {
    const stderr = Buffer.isBuffer(decoded.stderr) ? decoded.stderr.toString() : String(decoded.stderr ?? "");
    throw new Error(`ffmpeg_predecode_failed:${decoded.status}:${stderr}`);
  }

  const pcm = Buffer.from(decoded.stdout);
  const bytesPerSample = 2;
  const frameBytes = Math.floor(cfg.sampleRate * cfg.channels * bytesPerSample * cfg.frameMs / 1000);
  const samplesPerFrame = frameBytes / bytesPerSample;
  const totalFrames = Math.floor(pcm.length / frameBytes);
  if (totalFrames <= 0) throw new Error("audio_file_decoded_no_frames");

  let cursor = 0;
  let sentFrames = 0;
  let clockDrops = 0;
  let lateTicks = 0;
  let maxLateMs = 0;
  console.log("predecoded audio file", {
    bytes: pcm.length,
    totalFrames,
    durationSeconds: Math.round(totalFrames * cfg.frameMs / 100) / 10,
  });

  const pacer = startAudioPacer({
    frameMs: cfg.frameMs,
    maxBurstFrames: cfg.maxBurstFrames,
    onTick: ({ droppedFrames, framesDue, lateFrames, lateMs }) => {
      if (lateFrames > 0) {
        lateTicks += 1;
        maxLateMs = Math.max(maxLateMs, lateMs);
      }
      if (droppedFrames > 0) {
        cursor = (cursor + droppedFrames) % totalFrames;
        clockDrops += droppedFrames;
      }
      for (let frameIndex = 0; frameIndex < framesDue; frameIndex += 1) {
        if (cursor >= totalFrames) cursor = 0;
        const offset = cursor * frameBytes;
        const frame = pcm.subarray(offset, offset + frameBytes);
        const samples = new Int16Array(samplesPerFrame);
        samples.set(new Int16Array(frame.buffer, frame.byteOffset, samplesPerFrame));
        sampleCapture?.writeSamples(samples);
        waveformDebug?.record(samples);
        waveformDebug?.updateMetrics({
          clockDrops,
          lateTicks,
          maxLateMs,
        });
        sendAudioFrame(cfg, source, samples);
        cursor += 1;
        sentFrames += 1;
        if (sentFrames % Math.round(1000 / cfg.frameMs * 5) === 0) {
          console.log("pushed audio frames", sentFrames, {
            clockDrops,
            cursor,
            lateTicks,
            maxLateMs: Math.round(maxLateMs * 10) / 10,
            source: "file",
            totalFrames,
          });
        }
      }
    },
  });
  process.once("SIGINT", () => pacer.stop());
  process.once("SIGTERM", () => pacer.stop());
}

function sendAudioFrame(
  cfg: Config,
  source: WrtcNonstandard.RTCAudioSource,
  samples: Int16Array,
) {
  source.onData({
    samples,
    sampleRate: cfg.sampleRate,
    bitsPerSample: 16,
    channelCount: cfg.channels,
    numberOfFrames: Math.floor(cfg.sampleRate * cfg.frameMs / 1000),
  });
}

async function startHost(cfg: Config, metadata: TrackMetadata | null) {
  const payload = {
    workspaceId: cfg.workspaceId,
    roomId: cfg.roomId,
    hostDeviceId: cfg.hostDeviceId,
    requestedAt: new Date().toISOString(),
    audio: audioSession(cfg, metadata),
  };
  const response = await pulseFetch(cfg, "/api/v1/live-listen/host/start", payload);
  if (!response.ok) throw new Error(`host_start_failed:${response.status}:${await response.text()}`);
}

async function heartbeatHost(cfg: Config, metadata: TrackMetadata | null) {
  const payload = {
    workspaceId: cfg.workspaceId,
    roomId: cfg.roomId,
    hostDeviceId: cfg.hostDeviceId,
    sentAt: new Date().toISOString(),
    audio: audioSession(cfg, metadata),
  };
  const response = await pulseFetch(cfg, "/api/v1/live-listen/host/heartbeat", payload);
  if (!response.ok) throw new Error(`host_heartbeat_failed:${response.status}:${await response.text()}`);
}

async function stopHost(cfg: Config, reason: string) {
  const payload = {
    workspaceId: cfg.workspaceId,
    roomId: cfg.roomId,
    hostDeviceId: cfg.hostDeviceId,
    stoppedAt: new Date().toISOString(),
    reason,
  };
  const response = await pulseFetch(cfg, "/api/v1/live-listen/host/stop", payload);
  if (!response.ok) throw new Error(`host_stop_failed:${response.status}:${await response.text()}`);
}

function audioSession(cfg: Config, metadata: TrackMetadata | null) {
  return {
    transport: "cloudflare-realtime" as const,
    sessionId: metadata?.sessionId ?? "pending-partytracks-session",
    roomName: cfg.roomId,
    publishTrackName: metadata?.trackName ?? "host-audio",
    partyTracksPrefix: "/api/v1/live-listen/partytracks",
    track: {
      location: metadata?.location ?? "remote",
      sessionId: metadata?.sessionId,
      trackName: metadata?.trackName ?? "host-audio",
      mid: undefined,
    },
  };
}

function pulseFetch(cfg: Config, path: string, payload: unknown) {
  return fetch(new URL(path, cfg.pulseBaseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.deviceApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
