'use client'
import type { ClientMediaAudioChunkFrame } from "@ktfun/pulse-protocol";
import type { ClientAudioChunk, StreamRuntimeState } from "../types";

export function validChunkForStream(
  frame: ClientMediaAudioChunkFrame,
  stream: StreamRuntimeState,
) {
  return stream.state === "active" &&
    stream.streamId === frame.streamId &&
    stream.generation === frame.generation;
}

export function buildAudioChunk(
  frame: ClientMediaAudioChunkFrame,
  bytes: ArrayBuffer,
): ClientAudioChunk | null {
  if (bytes.byteLength !== frame.byteLength) return null;
  return {
    streamId: frame.streamId,
    generation: frame.generation,
    seq: frame.seq,
    sentAt: frame.sentAt,
    durationMs: frame.durationMs,
    codec: frame.codec,
    replayed: frame.replayed,
    bytes,
  };
}
