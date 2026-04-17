import { describe, expect, it } from "vitest";

import {
  RealtimeServerMessageSchema,
  RoomSnapshotSchema,
  isChatRoomSnapshot,
  isGlobalRoomSnapshot,
  isPageRoomSnapshot,
} from "../src/realtime-v1";

describe("room snapshot union", () => {
  it("parses global room snapshots", () => {
    const snapshot = RoomSnapshotSchema.parse({
      roomKind: "global",
      workspaceId: "pulse-demo",
      roomId: "global",
      revision: 1,
      onlineCount: 2,
      activeReaders: [],
      updatedAt: "2026-04-16T00:00:00.000Z",
    });

    expect(isGlobalRoomSnapshot(snapshot)).toBe(true);
    expect(snapshot.roomKind).toBe("global");
  });

  it("parses page room snapshots", () => {
    const snapshot = RoomSnapshotSchema.parse({
      roomKind: "page",
      workspaceId: "pulse-demo",
      roomId: "page:https://example.com/article",
      revision: 2,
      onlineCount: 3,
      activeReaders: [],
      readingStats: {
        avgProgress: 42,
        maxProgress: 78,
        sampleCount: 3,
      },
      updatedAt: "2026-04-16T00:00:00.000Z",
    });

    expect(isPageRoomSnapshot(snapshot)).toBe(true);
    expect(snapshot.roomKind).toBe("page");
    if (snapshot.roomKind === "page") {
      expect(snapshot.readingStats.sampleCount).toBe(3);
    }
  });

  it("parses chat room snapshots", () => {
    const snapshot = RoomSnapshotSchema.parse({
      roomKind: "chat",
      workspaceId: "pulse-demo",
      roomId: "chat:lobby",
      revision: 3,
      participantCount: 2,
      participants: [
        {
          readerId: "web:abc",
          displayName: "Anonymous 1234",
          presenceState: "active",
          updatedAt: "2026-04-16T00:00:00.000Z",
        },
      ],
      messages: [
        {
          msgId: "msg-1",
          senderId: "web:abc",
          senderDisplayName: "Anonymous 1234",
          content: "hello",
          createdAt: "2026-04-16T00:00:00.000Z",
        },
      ],
      messageCount: 1,
      typingUsers: ["web:abc"],
      updatedAt: "2026-04-16T00:00:00.000Z",
    });

    expect(isChatRoomSnapshot(snapshot)).toBe(true);
    expect(snapshot.roomKind).toBe("chat");
    if (snapshot.roomKind === "chat") {
      expect(snapshot.messages[0]?.content).toBe("hello");
    }
  });

  it("parses chat event envelopes", () => {
    const parsed = RealtimeServerMessageSchema.parse({
      protocol: "realtime.ws.v1",
      type: "chat_event",
      roomId: "chat:lobby",
      roomKind: "chat",
      revision: 4,
      event: {
        kind: "message_posted",
        message: {
          msgId: "msg-2",
          senderId: "web:def",
          senderDisplayName: "Anonymous 5678",
          content: "world",
          createdAt: "2026-04-16T00:00:00.000Z",
        },
      },
    });

    expect(parsed.type).toBe("chat_event");
    if (parsed.type === "chat_event") {
      expect(parsed.event.kind).toBe("message_posted");
    }
  });
});
