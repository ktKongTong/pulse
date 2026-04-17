import { describe, expect, it } from "vitest";

import {
  RealtimeClientMessageSchema,
  RealtimeServerMessageSchema,
} from "@pulse/realtime-protocol";

describe("realtime ws protocol", () => {
  it("parses subscribe client messages", () => {
    const parsed = RealtimeClientMessageSchema.parse({
      protocol: "realtime.ws.v1",
      type: "subscribe",
      subscriptions: [
        {
          subscriptionId: "presence-1",
          roomId: "global",
        },
      ],
    });

    expect(parsed.type).toBe("subscribe");
    if (parsed.type === "subscribe") {
      expect(parsed.subscriptions[0]?.roomId).toBe("global");
    }
  });

  it("parses hello ack server envelopes without stats capabilities", () => {
    const parsed = RealtimeServerMessageSchema.parse({
      protocol: "realtime.ws.v1",
      type: "hello_ack",
      selectedProtocol: "realtime.ws.v1",
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
});
