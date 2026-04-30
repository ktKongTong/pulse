import {
  LiveListenListenerJoinRequestSchema,
  LiveListenSnapshotSchema,
  LiveListenStreamEnvelopeSchema,
  LiveListenTokenResponseSchema,
  type LiveListenSnapshot,
  type LiveListenStreamEnvelope,
  type LiveListenTokenResponse,
} from "@pulse/realtime-protocol";

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

export async function joinLiveListen(init?: {
  workspaceId?: string;
  roomId?: string;
  participantId?: string;
  signal?: AbortSignal;
}): Promise<LiveListenTokenResponse> {
  const defaults = liveListenDefaults();
  const payload = LiveListenListenerJoinRequestSchema.parse({
    workspaceId: init?.workspaceId ?? defaults.workspaceId,
    roomId: init?.roomId ?? defaults.roomId,
    participantId: init?.participantId ?? liveListenParticipantId(),
    joinedAt: new Date().toISOString(),
  });
  const response = await fetch("/api/v1/live-listen/listener/join", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: init?.signal,
  });
  if (!response.ok) throw new Error(`live_listen_join_failed:${response.status}`);
  return LiveListenTokenResponseSchema.parse(await response.json());
}

export function openLiveListenEvents(init: {
  workspaceId?: string;
  roomId?: string;
  onMessage: (event: LiveListenStreamEnvelope) => void;
  onError?: (event: Event) => void;
}) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = liveListenParams(init);
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/live-listen/events?${params}`);
  socket.addEventListener("message", (event) => {
    const parsed = LiveListenStreamEnvelopeSchema.safeParse(JSON.parse(String(event.data)));
    if (parsed.success) init.onMessage(parsed.data);
  });
  if (init.onError) socket.addEventListener("error", init.onError);
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

function liveListenParams(init?: { workspaceId?: string; roomId?: string }) {
  const defaults = liveListenDefaults();
  const params = new URLSearchParams();
  params.set("workspaceId", init?.workspaceId ?? defaults.workspaceId);
  params.set("roomId", init?.roomId ?? defaults.roomId);
  return params;
}
