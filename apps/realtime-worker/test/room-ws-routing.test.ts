import { describe, expect, it } from "vitest";

import {
  roomBindingName,
  roomNamespace,
  realtimeRoomId,
  roomStub,
  type RoomNamespaceLike,
} from "../src/room-stub";

describe("room websocket routing", () => {
  it("routes workspace and room to the same durable object name", () => {
    const namespace = {
      idFromName(name: string) {
        return `id:${name}`;
      },
      get(id: string) {
        return { id };
      },
    } satisfies RoomNamespaceLike<string, { id: string }>;

    expect(realtimeRoomId(namespace, "pulse-demo", "global")).toBe(
      "id:pulse-demo:global",
    );
    expect(
      realtimeRoomId(namespace, "pulse-demo", "page:https://example.com/a"),
    ).toBe("id:pulse-demo:page:https://example.com/a");
  });

  it("resolves room stubs through workspace+room durable object ids", () => {
    const calls: string[] = [];
    const env = {
      GLOBAL_STATUS_ROOM: {
        idFromName(name: string) {
          calls.push(`global:${name}`);
          return `global:${name}`;
        },
        get(id: string) {
          return { id };
        },
      },
      PAGE_STATUS_ROOM: {
        idFromName(name: string) {
          calls.push(`page:${name}`);
          return `page:${name}`;
        },
        get(id: string) {
          return { id };
        },
      },
      CHAT_ROOM: {
        idFromName(name: string) {
          calls.push(`chat:${name}`);
          return `chat:${name}`;
        },
        get(id: string) {
          return { id };
        },
      },
    };

    expect(roomStub(env, "pulse-demo", "chat:general")).toEqual({
      id: "chat:pulse-demo:chat:general",
    });
    expect(roomBindingName("global")).toBe("GLOBAL_STATUS_ROOM");
    expect(roomBindingName("page:https://example.com/a")).toBe("PAGE_STATUS_ROOM");
    expect(roomNamespace(env, "chat:general")).toBe(env.CHAT_ROOM);
    expect(calls).toEqual(["chat:pulse-demo:chat:general"]);
  });
});
