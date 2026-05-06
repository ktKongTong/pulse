import {
  LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1,
  type LiveListenMediaSessionClientMessage,
  type LiveListenMediaSessionEnvelope,
  type LiveListenMediaSessionSnapshot,
} from "@pulse/realtime-protocol";

import { openLiveListenMediaSession } from "./live-listen";

type WebLiveListenWsState = "on" | "off" | "half-off" | "error";

export type LiveListenMediaSessionStoreState = {
  ws: WebLiveListenWsState;
  snapshot: LiveListenMediaSessionSnapshot | null;
  loading: boolean;
  lastError: string | null;
};

const RECONNECT_DELAY_MS = 3_000;

let storeState: LiveListenMediaSessionStoreState = {
  ws: "off",
  snapshot: null,
  loading: true,
  lastError: null,
};
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
const storeListeners = new Set<() => void>();
const envelopeListeners = new Set<(event: LiveListenMediaSessionEnvelope) => void>();

export function subscribeLiveListenMediaSessionStore(listener: () => void) {
  storeListeners.add(listener);
  ensureLiveListenMediaSessionSocket();
  return () => {
    storeListeners.delete(listener);
    closeIfUnused();
  };
}

export function getLiveListenMediaSessionStoreSnapshot() {
  return storeState;
}

export function subscribeLiveListenMediaSessionEvents(listener: (event: LiveListenMediaSessionEnvelope) => void) {
  envelopeListeners.add(listener);
  ensureLiveListenMediaSessionSocket();
  return () => {
    envelopeListeners.delete(listener);
    closeIfUnused();
  };
}

export function sendLiveListenMediaSessionMessage(message: LiveListenMediaSessionClientMessage) {
  ensureLiveListenMediaSessionSocket();
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

export function liveListenMediaSessionListenRequest(init: {
  participantId: string;
  resumeToken?: string;
  streamId?: string;
  sourceGeneration?: number;
  fromSeq?: number;
}): LiveListenMediaSessionClientMessage {
  return {
    protocol: LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1,
    type: "listen.request",
    participantId: init.participantId,
    resumeToken: init.resumeToken,
    streamId: init.streamId,
    sourceGeneration: init.sourceGeneration,
    fromSeq: init.fromSeq,
  };
}

export function liveListenMediaSessionStop(participantId?: string): LiveListenMediaSessionClientMessage {
  return {
    protocol: LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1,
    type: "listen.stop",
    participantId,
  };
}

export function liveListenMediaSessionAck(seq: number): LiveListenMediaSessionClientMessage {
  return {
    protocol: LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1,
    type: "ack",
    seq,
  };
}

function ensureLiveListenMediaSessionSocket() {
  if (socket || reconnectTimer !== null) return;
  setStoreState({
    ...storeState,
    ws: storeState.snapshot ? "half-off" : "off",
    loading: storeState.snapshot ? false : true,
    lastError: null,
  });
  socket = openLiveListenMediaSession({
    onOpen: () => {
      setStoreState({
        ...storeState,
        ws: "on",
        lastError: null,
      });
    },
    onMessage: (event) => {
      if (event.type === "media.snapshot.updated") {
        setStoreState({
          ws: "on",
          snapshot: event.snapshot,
          loading: false,
          lastError: null,
        });
      }
      for (const listener of envelopeListeners) listener(event);
    },
    onError: () => {
      setStoreState({
        ...storeState,
        ws: "error",
        loading: false,
        lastError: "live_listen_media_session_ws_error",
      });
    },
    onClose: (event) => {
      socket = null;
      if (!hasSubscribers()) {
        setStoreState({
          ...storeState,
          ws: "off",
          loading: false,
        });
        return;
      }
      setStoreState({
        ...storeState,
        ws: event.code === 1000 ? "off" : "half-off",
        loading: false,
        lastError: event.code === 1000 ? null : `closed code=${event.code}`,
      });
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        ensureLiveListenMediaSessionSocket();
      }, RECONNECT_DELAY_MS);
    },
  });
}

function closeIfUnused() {
  if (hasSubscribers()) return;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close(1000, "media session unused");
  socket = null;
  setStoreState({
    ...storeState,
    ws: "off",
    loading: false,
  });
}

function hasSubscribers() {
  return storeListeners.size > 0 || envelopeListeners.size > 0;
}

function setStoreState(next: LiveListenMediaSessionStoreState) {
  storeState = next;
  for (const listener of storeListeners) listener();
}
