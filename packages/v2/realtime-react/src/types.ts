import type {
  ClientCommonGlobalSnapshot,
  ClientMediaNowPlaying,
  ClientMediaStreamSource,
  ClientPageSnapshot,
  ClientUser,
  OwnerFocus,
} from "@ktfun/pulse-protocol";

export type ConnectionStatus =
  | "idle"
  | "claiming_session"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export type StreamRuntimeState =
  | { state: "observer" }
  | { state: "requesting"; requestId: string }
  | { state: "active"; streamId: string; generation: number };

export interface ClientAudioChunk {
  streamId: string;
  generation: number;
  seq: number;
  sentAt: string;
  durationMs: number;
  mediaStartPositionMs: number;
  codec: string;
  replayed: boolean;
  bytes: ArrayBuffer;
}

export interface PulseRealtimeV2Config {
  baseUrl?: string;
  sdkVersion?: string;
  sessionStorageKey?: string;
  tabStorageKey?: string;
  autoConnectCommon?: boolean;
  autoConnectMedia?: boolean;
  onAudioChunk?: (chunk: ClientAudioChunk) => void;
}

export interface ClientIdentity {
  sessionId: string;
  tabId: string;
  user?: ClientUser;
}

export interface ClientConnectionState {
  status: ConnectionStatus;
  error: string | null;
  connected: boolean;
  updatedAt: string | null;
}

export interface ClientMediaState {
  connection: ClientConnectionState;
  source: ClientMediaStreamSource;
  media: ClientMediaNowPlaying | null;
  stream: StreamRuntimeState;
}

export interface PulseRealtimeV2Snapshot {
  identity: ClientIdentity | null;
  common: {
    connection: ClientConnectionState;
    snapshot: ClientCommonGlobalSnapshot | null;
  };
  pages: Record<
    string,
    {
      connection: ClientConnectionState;
      snapshot: ClientPageSnapshot | null;
    }
  >;
  media: ClientMediaState;
}

export interface GlobalOnlineCountView {
  sessionCount: number;
}

export interface ActivePagesView {
  activePageCount: number;
  activePages: Array<{
    canonicalUrl: string;
    title?: string;
    url?: string;
    sessionCount: number;
  }>;
}

export type OwnerFocusView = OwnerFocus | null;

export interface GlobalSessionPreviewView {
  sessionCount: number;
  sessions: Array<{
    sessionId: string;
    user?: ClientUser;
  }>;
}

export interface GlobalSessionActivityView {
  sessions: Array<{
    sessionId: string;
    user?: ClientUser;
    pages: ClientCommonGlobalSnapshot["sessions"]["recent"][number]["pages"];
  }>;
}

export interface PageReadersView {
  canonicalUrl: string;
  sessionCount: number;
  sessions: Array<{
    sessionId: string;
    progress?: {
      percent?: number;
      scrollY?: number;
    };
  }>;
}
