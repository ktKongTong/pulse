import {
  CLIENT_COMMON_WS_PROTOCOL,
  ClientCommonServerFrameSchema,
} from "@pulse/v2-realtime-protocol";
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

  constructor(
    private readonly config: PulseRealtimeV2Config,
    private readonly store: RealtimeV2StateStore,
  ) { }

  connect(identity: ClientIdentity) {
    if (isSocketOpenOrConnecting(this.socket)) return;
    closeSocket(this.socket);
    this.socket = null;
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("connecting");
    });

    const socket = new WebSocket(resolveWsUrl(this.config.baseUrl, "/api/v1/client/ws"));
    this.socket = socket;
    socket.addEventListener("open", () => this.sendHello(socket, identity));
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.handleClose(socket));
    socket.addEventListener("error", () => this.handleError());
  }

  close() {
    closeSocket(this.socket);
    this.socket = null;
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
      this.store.patch((draft) => {
        draft.identity = {
          sessionId: frame.session.sessionId,
          tabId: frame.session.tabId,
          user: frame.session.user,
        };
        draft.common.connection = nextConnection("connected");
      });
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
  }

  private handleClose(socket: WebSocket) {
    if (this.socket === socket) this.socket = null;
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("closed");
    });
  }

  private handleError() {
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("error", "common_ws_error");
    });
  }
}
