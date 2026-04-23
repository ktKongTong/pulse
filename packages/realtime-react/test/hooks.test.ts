import { describe, expect, it } from "vitest";

import { selectRealtimeConnectionStatus } from "../src/hooks";
import type { RoomSubscriptionDebugState } from "../src/room-subscription-manager";

const baseState: RoomSubscriptionDebugState = {
  transport: {
    status: "idle",
    selectedProtocol: null,
    capabilities: null,
    lastError: null,
    lastMessageType: null,
  },
  activeMode: "unknown",
  subscriptions: [],
  lastSnapshotMeta: null,
  meta: null,
  transports: [],
};

describe("selectRealtimeConnectionStatus", () => {
  it("returns a lightweight aggregate connection state for active ws rooms", () => {
    expect(
      selectRealtimeConnectionStatus({
        ...baseState,
        transport: {
          status: "reconnecting",
          selectedProtocol: "realtime.ws.v2",
          capabilities: {
            presence: true,
            multiRoom: true,
            chat: true,
            richMedia: true,
            interaction: true,
          },
          lastError: "socket_error",
          lastMessageType: "snapshot",
        },
        activeMode: "ws",
        transports: [
          {
            roomId: "global",
            refCount: 1,
            status: "ready",
            selectedProtocol: "realtime.ws.v2",
            capabilities: {
              presence: true,
              multiRoom: true,
              chat: true,
              richMedia: true,
              interaction: true,
            },
            lastError: null,
            lastMessageType: "snapshot",
          },
          {
            roomId: "page:https://example.com/article",
            refCount: 1,
            status: "reconnecting",
            selectedProtocol: "realtime.ws.v2",
            capabilities: {
              presence: true,
              multiRoom: true,
              chat: true,
              richMedia: true,
              interaction: true,
            },
            lastError: "socket_error",
            lastMessageType: "snapshot",
          },
        ],
      }),
    ).toEqual({
      status: "reconnecting",
      selectedProtocol: "realtime.ws.v2",
      capabilities: {
        presence: true,
        multiRoom: true,
        chat: true,
        richMedia: true,
        interaction: true,
      },
      lastError: "socket_error",
      lastMessageType: "snapshot",
      activeMode: "ws",
      transportCount: 2,
    });
  });

  it("stays idle when there is no active room transport", () => {
    expect(selectRealtimeConnectionStatus(baseState)).toEqual({
      status: "idle",
      selectedProtocol: null,
      capabilities: null,
      lastError: null,
      lastMessageType: null,
      activeMode: "unknown",
      transportCount: 0,
    });
  });
});
