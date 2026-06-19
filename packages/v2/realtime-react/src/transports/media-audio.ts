'use client'
import type { ClientWsAudioChunkFrame } from "@ktfun/pulse-protocol";
import type { ClientAudioChunk, StreamRuntimeState } from "../types";

export function validChunkForStream(
  frame: ClientWsAudioChunkFrame,
  stream: StreamRuntimeState,
) {
  return stream.state === "active" &&
    stream.streamId === frame.streamId &&
    stream.generation === frame.generation;
}

export function buildAudioChunk(
  frame: ClientWsAudioChunkFrame,
  bytes: ArrayBuffer,
): ClientAudioChunk | null {
  if (bytes.byteLength !== frame.byteLength) return null;
  return {
    streamId: frame.streamId,
    generation: frame.generation,
    seq: frame.seq,
    sentAt: frame.sentAt,
    durationMs: frame.durationMs,
    mediaStartPositionMs: frame.mediaStartPositionMs,
    codec: frame.codec,
    replayed: frame.replayed,
    bytes,
  };
}
