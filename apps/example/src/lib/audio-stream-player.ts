import type { ClientAudioChunk } from "@ktfun/pulse";

type SourceState = {
  audio: HTMLAudioElement;
  mediaSource: MediaSource;
  sourceBuffer: SourceBuffer | null;
  queue: ArrayBuffer[];
  streamKey: string | null;
};

let state: SourceState | null = null;
let unlocked = false;
let wavContext: AudioContext | null = null;
let wavNextStart = 0;
let wavStreamKey: string | null = null;
let wavToken = 0;
let wavChain: Promise<void> = Promise.resolve();
let wavSources: AudioBufferSourceNode[] = [];
let wavScheduledSegments: WavScheduledSegment[] = [];
let progressTimer: number | null = null;
let progressSnapshot: StreamPlaybackProgress | null = null;
const progressListeners = new Set<() => void>();

const WAV_INITIAL_BUFFER_SECONDS = 2;

export type StreamPlaybackProgress = {
  streamKey: string;
  streamId: string;
  generation: number;
  seq: number;
  progressMs: number;
  durationMs: number;
  audioStartTime: number;
  audioEndTime: number;
};

export type MediaProgressAnchor = {
  progressMs: number;
  updatedAt?: string;
  playbackState: "playing" | "paused";
};

type WavScheduledSegment = {
  streamKey: string;
  streamId: string;
  generation: number;
  seq: number;
  mediaStartPositionMs: number;
  durationMs: number;
  audioStartTime: number;
  audioEndTime: number;
};

export function unlockAudioStream() {
  if (typeof window === "undefined") return;
  unlocked = true;
  const current = ensureState();
  const context = ensureWavContext();
  void context?.resume().catch(() => {});
  void current.audio.play().catch(() => {
    // Browser may wait until the first buffered chunk is appended.
  });
}

export function pushAudioChunk(chunk: ClientAudioChunk) {
  if (typeof window === "undefined") return;
  if (chunk.codec === "pcm16-wav") {
    pushWavChunk(chunk);
    return;
  }
  if (chunk.codec !== "mp3") return;
  const current = ensureState();
  const streamKey = `${chunk.streamId}:${chunk.generation}`;
  if (current.streamKey && current.streamKey !== streamKey) resetSource(current);
  current.streamKey = streamKey;
  current.queue.push(chunk.bytes.slice(0));
  drainQueue(current);
  if (unlocked) {
    void current.audio.play().catch(() => {});
  }
}

function pushWavChunk(chunk: ClientAudioChunk) {
  const streamKey = `${chunk.streamId}:${chunk.generation}`;
  if (wavStreamKey && wavStreamKey !== streamKey) resetWavStream();
  wavStreamKey = streamKey;
  const bytes = chunk.bytes.slice(0);
  const token = wavToken;
  wavChain = wavChain
    .then(async () => {
      const context = ensureWavContext();
      if (!context || token !== wavToken) return;
      if (unlocked) await context.resume().catch(() => {});
      const buffer = decodePcm16WavChunk(context, bytes);
      if (token !== wavToken) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      wavSources.push(source);
      source.addEventListener("ended", () => {
        wavSources = wavSources.filter((item) => item !== source);
      });
      wavNextStart =
        wavNextStart > context.currentTime
          ? wavNextStart
          : context.currentTime + WAV_INITIAL_BUFFER_SECONDS;
      const audioStartTime = wavNextStart;
      const audioEndTime = audioStartTime + buffer.duration;
      wavScheduledSegments.push({
        streamKey,
        streamId: chunk.streamId,
        generation: chunk.generation,
        seq: chunk.seq,
        mediaStartPositionMs: chunk.mediaStartPositionMs,
        durationMs: chunk.durationMs,
        audioStartTime,
        audioEndTime,
      });
      source.start(audioStartTime);
      wavNextStart += buffer.duration;
      startProgressTimer();
    })
    .catch(() => {});
}

export function getStreamPlaybackProgress(): StreamPlaybackProgress | null {
  return progressSnapshot;
}

export function subscribeStreamPlaybackProgress(listener: () => void) {
  progressListeners.add(listener);
  startProgressTimer();
  return () => {
    progressListeners.delete(listener);
    stopProgressTimerIfIdle();
  };
}

export function reconcileStreamPlaybackProgress(media: MediaProgressAnchor | null) {
  if (!media || media.playbackState !== "playing") {
    clearPlaybackProgress();
    return;
  }
  const current = getStreamPlaybackProgress();
  if (!current) return;
  const serverProgressMs = resolveMediaAnchorProgressMs(media);
  if (serverProgressMs === null) return;
  if (Math.abs(serverProgressMs - current.progressMs) > 2_000) {
    clearPlaybackProgress();
  }
}

function decodePcm16WavChunk(context: AudioContext, bytes: ArrayBuffer): AudioBuffer {
  const view = new DataView(bytes);
  if (
    view.byteLength < 44 ||
    readAscii(view, 0, 4) !== "RIFF" ||
    readAscii(view, 8, 4) !== "WAVE"
  ) {
    throw new Error("Invalid WAV chunk");
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyOffset = offset + 8;
    if (bodyOffset + chunkSize > view.byteLength) break;

    if (chunkId === "fmt ") {
      const audioFormat = view.getUint16(bodyOffset, true);
      channels = view.getUint16(bodyOffset + 2, true);
      sampleRate = view.getUint32(bodyOffset + 4, true);
      bitsPerSample = view.getUint16(bodyOffset + 14, true);
      if (audioFormat !== 1 || bitsPerSample !== 16) {
        throw new Error("Unsupported WAV chunk format");
      }
    } else if (chunkId === "data") {
      dataOffset = bodyOffset;
      dataSize = chunkSize;
      break;
    }

    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (channels <= 0 || sampleRate <= 0 || dataOffset < 0 || dataSize <= 0) {
    throw new Error("Incomplete WAV chunk");
  }

  const frameCount = Math.floor(dataSize / (channels * 2));
  const buffer = context.createBuffer(channels, frameCount, sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const sampleOffset = dataOffset + (frame * channels + channel) * 2;
      channelData[frame] = view.getInt16(sampleOffset, true) / 32768;
    }
  }
  return buffer;
}

function readAscii(view: DataView, offset: number, length: number) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

function ensureState(): SourceState {
  if (state) return state;
  const audio = new Audio();
  audio.autoplay = true;
  audio.preload = "auto";
  const mediaSource = new MediaSource();
  audio.src = URL.createObjectURL(mediaSource);
  state = { audio, mediaSource, sourceBuffer: null, queue: [], streamKey: null };
  mediaSource.addEventListener("sourceopen", () => createSourceBuffer(state!));
  return state;
}

function createSourceBuffer(current: SourceState) {
  if (current.sourceBuffer || current.mediaSource.readyState !== "open") return;
  if (!MediaSource.isTypeSupported("audio/mpeg")) return;
  current.sourceBuffer = current.mediaSource.addSourceBuffer("audio/mpeg");
  current.sourceBuffer.mode = "sequence";
  current.sourceBuffer.addEventListener("updateend", () => drainQueue(current));
  drainQueue(current);
}

function drainQueue(current: SourceState) {
  const buffer = current.sourceBuffer;
  if (!buffer || buffer.updating || current.queue.length === 0) return;
  const next = current.queue.shift();
  if (!next) return;
  try {
    buffer.appendBuffer(next);
  } catch {
    current.queue.unshift(next);
  }
}

function resetSource(current: SourceState) {
  current.queue = [];
  current.streamKey = null;
  const buffer = current.sourceBuffer;
  if (!buffer || buffer.updating) return;
  try {
    if (buffer.buffered.length > 0) {
      buffer.remove(buffer.buffered.start(0), buffer.buffered.end(buffer.buffered.length - 1));
    }
  } catch {
    // If the browser rejects removal, let the next append continue in sequence mode.
  }
}

function ensureWavContext(): AudioContext | null {
  if (wavContext) return wavContext;
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) return null;
  wavContext = new AudioContextCtor();
  return wavContext;
}

function resetWavStream() {
  wavStreamKey = null;
  wavNextStart = 0;
  wavToken += 1;
  wavScheduledSegments = [];
  publishProgress(null);
  for (const source of wavSources) {
    try {
      source.stop();
    } catch {
      // Already ended sources are removed by their ended event.
    }
  }
  wavSources = [];
  wavChain = Promise.resolve();
  stopProgressTimerIfIdle();
}

function clearPlaybackProgress() {
  wavScheduledSegments = [];
  publishProgress(null);
  stopProgressTimerIfIdle();
}

function startProgressTimer() {
  if (progressTimer !== null || typeof window === "undefined") return;
  updateProgressSnapshot();
  progressTimer = window.setInterval(() => {
    updateProgressSnapshot();
  }, 250);
}

function stopProgressTimerIfIdle() {
  if (progressTimer === null || progressListeners.size > 0 || wavScheduledSegments.length > 0) {
    return;
  }
  window.clearInterval(progressTimer);
  progressTimer = null;
}

function updateProgressSnapshot() {
  const context = wavContext;
  if (!context) {
    publishProgress(null);
    return;
  }
  const now = context.currentTime;
  wavScheduledSegments = wavScheduledSegments.filter(
    (segment) => segment.audioEndTime > now - 0.5
  );
  const active =
    wavScheduledSegments.find(
      (segment) => segment.audioStartTime <= now && segment.audioEndTime >= now
    ) ?? null;
  if (!active) {
    if (wavScheduledSegments.length === 0) publishProgress(null);
    stopProgressTimerIfIdle();
    return;
  }
  publishProgress({
    streamKey: active.streamKey,
    streamId: active.streamId,
    generation: active.generation,
    seq: active.seq,
    progressMs:
      active.mediaStartPositionMs +
      Math.max(0, now - active.audioStartTime) * 1_000,
    durationMs: active.durationMs,
    audioStartTime: active.audioStartTime,
    audioEndTime: active.audioEndTime,
  });
}

function publishProgress(next: StreamPlaybackProgress | null) {
  const previous = progressSnapshot;
  progressSnapshot = next;
  if (
    previous?.streamKey === next?.streamKey &&
    previous?.seq === next?.seq &&
    Math.abs((previous?.progressMs ?? 0) - (next?.progressMs ?? 0)) < 100
  ) {
    return;
  }
  for (const listener of progressListeners) listener();
}

function resolveMediaAnchorProgressMs(media: MediaProgressAnchor) {
  const baseline = media.progressMs;
  if (!Number.isFinite(baseline)) return null;
  if (media.playbackState !== "playing") return baseline;
  const updatedAtMs = Date.parse(media.updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return baseline;
  return baseline + Math.max(0, Date.now() - updatedAtMs);
}
