import { dedupeReadersBySession, mapReaderToSessionPreview, mapReaderToPageSessionPreview, buildActivePages } from "@/api/runtime/room-view-helpers";
import { describe, expect, it } from "vitest";

describe("room view helpers", () => {
  const readers = [
    {
      readerId: "web:session-1:tab-1",
      sessionId: "session-1",
      tabId: "tab-1",
      workspaceId: "pulse-demo",
      roomId: "global",
      userId: null,
      source: "web",
      displayName: "Anonymous on-1",
      presenceState: "active",
      pageTitle: "Status",
      pageUrl: "https://example.com/status",
      pageCanonicalUrl: "https://example.com/status",
      readingProgressPercent: 25,
      readingScrollY: 100,
      updatedAt: "2026-04-17T00:00:00.000Z",
      expiresAtMs: Date.parse("2026-04-17T00:00:45.000Z"),
      lastCountedAtMs: Date.parse("2026-04-17T00:00:00.000Z"),
    },
    {
      readerId: "web:session-1:tab-2",
      sessionId: "session-1",
      tabId: "tab-2",
      workspaceId: "pulse-demo",
      roomId: "global",
      userId: null,
      source: "web",
      displayName: "Anonymous on-1",
      presenceState: "active",
      pageTitle: "Status",
      pageUrl: "https://example.com/status",
      pageCanonicalUrl: "https://example.com/status",
      readingProgressPercent: 75,
      readingScrollY: 1200,
      updatedAt: "2026-04-17T00:00:05.000Z",
      expiresAtMs: Date.parse("2026-04-17T00:00:50.000Z"),
      lastCountedAtMs: Date.parse("2026-04-17T00:00:05.000Z"),
    },
  ];

  it("dedupes multiple tabs down to the latest reader per session", () => {
    const deduped = dedupeReadersBySession(readers);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.readerId).toBe("web:session-1:tab-2");
  });

  it("maps readers into session and page session previews", () => {
    const preview = mapReaderToSessionPreview(readers[0]!);
    const pagePreview = mapReaderToPageSessionPreview(readers[1]!);

    expect(preview).toEqual({
      id: "session-1",
      userName: "Anonymous on-1",
    });
    expect(pagePreview.progress).toEqual({
      percent: 75,
      scrollY: 1200,
    });
  });

  it("builds active page rollups by canonical url", () => {
    const activePages = buildActivePages([
      ...readers,
      {
        ...readers[0]!,
        readerId: "web:session-2:tab-3",
        sessionId: "session-2",
        tabId: "tab-3",
        pageTitle: "Home",
        pageUrl: "https://example.com/",
        pageCanonicalUrl: "https://example.com/",
      },
    ]);

    expect(activePages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalUrl: "https://example.com/status",
          sessionCount: 1,
        }),
        expect.objectContaining({
          canonicalUrl: "https://example.com/",
          sessionCount: 1,
        }),
      ]),
    );
  });
});
