import { DEVICE_MEDIA_PROTOCOL } from "@ktfun/pulse-protocol";
import { readFile } from "node:fs/promises";
import type { JsonObject, JsonSocket } from "./socket";

export type ActiveStream = {
  streamId: string;
  generation: number;
  seq: number;
  offset: number;
  timer: ReturnType<typeof setInterval> | null;
};

const sampleUrl = new URL("./sample.mp3", import.meta.url);
const chunkDurationMs = Number(process.env.PULSE_V2_MOCK_CHUNK_MS ?? "200");
const bytesPerSecond = Number(process.env.PULSE_V2_MOCK_BYTES_PER_SECOND ?? "16000");
const sampleBytes = await loadSampleBytes();

export function createActiveStream(streamId: string, generation: number): ActiveStream {
  return { streamId, generation, seq: 0, offset: 0, timer: null };
}

export function startMp3Stream(socket: JsonSocket, stream: ActiveStream) {
  stopMp3Stream(stream);
  publishAudioChunk(socket, stream);
  stream.timer = setInterval(() => publishAudioChunk(socket, stream), chunkDurationMs);
}

export function stopMp3Stream(stream: ActiveStream | null) {
  if (stream?.timer) clearInterval(stream.timer);
  if (stream) stream.timer = null;
}

export function publishAudioChunk(socket: JsonSocket, stream: ActiveStream) {
  const bytes = nextBytes(stream);
  const sentAt = new Date().toISOString();
  socket.sendJson({
    protocol: DEVICE_MEDIA_PROTOCOL,
    type: "audio.chunk",
    payload: {
      streamId: stream.streamId,
      generation: stream.generation,
      seq: stream.seq,
      sentAt,
      durationMs: chunkDurationMs,
      byteLength: bytes.byteLength,
      mediaStartPositionMs: stream.seq * chunkDurationMs,
      clock: {
        mediaProgressSeconds: (stream.seq * chunkDurationMs) / 1000,
        durationSeconds: Math.ceil(sampleBytes.byteLength / bytesPerSecond),
        updatedAt: sentAt,
      },
    },
  });
  socket.sendBinary(bytes);
  stream.seq += 1;
}

export function streamRequestedAck(payload: JsonObject, stream: ActiveStream) {
  return {
    protocol: DEVICE_MEDIA_PROTOCOL,
    type: "ack",
    payload: {
      commandId: payload.commandId,
      commandType: "stream.requested",
      status: "accepted",
      streamId: stream.streamId,
      generation: stream.generation,
      firstSeq: stream.seq,
      capture: { provider: "mock", displayName: "Sample MP3", appId: "mock" },
      streamFormat: streamFormat(),
      sentAt: new Date().toISOString(),
    },
  };
}

export function streamStoppedAck(payload: JsonObject, stream: ActiveStream) {
  return {
    protocol: DEVICE_MEDIA_PROTOCOL,
    type: "ack",
    payload: {
      commandId: payload.commandId,
      commandType: "stream.stop",
      status: "stopped",
      streamId: stream.streamId,
      generation: stream.generation,
      sentAt: new Date().toISOString(),
    },
  };
}

function nextBytes(stream: ActiveStream) {
  const size = Math.max(1, Math.ceil((bytesPerSecond * chunkDurationMs) / 1000));
  const bytes = new Uint8Array(new ArrayBuffer(size));
  for (let index = 0; index < size; index += 1) {
    bytes[index] = sampleBytes[stream.offset];
    stream.offset = (stream.offset + 1) % sampleBytes.byteLength;
  }
  return bytes;
}

async function loadSampleBytes() {
  return new Uint8Array(await readFile(sampleUrl));
}

function streamFormat() {
  return { codec: "mp3", sampleRate: 44_100, channels: 2 };
}
