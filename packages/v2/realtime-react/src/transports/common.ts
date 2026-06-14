'use client'
import {
  CLIENT_COMMON_WS_PROTOCOL,
  ClientCommonServerFrameSchema,
} from "@ktfun/pulse-protocol";
import { nextConnection } from "../connection";
import { resolveSdkVersion } from "../session";
import type { RealtimeV2StateStore } from "../state";
import type { ClientIdentity, PulseRealtimeV2Config } from "../types";
import { parseTextFrame } from "../utils/frame";
import { closeSocket, isSocketOpenOrConnecting } from "../utils/socket";
import { resolveWsUrl } from "../utils/url";

export class CommonWsTransport {
  private socket: WebSocket | null = null;
  private lastRevision = -1;
  private connectPromise: Promise<ClientIdentity> | null = null;
  private resolveConnect: ((identity: ClientIdentity) => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private closing = false;
  private onUnexpectedClose: (() => void) | null = null;

  constructor(
    private readonly config: PulseRealtimeV2Config,
    private readonly store: RealtimeV2StateStore,
  ) { }

  connect(
    identity: ClientIdentity,
    options: { onUnexpectedClose?: () => void } = {},
  ): Promise<ClientIdentity> {
    const current = this.store.getSnapshot();
    if (current.common.connection.connected && current.identity) {
      return Promise.resolve(current.identity);
    }
    if (isSocketOpenOrConnecting(this.socket) && this.connectPromise) {
      return this.connectPromise;
    }
    this.onUnexpectedClose = options.onUnexpectedClose ?? null;
    closeSocket(this.socket);
    this.socket = null;
    this.closing = false;
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("connecting");
    });

    const socket = new WebSocket(resolveWsUrl(this.config.baseUrl, "/api/v1/client/ws"));
    this.socket = socket;
    this.connectPromise = new Promise<ClientIdentity>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    socket.addEventListener("open", () => this.sendHello(socket, identity));
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.handleClose(socket));
    socket.addEventListener("error", () => this.handleError());
    return this.connectPromise;
  }

  close() {
    this.closing = true;
    closeSocket(this.socket);
    this.socket = null;
    this.rejectPendingConnect("common_ws_closed");
  }

  private sendHello(socket: WebSocket, identity: ClientIdentity) {
    socket.send(JSON.stringify({
      protocol: CLIENT_COMMON_WS_PROTOCOL,
      type: "hello",
      supportedProtocols: [CLIENT_COMMON_WS_PROTOCOL],
      sdkVersion: resolveSdkVersion(this.config),
      sessionId: identity.sessionId,
      tabId: identity.tabId,
    }));
  }

  private handleMessage(raw: unknown) {
    const parsedJson = parseTextFrame(raw);
    if (!parsedJson) return;
    const parsed = ClientCommonServerFrameSchema.safeParse(parsedJson);
    if (!parsed.success) return;
    const frame = parsed.data;
    if (frame.type === "hello_ack") {
      const identity = {
        sessionId: frame.session.sessionId,
        tabId: frame.session.tabId,
        user: frame.session.user,
      };
      this.store.patch((draft) => {
        draft.identity = identity;
        draft.common.connection = nextConnection("connected");
      });
      this.resolveConnect?.(identity);
      this.clearPendingConnect();
      return;
    }
    if (frame.type === "snapshot") {
      if (frame.snapshot.revision <= this.lastRevision) return;
      this.lastRevision = frame.snapshot.revision;
      this.store.patch((draft) => {
        draft.common.snapshot = frame.snapshot;
      });
      return;
    }
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("error", frame.code);
    });
    this.rejectPendingConnect(frame.code);
  }

  private handleClose(socket: WebSocket) {
    if (this.socket === socket) this.socket = null;
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("closed");
    });
    if (!this.closing) this.rejectPendingConnect("common_ws_closed");
    if (!this.closing) this.onUnexpectedClose?.();
  }

  private handleError() {
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("error", "common_ws_error");
    });
    this.rejectPendingConnect("common_ws_error");
  }

  private rejectPendingConnect(code: string) {
    this.rejectConnect?.(new Error(code));
    this.clearPendingConnect();
  }

  private clearPendingConnect() {
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
  }
}
