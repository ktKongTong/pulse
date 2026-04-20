import { describe, expect, it } from "vitest";
import type {
  ChatRoomSnapshot,
  ContentLifetime,
  GlobalRoomSnapshot,
  OwnerLifetime,
  PageRoomSnapshot,
  SiteLifetime,
} from "@pulse/realtime-protocol";

import {
  selectChatRoom,
  selectGlobalStatus,
  selectOwnerStats,
  selectPageStatus,
  selectSiteStats,
} from "../src/user-api";

function createGlobalSnapshot(): GlobalRoomSnapshot {
  return {
    workspaceId: "pulse-demo",
    roomId: "global",
    revision: 7,
    updatedAt: "2026-04-18T12:00:00.000Z",
    roomKind: "global",
    sessionCount: 1,
    sessions: [
      {
        id: "session-web",
        userId: "user-web",
        userName: "Article tab",
      },
    ],
    activePageCount: 2,
    activePages: [
      {
        id: "https://pulse.test/article",
        canonicalUrl: "https://pulse.test/article",
        title: "Article",
        sessionCount: 2,
      },
      {
        id: "https://pulse.test/dashboard",
        canonicalUrl: "https://pulse.test/dashboard",
        title: "Dashboard",
        sessionCount: 1,
      },
    ],
    ownerCurrent: {
      deviceId: "device-a",
      displayName: "Desk PulseBar",
      currentApp: {
        id: "music",
        name: "Music",
      },
      currentMedia: {
        providerId: "apple-music",
        title: "Signal",
        artist: "Echo",
        album: "Spectrum",
        progressSeconds: 90,
        durationSeconds: 240,
        playbackState: "playing",
      },
      lastActiveAt: "2026-04-18T11:59:30.000Z",
    },
  };
}

describe("selectGlobalStatus", () => {
  it("keeps public sessions lightweight and owner data separate", () => {
    const lifetime: SiteLifetime = {
      pv: 42,
      uv: 21,
      readTimeSeconds: 360,
    };

    const status = selectGlobalStatus(createGlobalSnapshot(), lifetime, {
      nowMs: Date.parse("2026-04-18T12:00:00.000Z"),
    });

    expect(status.sessions).toEqual([
      {
        id: "session-web",
        userId: "user-web",
        userName: "Article tab",
      },
    ]);
    expect(status.activePageCount).toBe(2);
    expect(status.activePages[0]).toMatchObject({
      canonicalUrl: "https://pulse.test/article",
      sessionCount: 2,
    });
    expect(status.ownerStatus?.focus?.name).toBe("Music");
    expect(status.ownerStatus?.media?.title).toBe("Signal");
    expect(status.stayTimeInSec).toBe(360);
  });

  it("treats sessions as a preview while keeping sessionCount as the full total", () => {
    const snapshot = createGlobalSnapshot();
    snapshot.sessions = [
      {
        id: "session-web-4",
        userName: "Reader 4",
      },
      {
        id: "session-web-3",
        userName: "Reader 3",
      },
      {
        id: "session-web-2",
        userName: "Reader 2",
      },
    ];
    snapshot.sessionCount = 4;

    const status = selectGlobalStatus(snapshot, null);

    expect(status.sessions).toHaveLength(3);
    expect(status.sessionCount).toBe(4);
    expect(status.sessions[0]?.id).toBe("session-web-4");
  });
});

describe("selectPageStatus", () => {
  it("maps page readers to lightweight sessions", () => {
    const snapshot: PageRoomSnapshot = {
      workspaceId: "pulse-demo",
      roomId: "page:https://pulse.test/article",
      revision: 3,
      updatedAt: "2026-04-18T12:00:00.000Z",
      roomKind: "page",
      sessionCount: 2,
      sessions: [
        {
          id: "session-1",
          userId: "user-1",
          userName: "Reader 1",
          progress: {
            percent: 15,
            scrollY: 120,
          },
        },
        {
          id: "session-2",
          userName: "Reader 2",
          progress: {
            percent: 80,
          },
        },
      ],
    };
    const lifetime: ContentLifetime = {
      canonicalUrl: "https://pulse.test/article",
      title: "Article",
      pv: 10,
      uv: 8,
      readTimeSeconds: 300,
    };

    const status = selectPageStatus("https://pulse.test/article", snapshot, lifetime);

    expect(status.sessionCount).toBe(2);
    expect(status.sessions[0]).toMatchObject({
      id: "session-1",
      userId: "user-1",
      userName: "Reader 1",
      progress: {
        percent: 15,
        scrollY: 120,
      },
    });
    expect(status.activePages[0]).toMatchObject({
      canonicalUrl: "https://pulse.test/article",
      sessionCount: 2,
    });
    expect(status.stayTimeInSec).toBe(300);
  });
});

describe("selectChatRoom", () => {
  it("maps chat room snapshots to user-facing chat state", () => {
    const snapshot: ChatRoomSnapshot = {
      workspaceId: "pulse-demo",
      roomId: "chat:status",
      revision: 5,
      updatedAt: "2026-04-18T12:00:00.000Z",
      roomKind: "chat",
      participantCount: 2,
      messageCount: 2,
      typingUsers: [],
      participants: [
        {
          readerId: "reader-a",
          displayName: "KT",
          presenceState: "active",
          updatedAt: "2026-04-18T11:59:00.000Z",
        },
        {
          readerId: "reader-b",
          displayName: "KT",
          presenceState: "idle",
          updatedAt: "2026-04-18T11:58:00.000Z",
        },
      ],
      messages: [
        {
          msgId: "msg-1",
          senderId: "reader-a",
          senderDisplayName: "KT",
          content: "hello",
          createdAt: "2026-04-18T11:59:00.000Z",
        },
        {
          msgId: "msg-2",
          senderId: "reader-b",
          senderDisplayName: "KT",
          content: "world",
          createdAt: "2026-04-18T11:59:30.000Z",
        },
      ],
    };

    const room = selectChatRoom(snapshot);

    expect(room).toMatchObject({
      id: "chat:status",
      type: "public",
      participantCount: 2,
      messageCount: 2,
    });
    expect(room?.participants[0].duplicateCount).toBe(2);
    expect(room?.latestMessages[1].content).toBe("world");
  });
});

describe("stats selectors", () => {
  it("format site and owner stats without facade-specific fields", () => {
    const site = selectSiteStats({
      pv: 12,
      uv: 9,
      readTimeSeconds: 330,
    });
    const owner = selectOwnerStats({
      appPresenceSecondsByApp: [
        { key: "warp", label: "Warp", totalSeconds: 90, count: 3 },
        { key: "music", label: "Music", totalSeconds: 30, count: 1 },
      ],
    } satisfies OwnerLifetime);

    expect(site).toMatchObject({
      pv: 12,
      uv: 9,
      readTimeLabel: "5m 30s",
    });
    expect(owner).toMatchObject({
      totalFocusSeconds: 120,
      activeAppCount: 2,
    });
    expect(owner?.apps[0]).toMatchObject({
      label: "Warp",
      totalFocusLabel: "1m 30s",
      shareLabel: "75%",
    });
  });
});
