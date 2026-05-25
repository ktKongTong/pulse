'use client'
import {
  CLIENT_PAGE_WS_PROTOCOL,
  ClientPageServerFrameSchema,
  type ClientPageMetadata,
  type ClientPageSnapshot,
} from "@ktfun/pulse-protocol";
import { nextConnection } from "../connection";
import { resolveSdkVersion } from "../session";
import type { RealtimeV2StateStore } from "../state";
import type { ClientIdentity, PulseRealtimeV2Config } from "../types";
import { parseTextFrame } from "../utils/frame";
import { closeSocket, isSocketOpenOrConnecting } from "../utils/socket";
import { nowIso } from "../utils/time";
import { resolveWsUrl } from "../utils/url";

export class PageWsTransport {
  private sockets = new Map<string, WebSocket>();
  private revisions = new Map<string, number>();

  constructor(
    private readonly config: PulseRealtimeV2Config,
    private readonly store: RealtimeV2StateStore,
  ) { }

  connect(canonicalUrl: string, identity: ClientIdentity, page?: ClientPageMetadata) {
    if (isSocketOpenOrConnecting(this.sockets.get(canonicalUrl) ?? null)) return;
    this.close(canonicalUrl);
    this.store.patch((draft) => {
      draft.pages[canonicalUrl] = {
        connection: nextConnection("connecting"),
        snapshot: draft.pages[canonicalUrl]?.snapshot ?? null,
      };
    });
    const path = `/api/v1/client/page/ws?canonicalUrl=${encodeURIComponent(canonicalUrl)}`;
    const socket = new WebSocket(resolveWsUrl(this.config.baseUrl, path));
    this.sockets.set(canonicalUrl, socket);
    socket.addEventListener("open", () => this.sendHello(socket, identity, page));
    socket.addEventListener("message", (event) => {
      this.handleMessage(canonicalUrl, event.data);
    });
    socket.addEventListener("close", () => this.handleClose(canonicalUrl, socket));
    socket.addEventListener("error", () => this.handleError(canonicalUrl));
  }

  update(canonicalUrl: string, frame: PageUpdateInput) {
    const socket = this.sockets.get(canonicalUrl);
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({
      protocol: CLIENT_PAGE_WS_PROTOCOL,
      type: "page.update",
      seq: frame.seq,
      observedAt: frame.observedAt ?? nowIso(),
      reading: frame.reading,
      page: frame.page,
    }));
    return true;
  }

  leave(canonicalUrl: string, frame: PageLeaveInput) {
    const socket = this.sockets.get(canonicalUrl);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.close(canonicalUrl);
      return false;
    }
    socket.send(JSON.stringify({
      protocol: CLIENT_PAGE_WS_PROTOCOL,
      type: "leave",
      seq: frame.seq,
      observedAt: frame.observedAt ?? nowIso(),
      transition: frame.transition,
    }));
    this.close(canonicalUrl);
    return true;
  }

  close(canonicalUrl: string) {
    const socket = this.sockets.get(canonicalUrl);
    this.sockets.delete(canonicalUrl);
    closeSocket(socket ?? null);
  }

  closeAll() {
    for (const socket of this.sockets.values()) closeSocket(socket);
    this.sockets.clear();
  }

  private sendHello(socket: WebSocket, identity: ClientIdentity, page?: ClientPageMetadata) {
    socket.send(JSON.stringify({
      protocol: CLIENT_PAGE_WS_PROTOCOL,
      type: "hello",
      supportedProtocols: [CLIENT_PAGE_WS_PROTOCOL],
      sdkVersion: resolveSdkVersion(this.config),
      sessionId: identity.sessionId,
      tabId: identity.tabId,
      page,
    }));
  }

  private handleMessage(canonicalUrl: string, raw: unknown) {
    const parsedJson = parseTextFrame(raw);
    if (!parsedJson) return;
    const parsed = ClientPageServerFrameSchema.safeParse(parsedJson);
    if (!parsed.success) return;
    const frame = parsed.data;
    if (frame.type === "hello_ack") {
      this.setConnection(canonicalUrl, "connected");
    } else if (frame.type === "snapshot") {
      this.applySnapshot(canonicalUrl, frame.snapshot);
    } else {
      this.setConnection(canonicalUrl, "error", frame.code);
    }
  }

  private applySnapshot(canonicalUrl: string, snapshot: ClientPageSnapshot) {
    const previousRevision = this.revisions.get(canonicalUrl) ?? -1;
    if (snapshot.revision <= previousRevision) return;
    this.revisions.set(canonicalUrl, snapshot.revision);
    this.store.patch((draft) => {
      draft.pages[canonicalUrl] = {
        connection: draft.pages[canonicalUrl]?.connection ?? nextConnection("connected"),
        snapshot,
      };
    });
  }

  private handleClose(canonicalUrl: string, socket: WebSocket) {
    if (this.sockets.get(canonicalUrl) === socket) this.sockets.delete(canonicalUrl);
    this.setConnection(canonicalUrl, "closed");
  }

  private handleError(canonicalUrl: string) {
    this.setConnection(canonicalUrl, "error", "page_ws_error");
  }

  private setConnection(
    canonicalUrl: string,
    status: "connected" | "closed" | "error",
    error: string | null = null,
  ) {
    this.store.patch((draft) => {
      const page = draft.pages[canonicalUrl];
      if (page) page.connection = nextConnection(status, error);
    });
  }
}

export interface PageUpdateInput {
  seq: number;
  observedAt?: string;
  reading?: { percent?: number; scrollY?: number };
  page?: ClientPageMetadata;
}

export interface PageLeaveInput {
  seq: number;
  observedAt?: string;
  transition?: {
    toCanonicalUrl: string;
    navigationId: string;
    startedAt: string;
  };
}
