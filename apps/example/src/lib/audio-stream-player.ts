import type { ClientAudioChunk } from "@pulse/v2-realtime-react";

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

const WAV_INITIAL_BUFFER_SECONDS = 2;

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
      const buffer = await context.decodeAudioData(bytes);
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
      source.start(wavNextStart);
      wavNextStart += buffer.duration;
    })
    .catch(() => {});
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
  for (const source of wavSources) {
    try {
      source.stop();
    } catch {
      // Already ended sources are removed by their ended event.
    }
  }
  wavSources = [];
  wavChain = Promise.resolve();
}
