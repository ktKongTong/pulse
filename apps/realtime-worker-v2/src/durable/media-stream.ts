import type { MediaStoredState, StreamContext } from "../state/media";
import { nowIso } from "../utils/time";

export function ensureStreamContext(
  state: MediaStoredState,
  streamId: string = crypto.randomUUID(),
  generation = 1,
) {
  if (!state.streamContext) {
    const now = nowIso();
    state.streamContext = {
      streamId, generation, latestSeq: 0, availableFromSeq: 0,
      codec: state.deviceStreamState?.streamFormat?.codec ?? "pcm16-wav",
      format: state.deviceStreamState?.streamFormat,
      openedAt: now, updatedAt: now,
    };
  }
  return state.streamContext;
}

export function applyAcceptedStream(
  context: StreamContext,
  payload: {
    firstSeq: number;
    streamFormat?: StreamContext["format"];
    sentAt: string;
  },
) {
  context.latestSeq = payload.firstSeq;
  context.availableFromSeq = payload.firstSeq;
  context.format = payload.streamFormat;
  context.updatedAt = payload.sentAt;
}
