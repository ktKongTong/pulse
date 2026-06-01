import { DurableObject } from "cloudflare:workers";
import { CLIENT_PAGE_WS_PROTOCOL, ClientPageClientFrameSchema, type ClientPageHelloFrame, type ClientPageUpdateFrame } from "@ktfun/pulse-protocol";
import type { Env } from "../env";
import { globalStub } from "../env";
import { aggregatePage, buildPageSnapshot, type TabPageState } from "../state/client";
import { isNewerTabUpdate } from "../state/client-ordering";
import { tabKey } from "../state/keys";
import { fatalError } from "../utils/error";
import { parseFrame } from "../utils/frame";
import { createAcceptedPair, upgradeResponse } from "../utils/pair";
import { nowIso } from "../utils/time";
import { closeWith, safeSend, socketAttachment } from "../utils/ws";

interface PageAttachment {
  protocol: typeof CLIENT_PAGE_WS_PROTOCOL;
  connectionId: string;
  sessionId: string;
  tabId: string;
  canonicalUrl: string;
  acceptedAt: string;
  lastSeenAt: string;
}

const TABS_KEY = "page-tabs";
const META_KEY = "page-meta";

export class PageDO extends DurableObject<Env> {
  private sockets = new Map<string, WebSocket>();
  private tabs = new Map<string, TabPageState>();
  private canonicalUrl = "";
  private revision = 0;
  private updatedAt = nowIso();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.restoreSockets();
    ctx.blockConcurrencyWhile(async () => {
      const tabs = (await ctx.storage.get<TabPageState[]>(TABS_KEY)) ?? [];
      this.tabs = new Map(tabs.map((tab) => [tabKey(tab.sessionId, tab.tabId), tab]));
      const meta = await ctx.storage.get<{ canonicalUrl: string; revision: number }>(META_KEY);
      this.canonicalUrl = meta?.canonicalUrl ?? "";
      this.revision = meta?.revision ?? 0;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const canonicalUrl = url.searchParams.get("canonicalUrl");
    if (!canonicalUrl) return new Response("canonicalUrl required", { status: 400 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    this.canonicalUrl = canonicalUrl;
    const { client, server } = createAcceptedPair();
    this.ctx.acceptWebSocket(server);
    return upgradeResponse(client);
  }

  async revokeTab(sessionId: string, tabId: string) {
    const key = tabKey(sessionId, tabId);
    const socket = this.sockets.get(key);
    if (socket) closeWith(socket, 401, "invalid_session");
    if (this.tabs.delete(key)) await this.afterPageChanged();
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = socketAttachment<PageAttachment>(socket);
    const frame = parseFrame(ClientPageClientFrameSchema, message);
    if (!frame) return this.closeFatal(socket, "invalid_frame");
    if (!attachment && frame.type !== "hello") return this.closeFatal(socket, "hello_required");
    if (frame.type === "hello") return this.acceptHello(socket, frame);
    if (frame.type === "page.update") return this.applyUpdate(attachment!, frame);
    if (frame.type === "leave") return this.leave(attachment!);
  }

  async webSocketClose(socket: WebSocket) { await this.cleanup(socket); }
  async webSocketError(socket: WebSocket) { await this.cleanup(socket); }

  private async acceptHello(socket: WebSocket, frame: ClientPageHelloFrame) {
    if (!frame.supportedProtocols.includes(CLIENT_PAGE_WS_PROTOCOL)) return this.closeFatal(socket, "unsupported_protocol");
    const attached = await globalStub(this.env).attachPage(frame.sessionId, frame.tabId, this.canonicalUrl);
    if (!attached) return this.closeFatal(socket, "invalid_session");
    const key = tabKey(frame.sessionId, frame.tabId);
    closeWith(this.sockets.get(key)!, 4000, "connection_superseded");
    const now = nowIso();
    const attachment: PageAttachment = {
      protocol: CLIENT_PAGE_WS_PROTOCOL, connectionId: crypto.randomUUID(),
      sessionId: frame.sessionId, tabId: frame.tabId,
      canonicalUrl: this.canonicalUrl, acceptedAt: now, lastSeenAt: now,
    };
    socket.serializeAttachment(attachment);
    this.sockets.set(key, socket);
    this.tabs.set(key, {
      sessionId: frame.sessionId, tabId: frame.tabId, canonicalUrl: this.canonicalUrl,
      title: frame.page?.title,
      url: frame.page?.url,
      observedAt: now,
      seq: 0,
      lastSeenAt: now,
    });
    safeSend(socket, {
      protocol: CLIENT_PAGE_WS_PROTOCOL, type: "hello_ack",
      selectedProtocol: CLIENT_PAGE_WS_PROTOCOL, connectionId: attachment.connectionId,
    });
    await this.afterPageChanged();
  }

  private async applyUpdate(attachment: PageAttachment, frame: ClientPageUpdateFrame) {
    const key = tabKey(attachment.sessionId, attachment.tabId);
    const previous = this.tabs.get(key);
    if (previous && !isNewerTabUpdate(frame, previous)) return;
    this.tabs.set(key, {
      sessionId: attachment.sessionId, tabId: attachment.tabId, canonicalUrl: attachment.canonicalUrl,
      title: frame.page?.title ?? previous?.title,
      url: frame.page?.url ?? previous?.url,
      progress: frame.reading ?? previous?.progress,
      observedAt: frame.observedAt,
      seq: frame.seq,
      lastSeenAt: nowIso(),
    });
    await this.afterPageChanged();
  }

  private async leave(attachment: PageAttachment) {
    const key = tabKey(attachment.sessionId, attachment.tabId);
    this.sockets.delete(key);
    this.tabs.delete(key);
    await globalStub(this.env).detachPage(attachment.sessionId, attachment.tabId, attachment.canonicalUrl);
    await this.afterPageChanged();
  }

  private async cleanup(socket: WebSocket) {
    const attachment = socketAttachment<PageAttachment>(socket);
    if (!attachment) return;
    await this.leave(attachment);
  }

  private async afterPageChanged() {
    this.revision += 1;
    this.updatedAt = nowIso();
    await this.persist();
    const snapshot = buildPageSnapshot(this.revision, this.updatedAt, this.canonicalUrl, Array.from(this.tabs.values()));
    this.broadcast(snapshot);
    await globalStub(this.env).updatePageAggregate(this.canonicalUrl, aggregatePage(this.canonicalUrl, Array.from(this.tabs.values())));
  }

  private broadcast(snapshot: unknown) {
    const frame = { protocol: CLIENT_PAGE_WS_PROTOCOL, type: "snapshot", snapshot };
    for (const socket of this.sockets.values()) safeSend(socket, frame);
  }

  private restoreSockets() {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socketAttachment<PageAttachment>(socket);
      if (attachment?.protocol === CLIENT_PAGE_WS_PROTOCOL) this.sockets.set(tabKey(attachment.sessionId, attachment.tabId), socket);
    }
  }

  private closeFatal(socket: WebSocket, code: string) {
    safeSend(socket, fatalError("page", code));
    closeWith(socket, 4000, code);
  }

  private async persist() {
    await this.ctx.storage.put(TABS_KEY, Array.from(this.tabs.values()));
    await this.ctx.storage.put(META_KEY, { canonicalUrl: this.canonicalUrl, revision: this.revision });
  }
}
