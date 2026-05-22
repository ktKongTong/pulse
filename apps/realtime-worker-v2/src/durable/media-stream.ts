import { CLIENT_MEDIA_WS_PROTOCOL } from "@pulse/v2-realtime-protocol";
import type { ClientAttachment, MediaStoredState, StreamContext } from "../state/media";
import { tabKey } from "../state/keys";
import { nowIso } from "../utils/time";
import { safeSend } from "../utils/ws";

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

export function notifyStreamStopped(
  clients: Map<string, WebSocket>,
  attachment: ClientAttachment,
) {
  safeSend(clients.get(tabKey(attachment.sessionId, attachment.tabId)), {
    protocol: CLIENT_MEDIA_WS_PROTOCOL,
    type: "stream.stopped",
  });
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
