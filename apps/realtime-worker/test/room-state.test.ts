import { describe, expect, it } from "vitest";

import type { PresenceIngestRequest, WebIngestRequest } from "@pulse/realtime-protocol";

import {
  applyPresenceIngest,
  applyWebEventToPageRoom,
  applyWebIngestToGlobal,
  applyWebLeaveToPageRoom,
  createRoomState,
  deviceStatsHistory,
  globalStatsHistory,
  pageStatsHistory,
  pruneState,
  roomStatsHistory,
  snapshotFromState
} from "../src/lib/room-state";

describe("room-state", () => {
  it("dedupes presence events", () => {
    const state = createRoomState("pulse-demo", "global");
    const now = Date.parse("2026-04-09T00:00:00.000Z");
    const request: PresenceIngestRequest = {
      protocol: "presence.v2",
      workspaceId: "pulse-demo",
      deviceId: "macbook",
      sessionId: "device-session",
      events: [
        {
          eventId: "evt-1",
          seq: 1,
          kind: "snapshot",
          observedAt: "2026-04-09T00:00:00.000Z",
          sentAt: "2026-04-09T00:00:00.000Z",
          state: {
            availability: { state: "active" },
            focus: {
              state: "foreground",
              app: { name: "Codex", id: "com.openai.codex" },
              page: { title: "Thread", url: "https://example.com/thread" }
            },
            presenceKind: "interactive",
            mediaSessions: [],
            device: { name: "KT MacBook", platform: "macos" },
            capabilities: {
              pageTitle: true,
              pageUrl: true,
              media: false,
              localPlayback: false,
              remotePlayback: false
            }
          }
        }
      ]
    };

    const first = applyPresenceIngest(state, request, 120_000, now);
    const second = applyPresenceIngest(state, request, 120_000, now + 1000);

    expect(first.changed).toBe(true);
    expect(second.dedupedEventIds).toEqual(["evt-1"]);
    expect(snapshotFromState(state).onlineCount).toBe(1);
    expect(state.stats?.rawJournal.map((entry) => entry.ingestResult)).toEqual(["accepted", "deduped"]);
  });

  it("moves a web session between page rooms", () => {
    const globalState = createRoomState("pulse-demo", "global");
    const request: WebIngestRequest = {
      protocol: "web.v1",
      workspaceId: "pulse-demo",
      siteId: "blog-demo",
      sessionId: "web-session",
      events: [
        {
          eventId: "web-1",
          seq: 1,
          kind: "page_view",
          observedAt: "2026-04-09T00:00:00.000Z",
          sentAt: "2026-04-09T00:00:00.000Z",
          page: {
            url: "https://example.com/article-a?utm_source=x",
            title: "Article A"
          },
          presence: {
            state: "active",
            visibility: "visible"
          }
        }
      ]
    };

    const first = applyWebIngestToGlobal(globalState, request, 45_000, Date.now());
    expect(first.pageTransitions[0]?.currentRoomId).toBe("page:https://example.com/article-a");

    const second = applyWebIngestToGlobal(
      globalState,
      {
        ...request,
        events: [
          {
            ...request.events[0],
            eventId: "web-2",
            seq: 2,
            page: {
              url: "https://example.com/article-b",
              title: "Article B"
            }
          }
        ]
      },
      45_000,
      Date.now()
    );

    expect(second.pageTransitions[0]?.previousRoomId).toBe("page:https://example.com/article-a");
    expect(second.pageTransitions[0]?.currentRoomId).toBe("page:https://example.com/article-b");
  });

  it("updates and removes page-room readers", () => {
    const pageState = createRoomState("pulse-demo", "page:https://example.com/article-a");
    const now = Date.now();

    const changed = applyWebEventToPageRoom(
      pageState,
      {
        workspaceId: "pulse-demo",
        siteId: "blog-demo",
        sessionId: "web-session",
        event: {
          eventId: "web-1",
          seq: 1,
          kind: "reading_progress",
          observedAt: "2026-04-09T00:00:00.000Z",
          sentAt: "2026-04-09T00:00:00.000Z",
          page: {
            url: "https://example.com/article-a",
            title: "Article A"
          },
          reading: {
            progressPercent: 42,
            scrollY: 1200
          },
          presence: {
            state: "active",
            visibility: "visible"
          }
        }
      },
      45_000,
      now
    );
    expect(changed).toBe(true);
    expect(snapshotFromState(pageState).activeReaders[0]?.reading?.progressPercent).toBe(42);

    const removed = applyWebLeaveToPageRoom(
      pageState,
      { sessionId: "web-session" },
      "2026-04-09T00:00:02.000Z",
      now + 1000
    );
    expect(removed).toBe(true);
    expect(snapshotFromState(pageState).onlineCount).toBe(0);
  });

  it("prunes server raw journal after retention", () => {
    const state = createRoomState("pulse-demo", "global");
    const request: PresenceIngestRequest = {
      protocol: "presence.v2",
      workspaceId: "pulse-demo",
      deviceId: "macbook",
      sessionId: "device-session",
      events: [
        {
          eventId: "evt-old",
          seq: 1,
          kind: "snapshot",
          observedAt: "2026-04-09T00:00:00.000Z",
          sentAt: "2026-04-09T00:00:00.000Z",
          state: {
            availability: { state: "active" },
            focus: {
              state: "foreground",
              app: { name: "Codex", id: "com.openai.codex" },
            },
            presenceKind: "interactive",
            mediaSessions: [],
            device: { name: "KT MacBook", platform: "macos" },
            capabilities: {
              pageTitle: false,
              pageUrl: false,
              media: false,
              localPlayback: false,
              remotePlayback: false,
            },
          },
        },
      ],
    };

    applyPresenceIngest(state, request, 120_000, Date.parse("2026-04-09T00:00:00.000Z"));
    expect(state.stats?.rawJournal).toHaveLength(1);

    pruneState(state, Date.parse("2026-04-12T00:00:01.000Z"));
    expect(state.stats?.rawJournal).toHaveLength(0);
  });

  it("builds day/week/month/year aggregate history", () => {
    const state = createRoomState("pulse-demo", "global");
    const makePresence = (eventId: string, seq: number, observedAt: string, appName: string): PresenceIngestRequest => ({
      protocol: "presence.v2",
      workspaceId: "pulse-demo",
      deviceId: "macbook",
      sessionId: "device-session",
      events: [
        {
          eventId,
          seq,
          kind: "snapshot",
          observedAt,
          sentAt: observedAt,
          state: {
            availability: { state: "active" },
            focus: {
              state: "foreground",
              app: { name: appName, id: `app.${appName}` },
            },
            presenceKind: "interactive",
            mediaSessions: [],
            device: { name: "KT MacBook", platform: "macos" },
            capabilities: {
              pageTitle: false,
              pageUrl: false,
              media: false,
              localPlayback: false,
              remotePlayback: false,
            },
          },
        },
      ],
    });

    applyPresenceIngest(state, makePresence("evt-1", 1, "2026-01-10T00:00:00.000Z", "Codex"), 120_000, Date.parse("2026-01-10T00:00:00.000Z"));
    applyPresenceIngest(state, makePresence("evt-2", 2, "2026-02-10T00:00:00.000Z", "Edge"), 120_000, Date.parse("2026-02-10T00:00:00.000Z"));
    applyPresenceIngest(state, makePresence("evt-3", 3, "2026-03-10T00:00:00.000Z", "WebStorm"), 120_000, Date.parse("2026-03-10T00:00:00.000Z"));

    expect(globalStatsHistory(state, "day", 90, "2026-03-31").length).toBeGreaterThan(0);
    expect(globalStatsHistory(state, "month", 12, "2026-03-31").map((item) => item.bucket.key)).toContain("2026-03");
    expect(globalStatsHistory(state, "year", 5, "2026-03-31").map((item) => item.bucket.key)).toContain("2026");
    expect(globalStatsHistory(state, "week", 12, "2026-03-31").length).toBeGreaterThan(0);

    expect(deviceStatsHistory(state, "month", 12, "2026-03-31", "macbook").length).toBeGreaterThan(0);
    expect(pageStatsHistory(state, "month", 12, "2026-03-31", 5)).toBeDefined();
    expect(roomStatsHistory(state, "month", 12, "2026-03-31", 5)).toBeDefined();
  });
});
