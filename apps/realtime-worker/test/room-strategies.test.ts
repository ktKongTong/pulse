import { describe, expect, it } from "vitest";

import {
  ChatRoomStrategy,
  GlobalRoomStrategy,
  PageRoomStrategy,
  createStrategy,
  type RoomContext,
  type WebIngestEvent,
} from "../src/room-strategies";

function createContext(overrides: Partial<RoomContext> = {}): RoomContext {
  return {
    workspaceId: "pulse-demo",
    roomId: "global",
    nowMs: Date.parse("2026-04-17T00:00:00.000Z"),
    readers: new Map(),
    deviceStates: new Map(),
    chatParticipants: new Map(),
    chatMessages: [],
    typingUsers: new Set(),
    ...overrides,
  };
}

function createWebEvent(overrides: Partial<WebIngestEvent> = {}): WebIngestEvent {
  return {
    kind: "page_view",
    observedAt: "2026-04-17T00:00:00.000Z",
    sessionId: "session-1",
    tabId: "tab-1",
    presence: { state: "active" },
    page: {
      title: "Pulse Status",
      url: "https://example.com/status",
      canonicalUrl: "https://example.com/status",
    },
    reading: {
      progressPercent: 35,
      scrollY: 480,
    },
    ...overrides,
  };
}

describe("room strategies", () => {
  it("creates strategies by room kind", () => {
    expect(createStrategy("global")).toBeInstanceOf(GlobalRoomStrategy);
    expect(createStrategy("page:https://example.com/status")).toBeInstanceOf(PageRoomStrategy);
    expect(createStrategy("chat:general")).toBeInstanceOf(ChatRoomStrategy);
    expect(createStrategy("unknown")).toBeInstanceOf(GlobalRoomStrategy);
  });

  it("builds a global snapshot with web and device readers and ignores stale device updates", () => {
    const strategy = new GlobalRoomStrategy();
    const ctx = createContext();

    const changed = strategy.handleWebEvent(ctx, createWebEvent(), "web:reader-1", 45_000);
    expect(changed).toBe(true);

    const firstDeviceState = {
      updatedAt: "2026-04-17T00:00:10.000Z",
      availability: { state: "active" as const },
      focus: { state: "foreground" as const, app: { name: "Codex" } },
      presenceKind: "interactive" as const,
      device: { name: "KT Mac", platform: "macos" as const },
      mediaSessions: [],
      expiresAtMs: Date.parse("2026-04-17T00:00:55.000Z"),
      lastCountedAtMs: Date.parse("2026-04-17T00:00:10.000Z"),
      capabilities: {
        pageTitle: false,
        pageUrl: false,
        media: false,
        localPlayback: false,
        remotePlayback: false,
      },
      sessionId: "device-session",
    };
    expect(strategy.handleDeviceUpdate(ctx, "macbook", firstDeviceState)).toBe(true);

    const staleDeviceState = {
      ...firstDeviceState,
      updatedAt: "2026-04-17T00:00:05.000Z",
      focus: { state: "foreground" as const, app: { name: "Stale App" } },
    };
    expect(strategy.handleDeviceUpdate(ctx, "macbook", staleDeviceState)).toBe(false);

    const snapshot = strategy.buildSnapshot(ctx) as {
      roomKind: string;
      onlineCount: number;
      activeReaders: Array<{ source: string; displayName: string }>;
    };

    expect(snapshot.roomKind).toBe("global");
    expect(snapshot.onlineCount).toBe(2);
    expect(snapshot.activeReaders.map((reader) => reader.source)).toEqual(["web", "device"]);
    expect(snapshot.activeReaders[1]?.displayName).toBe("KT Mac");
  });

  it("builds page reading aggregates from active readers", () => {
    const strategy = new PageRoomStrategy();
    const ctx = createContext({ roomId: "page:https://example.com/status" });

    strategy.handleWebEvent(
      ctx,
      createWebEvent({
        sessionId: "session-1",
        tabId: "tab-1",
        reading: { progressPercent: 25, scrollY: 100 },
      }),
      "web:session-1:tab-1",
      45_000,
    );
    strategy.handleWebEvent(
      ctx,
      createWebEvent({
        observedAt: "2026-04-17T00:00:02.000Z",
        sessionId: "session-2",
        tabId: "tab-2",
        reading: { progressPercent: 75, scrollY: 1200 },
      }),
      "web:session-2:tab-2",
      45_000,
    );

    const snapshot = strategy.buildSnapshot(ctx) as {
      roomKind: string;
      onlineCount: number;
      readingStats: { avgProgress: number; maxProgress: number; sampleCount: number };
    };

    expect(strategy.handleDeviceUpdate(ctx, "macbook", null)).toBe(false);
    expect(snapshot.roomKind).toBe("page");
    expect(snapshot.onlineCount).toBe(2);
    expect(snapshot.readingStats).toEqual({
      avgProgress: 50,
      maxProgress: 75,
      sampleCount: 2,
    });
  });

  it("dedupes multiple tabs from the same session in current snapshots", () => {
    const global = new GlobalRoomStrategy();
    const page = new PageRoomStrategy();
    const globalCtx = createContext();
    const pageCtx = createContext({ roomId: "page:https://example.com/status" });

    global.handleWebEvent(
      globalCtx,
      createWebEvent({ sessionId: "session-1", tabId: "tab-1" }),
      "web:session-1:tab-1",
      45_000,
    );
    global.handleWebEvent(
      globalCtx,
      createWebEvent({
        observedAt: "2026-04-17T00:00:05.000Z",
        sessionId: "session-1",
        tabId: "tab-2",
      }),
      "web:session-1:tab-2",
      45_000,
    );

    page.handleWebEvent(
      pageCtx,
      createWebEvent({ sessionId: "session-1", tabId: "tab-1" }),
      "web:session-1:tab-1",
      45_000,
    );
    page.handleWebEvent(
      pageCtx,
      createWebEvent({
        observedAt: "2026-04-17T00:00:05.000Z",
        sessionId: "session-1",
        tabId: "tab-2",
      }),
      "web:session-1:tab-2",
      45_000,
    );

    const globalSnapshot = global.buildSnapshot(globalCtx) as {
      onlineCount: number;
      pageConcurrencyMap: Record<string, number>;
      activeReaders: Array<{ sessionId: string }>;
    };
    const pageSnapshot = page.buildSnapshot(pageCtx) as {
      onlineCount: number;
      activeReaders: Array<{ sessionId: string }>;
    };

    expect(globalSnapshot.onlineCount).toBe(1);
    expect(globalSnapshot.pageConcurrencyMap["https://example.com/status"]).toBe(1);
    expect(globalSnapshot.activeReaders).toHaveLength(1);
    expect(globalSnapshot.activeReaders[0]?.sessionId).toBe("session-1");

    expect(pageSnapshot.onlineCount).toBe(1);
    expect(pageSnapshot.activeReaders).toHaveLength(1);
    expect(pageSnapshot.activeReaders[0]?.sessionId).toBe("session-1");
  });

  it("counts one session across multiple pages as one reader but two active pages", () => {
    const strategy = new GlobalRoomStrategy();
    const ctx = createContext();

    strategy.handleWebEvent(
      ctx,
      createWebEvent({
        sessionId: "session-1",
        tabId: "tab-status",
        page: {
          title: "Status",
          url: "https://example.com/status",
          canonicalUrl: "https://example.com/status",
        },
      }),
      "web:session-1:tab-status",
      45_000,
    );
    strategy.handleWebEvent(
      ctx,
      createWebEvent({
        observedAt: "2026-04-17T00:00:05.000Z",
        sessionId: "session-1",
        tabId: "tab-home",
        page: {
          title: "Home",
          url: "https://example.com/",
          canonicalUrl: "https://example.com/",
        },
      }),
      "web:session-1:tab-home",
      45_000,
    );

    const snapshot = strategy.buildSnapshot(ctx) as {
      onlineCount: number;
      pageConcurrencyMap: Record<string, number>;
    };

    expect(snapshot.onlineCount).toBe(1);
    expect(snapshot.pageConcurrencyMap["https://example.com/status"]).toBe(1);
    expect(snapshot.pageConcurrencyMap["https://example.com/"]).toBe(1);
  });

  it("builds chat snapshots from chat-specific state only", () => {
    const strategy = new ChatRoomStrategy();
    const ctx = createContext({
      roomId: "chat:general",
      chatParticipants: new Map([
        [
          "session-1",
          {
            readerId: "session-1",
            displayName: "KT",
            presenceState: "active",
            updatedAt: "2026-04-17T00:00:00.000Z",
            userId: "user-1",
          },
        ],
      ]),
      chatMessages: [
        {
          msgId: "msg-1",
          senderId: "user-1",
          senderDisplayName: "KT",
          content: "hello",
          createdAt: "2026-04-17T00:00:01.000Z",
        },
      ],
      typingUsers: new Set(["session-1"]),
    });

    expect(strategy.handleDeviceUpdate(ctx, "macbook", null)).toBe(false);
    strategy.handleWebEvent(ctx, createWebEvent({ page: { title: "ignored", url: "https://example.com", canonicalUrl: "https://example.com" } }), "web:reader-1", 45_000);
    expect(strategy.handleSessionEnd(ctx, "web:reader-1")).toBe(true);

    const snapshot = strategy.buildSnapshot(ctx) as {
      roomKind: string;
      participantCount: number;
      messageCount: number;
      typingUsers: string[];
    };

    expect(snapshot.roomKind).toBe("chat");
    expect(snapshot.participantCount).toBe(1);
    expect(snapshot.messageCount).toBe(1);
    expect(snapshot.typingUsers).toEqual(["session-1"]);
  });
});
