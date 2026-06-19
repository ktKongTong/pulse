import { DurableObject } from "cloudflare:workers";
import {
  CLIENT_WS_PROTOCOL,
  ClientSessionClaimRequestSchema,
  ClientWsClientFrameSchema,
  type ClientSessionClaimResponse,
  type ClientUser,
  type OwnerFocus,
} from "@ktfun/pulse-protocol";
import type { Env } from "../env";
import { mediaStub, pageStub } from "../env";
import { buildGlobalSnapshot, emptyGlobalState, type CommonConnectionMeta, type GlobalStoredState, type PageAggregate } from "../state/client";
import { ownerFocusEqual, pageAggregateEqual } from "../state/client-equality";
import { tabKey } from "../state/keys";
import { fatalError } from "../utils/error";
import { parseFrame } from "../utils/frame";
import { createAcceptedPair, upgradeResponse } from "../utils/pair";
import { nowIso } from "../utils/time";
import { closeWith, safeSend, socketAttachment } from "../utils/ws";

interface ClientAttachment extends CommonConnectionMeta {
  protocol: typeof CLIENT_WS_PROTOCOL;
}

const STATE_KEY = "global-state";

export class GlobalDO extends DurableObject<Env> {
  private state: GlobalStoredState = emptyGlobalState(nowIso());
  private connections = new Map<string, WebSocket>();
  private tabPages = new Map<string, Set<string>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.restoreSockets();
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<GlobalStoredState>(STATE_KEY)) ?? emptyGlobalState(nowIso());
    });
  }

  async claimSession(request: unknown): Promise<ClientSessionClaimResponse> {
    ClientSessionClaimRequestSchema.parse(request);
    const sessionId = crypto.randomUUID();
    const user = this.userFromRequest(request);
    if (user) {
      this.state.users[sessionId] = user;
      await this.persist();
    }
    return { protocol: CLIENT_WS_PROTOCOL, sessionId, user };
  }

  async isTabActive(sessionId: string, tabId: string) {
    return this.connections.has(tabKey(sessionId, tabId));
  }

  async attachPage(sessionId: string, tabId: string, canonicalUrl: string) {
    if (!(await this.isTabActive(sessionId, tabId))) return false;
    const key = tabKey(sessionId, tabId);
    const pages = this.tabPages.get(key) ?? new Set<string>();
    pages.add(canonicalUrl);
    this.tabPages.set(key, pages);
    return true;
  }

  async detachPage(sessionId: string, tabId: string, canonicalUrl: string) {
    const pages = this.tabPages.get(tabKey(sessionId, tabId));
    pages?.delete(canonicalUrl);
  }

  async updatePageAggregate(canonicalUrl: string, aggregate: PageAggregate | null) {
    if (pageAggregateEqual(this.state.pageAggregates[canonicalUrl], aggregate)) return;
    if (aggregate) this.state.pageAggregates[canonicalUrl] = aggregate;
    else delete this.state.pageAggregates[canonicalUrl];
    this.bump();
    await this.persist();
    this.broadcastSnapshot();
  }

  async updateOwnerFocus(focus: OwnerFocus | null) {
    if (ownerFocusEqual(this.state.ownerFocus, focus)) return;
    this.state.ownerFocus = focus;
    this.bump();
    await this.persist();
    this.broadcastSnapshot();
  }

  async broadcastClientFrame(frame: unknown) {
    for (const socket of this.connections.values()) safeSend(socket, frame);
  }

  async sendClientFrame(sessionId: string, tabId: string, frame: unknown) {
    safeSend(this.connections.get(tabKey(sessionId, tabId)), frame);
  }

  async sendAudioChunk(
    targets: ReadonlyArray<{ sessionId: string; tabId: string }>,
    frame: unknown,
    bytes: ArrayBuffer,
  ) {
    for (const target of targets) {
      const socket = this.connections.get(tabKey(target.sessionId, target.tabId));
      if (!socket) continue;
      if (!safeSend(socket, frame)) continue;
      try { socket.send(bytes); } catch {}
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    const { client, server } = createAcceptedPair();
    this.ctx.acceptWebSocket(server);
    return upgradeResponse(client);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = socketAttachment<ClientAttachment>(socket);
    const frame = parseFrame(ClientWsClientFrameSchema, message);
    if (!frame) return this.closeFatal(socket, "invalid_frame");
    if (frame.type === "hello") {
      if (attachment) return;
      if (!frame.supportedProtocols.includes(CLIENT_WS_PROTOCOL)) return this.closeFatal(socket, "unsupported_protocol");
      return this.acceptHello(socket, frame.sessionId, frame.tabId);
    }
    if (!attachment) return this.closeFatal(socket, "hello_required");
    if (frame.type === "stream.request") {
      await mediaStub(this.env).handleStreamRequest(attachment.sessionId, attachment.tabId, frame.requestId);
      return;
    }
    if (frame.type === "stream.stop") {
      await mediaStub(this.env).handleStreamStop(attachment.sessionId, attachment.tabId);
      return;
    }
    if (frame.type === "ack") {
      await mediaStub(this.env).handleClientAck(attachment.sessionId, attachment.tabId, frame.streamId, frame.generation, frame.seq);
    }
  }

  async webSocketClose(socket: WebSocket) { await this.removeSocket(socket); }
  async webSocketError(socket: WebSocket) { await this.removeSocket(socket); }

  private async acceptHello(socket: WebSocket, sessionId: string, tabId: string) {
    const key = tabKey(sessionId, tabId);
    const previous = this.connections.get(key);
    if (previous && previous !== socket) {
      safeSend(previous, fatalError("client", "connection_superseded"));
      closeWith(previous, 4000, "connection_superseded");
    }
    const now = nowIso();
    const connection: ClientAttachment = {
      protocol: CLIENT_WS_PROTOCOL, connectionId: crypto.randomUUID(),
      sessionId, tabId, connectedAt: now, lastSeenAt: now,
      user: this.state.users[sessionId],
    };
    socket.serializeAttachment(connection);
    this.connections.set(key, socket);
    this.bump();
    await this.persist();
    safeSend(socket, {
      protocol: CLIENT_WS_PROTOCOL, type: "hello_ack",
      selectedProtocol: CLIENT_WS_PROTOCOL, connectionId: connection.connectionId,
      session: { sessionId, tabId, user: connection.user },
    });
    this.broadcastSnapshot();
    await mediaStub(this.env).sendCurrentState(sessionId, tabId);
  }

  private async removeSocket(socket: WebSocket) {
    const attachment = socketAttachment<ClientAttachment>(socket);
    if (!attachment) return;
    const key = tabKey(attachment.sessionId, attachment.tabId);
    if (this.connections.get(key) !== socket) return;
    this.connections.delete(key);
    await this.revokeTab(attachment.sessionId, attachment.tabId);
    this.bump();
    await this.persist();
    this.broadcastSnapshot();
  }

  private async revokeTab(sessionId: string, tabId: string) {
    const key = tabKey(sessionId, tabId);
    const pages = this.tabPages.get(key) ?? new Set<string>();
    this.tabPages.delete(key);
    for (const canonicalUrl of pages) {
      await pageStub(this.env, canonicalUrl).revokeTab(sessionId, tabId);
    }
    await mediaStub(this.env).removeClientStream(sessionId, tabId);
  }

  private broadcastSnapshot() {
    const snapshot = buildGlobalSnapshot({ state: this.state, connections: this.connectionMetas() });
    const frame = { protocol: CLIENT_WS_PROTOCOL, type: "snapshot", snapshot };
    for (const socket of this.connections.values()) safeSend(socket, frame);
  }

  private connectionMetas(): CommonConnectionMeta[] {
    return Array.from(this.connections.values())
      .map((socket) => socketAttachment<ClientAttachment>(socket))
      .filter((item): item is ClientAttachment => Boolean(item));
  }

  private restoreSockets() {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socketAttachment<ClientAttachment>(socket);
      if (attachment?.protocol === CLIENT_WS_PROTOCOL) this.connections.set(tabKey(attachment.sessionId, attachment.tabId), socket);
    }
  }

  private closeFatal(socket: WebSocket, code: string) {
    safeSend(socket, fatalError("client", code));
    closeWith(socket, 4000, code);
  }

  private userFromRequest(_request: unknown): ClientUser | undefined {
    return undefined;
  }

  private bump() {
    this.state.revision += 1;
    this.state.updatedAt = nowIso();
  }

  private async persist() {
    await this.ctx.storage.put(STATE_KEY, this.state);
  }
}
