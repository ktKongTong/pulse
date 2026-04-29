import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { Env } from "@/api/config/env";
import { LiveListenRoom } from "@/api/do/live-listen/room-do";

function liveListenStub(name = `pulse-demo:live-listen:owner:${crypto.randomUUID()}`) {
  const liveListenRoom = (env as Env).LIVE_LISTEN_ROOM;
  const id = liveListenRoom.idFromName(name);
  return liveListenRoom.get(id);
}

const hostStart = {
  workspaceId: "pulse-demo",
  roomId: "live-listen:owner",
  hostDeviceId: "macbook",
  requestedAt: "2026-04-29T00:00:00.000Z",
};

describe("LiveListenRoom", () => {
  it("starts host and exposes an audio session", async () => {
    const stub = liveListenStub();

    const response = await runInDurableObject(stub, async (room: LiveListenRoom) => {
      return room.startHost(hostStart);
    });

    expect(response.token.role).toBe("host");
    expect(response.snapshot.state).toBe("starting");
    expect(response.snapshot.audio?.sessionId).toBe("pulse:pulse-demo:live-listen:owner");
    expect(response.snapshot.startedAt).toBe(hostStart.requestedAt);
  });

  it("opens a hibernatable websocket and sends the current snapshot", async () => {
    const stub = liveListenStub();

    const response = await stub.fetch(
      new Request("https://pulse.test/internal/live-listen/events?workspaceId=pulse-demo&roomId=live-listen:owner", {
        headers: { Upgrade: "websocket" },
      }),
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    const socket = response.webSocket as WebSocket;
    const firstMessage = await new Promise<string>((resolve) => {
      socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
      socket.accept();
    });

    expect(JSON.parse(firstMessage)).toMatchObject({
      protocol: "live-listen.stream.v1",
      kind: "snapshot.updated",
      snapshot: {
        state: "offline",
        listenerCount: 0,
      },
    });
    socket.close();
  });

  it("accepts heartbeats and updates media clock", async () => {
    const stub = liveListenStub();

    const snapshot = await runInDurableObject(stub, async (room: LiveListenRoom) => {
      await room.startHost(hostStart);
      return room.heartbeatHost({
        workspaceId: "pulse-demo",
        roomId: "live-listen:owner",
        hostDeviceId: "macbook",
        sentAt: "2026-04-29T00:00:01.000Z",
        media: { title: "Track", playbackState: "playing" },
        clock: {
          mediaProgressSeconds: 1,
          observedAt: "2026-04-29T00:00:01.000Z",
          sequence: 1,
        },
      });
    });

    expect(snapshot.state).toBe("live");
    expect(snapshot.media?.title).toBe("Track");
    expect(snapshot.clock?.sequence).toBe(1);
  });

  it("rejects listeners while inactive", async () => {
    const stub = liveListenStub();

    await expect(runInDurableObject(stub, async (room: LiveListenRoom) => {
      return room.joinListener({
        workspaceId: "pulse-demo",
        roomId: "live-listen:owner",
        participantId: "visitor-1",
        joinedAt: "2026-04-29T00:00:02.000Z",
      });
    })).rejects.toThrow("live_listen_not_active");
  });

  it("broadcasts snapshot updates over websocket", async () => {
    const stub = liveListenStub();
    const response = await stub.fetch(
      new Request("https://pulse.test/internal/live-listen/events?workspaceId=pulse-demo&roomId=live-listen:owner", {
        headers: { Upgrade: "websocket" },
      }),
    );
    const socket = response.webSocket as WebSocket;
    const messages: string[] = [];
    socket.addEventListener("message", (event) => messages.push(String(event.data)));
    socket.accept();

    await runInDurableObject(stub, async (room: LiveListenRoom) => {
      await room.startHost(hostStart);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages.map((message) => JSON.parse(message).snapshot.state)).toContain("starting");
    socket.close();
  });

  it("refreshes existing listeners without increasing count", async () => {
    const stub = liveListenStub();

    const response = await runInDurableObject(stub, async (room: LiveListenRoom) => {
      await room.startHost(hostStart);
      await room.joinListener({
        workspaceId: "pulse-demo",
        roomId: "live-listen:owner",
        participantId: "visitor-1",
        joinedAt: "2026-04-29T00:00:02.000Z",
      });
      return room.joinListener({
        workspaceId: "pulse-demo",
        roomId: "live-listen:owner",
        participantId: "visitor-1",
        joinedAt: "2026-04-29T00:00:03.000Z",
      });
    });

    expect(response.snapshot.listenerCount).toBe(1);
  });

  it("ignores leave for unknown listeners", async () => {
    const stub = liveListenStub();

    const snapshot = await runInDurableObject(stub, async (room: LiveListenRoom) => {
      await room.startHost(hostStart);
      return room.leaveListener({
        workspaceId: "pulse-demo",
        roomId: "live-listen:owner",
        participantId: "missing",
        leftAt: "2026-04-29T00:00:03.000Z",
      });
    });

    expect(snapshot.listenerCount).toBe(0);
  });
});
