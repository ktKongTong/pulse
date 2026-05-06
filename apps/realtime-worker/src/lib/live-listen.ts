import {
  LiveListenMediaSessionEnvelopeSchema,
  LiveListenSnapshotSchema,
  type LiveListenMediaSessionEnvelope,
  type LiveListenSnapshot,
} from "@pulse/realtime-protocol";

export type {
  LiveListenMediaSessionEnvelope,
  LiveListenSnapshot,
} from "@pulse/realtime-protocol";

export type LiveListenMediaSessionRuntimeEvent = LiveListenMediaSessionEnvelope & {
  binaryData?: ArrayBuffer;
};

const DEFAULT_WORKSPACE_ID = "koft";
const DEFAULT_ROOM_ID = "live-listen:owner";

export function liveListenDefaults() {
  return {
    workspaceId: DEFAULT_WORKSPACE_ID,
    roomId: DEFAULT_ROOM_ID,
  };
}

export async function fetchLiveListenSnapshot(init?: {
  workspaceId?: string;
  roomId?: string;
  signal?: AbortSignal;
}): Promise<LiveListenSnapshot> {
  const params = liveListenParams(init);
  const response = await fetch(`/api/v1/live-listen/state?${params}`, {
    signal: init?.signal,
  });
  if (!response.ok) throw new Error(`live_listen_state_failed:${response.status}`);
  return LiveListenSnapshotSchema.parse(await response.json());
}

export function openLiveListenMediaSession(init: {
  workspaceId?: string;
  roomId?: string;
  onMessage: (event: LiveListenMediaSessionRuntimeEvent) => void;
  onError?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onOpen?: (event: Event) => void;
}) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = liveListenParams(init);
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/live-listen/media-session?${params}`);
  socket.binaryType = "arraybuffer";
  let pendingAudioChunk: LiveListenMediaSessionEnvelope | null = null;
  socket.addEventListener("message", async (event) => {
    if (typeof event.data !== "string") {
      const binaryData = await binaryMessageData(event.data);
      if (!binaryData || pendingAudioChunk?.type !== "audio.chunk") return;
      init.onMessage({ ...pendingAudioChunk, binaryData });
      pendingAudioChunk = null;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    const parsed = LiveListenMediaSessionEnvelopeSchema.safeParse(payload);
    if (!parsed.success) return;
    if (parsed.data.type === "audio.chunk" && !parsed.data.data) {
      pendingAudioChunk = parsed.data;
      return;
    }
    pendingAudioChunk = null;
    init.onMessage(parsed.data);
  });
  if (init.onError) socket.addEventListener("error", init.onError);
  if (init.onClose) socket.addEventListener("close", init.onClose);
  if (init.onOpen) socket.addEventListener("open", init.onOpen);
  return socket;
}

export function liveListenParticipantId() {
  const key = "pulse.liveListen.participantId";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = `web-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, next);
  return next;
}

export function liveListenResumeToken(token?: string) {
  const key = "pulse.liveListen.resumeToken";
  if (token) window.localStorage.setItem(key, token);
  return window.localStorage.getItem(key) ?? undefined;
}

function liveListenParams(init?: { workspaceId?: string; roomId?: string }) {
  const defaults = liveListenDefaults();
  const params = new URLSearchParams();
  params.set("workspaceId", init?.workspaceId ?? defaults.workspaceId);
  params.set("roomId", init?.roomId ?? defaults.roomId);
  return params;
}

async function binaryMessageData(data: unknown) {
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Blob) return data.arrayBuffer();
  return null;
}
