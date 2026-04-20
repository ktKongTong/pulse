import { describe, expect, it } from "vitest";

import {
  RealtimeClientMessageSchema,
  RealtimeServerMessageSchema,
} from "@pulse/realtime-protocol";

describe("realtime ws protocol", () => {
  it("parses presence context client messages", () => {
    const parsed = RealtimeClientMessageSchema.parse({
      protocol: "realtime.ws.v2",
      type: "presence_context",
      sessionId: "session-1",
      tabId: "tab-1",
      page: {
        title: "Article",
        url: "https://example.com/article",
      },
    });

    expect(parsed.type).toBe("presence_context");
    if (parsed.type === "presence_context") {
      expect(parsed.page.url).toBe("https://example.com/article");
    }
  });

  it("parses hello ack server envelopes without stats capabilities", () => {
    const parsed = RealtimeServerMessageSchema.parse({
      protocol: "realtime.ws.v2",
      type: "hello_ack",
      selectedProtocol: "realtime.ws.v2",
      capabilities: {
        presence: true,
        multiRoom: true,
        chat: true,
        richMedia: true,
        interaction: true,
      },
    });

    expect(parsed.type).toBe("hello_ack");
    if (parsed.type === "hello_ack") {
      expect(parsed.capabilities.presence).toBe(true);
      expect("statsPush" in parsed.capabilities).toBe(false);
    }
  });

  it("parses room-scoped snapshot envelopes without subscription ids", () => {
    const parsed = RealtimeServerMessageSchema.parse({
      protocol: "realtime.ws.v2",
      type: "snapshot",
      roomId: "global",
      payload: {
        roomKind: "global",
        workspaceId: "pulse-demo",
        roomId: "global",
        revision: 1,
        sessionCount: 2,
        sessions: [],
        activePageCount: 0,
        activePages: [],
        updatedAt: "2026-04-19T00:00:00.000Z",
      },
    });

    expect(parsed.type).toBe("snapshot");
    if (parsed.type === "snapshot") {
      expect(parsed.roomId).toBe("global");
      expect("subscriptionId" in parsed).toBe(false);
    }
  });
});
