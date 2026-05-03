import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Env } from "@/api/config/env";

function mediaRoomStub(name = `room-test-1:${crypto.randomUUID()}`) {
  (env as Env).MEDIA_ROOM_ZERO_CONSUMER_GRACE_MS = "20";
  const mediaRoom = (env as Env).MEDIA_ROOM;
  const id = mediaRoom.idFromName(name);
  return mediaRoom.get(id);
}

function websocketRequest(url: string) {
  return new Request(url, { headers: { Upgrade: "websocket" } });
}

function nextMessage(socket: WebSocket): Promise<string | ArrayBuffer> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(event.data as string | ArrayBuffer), { once: true });
  });
}

async function waitForLatestSeq(socket: WebSocket, latestSeq: number) {
  for (let index = 0; index < 8; index += 1) {
    socket.send("stats");
    const message = JSON.parse(String(await nextMessage(socket)));
    if (message.type === "stats" && message.latestSeq >= latestSeq) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`latest seq did not reach ${latestSeq}`);
}

async function waitForEvent(socket: WebSocket, eventType: string) {
  for (let index = 0; index < 8; index += 1) {
    const next = JSON.parse(String(await nextMessage(socket)));
    if (next.event?.type === eventType) return next;
  }
  throw new Error(`event ${eventType} not received`);
}

describe("MediaRoomDO", () => {
  it("wraps producer binary chunks in sequenced envelopes", async () => {
    const stub = mediaRoomStub();
    const consumerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=consumer"));
    const producerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=producer"));
    const consumer = consumerResponse.webSocket as WebSocket;
    const producer = producerResponse.webSocket as WebSocket;

    consumer.accept();
    producer.accept();
    await nextMessage(consumer);
    await nextMessage(producer);

    const messagePromise = nextMessage(consumer);
    producer.send(new Uint8Array([1, 2, 3, 4]).buffer);
    const envelope = JSON.parse(String(await messagePromise));

    expect(envelope).toMatchObject({
      type: "audio-chunk",
      protocol: "pulse.media-room.v1",
      seq: 1,
      codec: "pcm16-wav",
      byteLength: 4,
    });
    expect(envelope.data).toBe("AQIDBA==");

    consumer.close();
    producer.close();
  });

  it("replays buffered chunks from requested sequence", async () => {
    const stub = mediaRoomStub();
    const producerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=producer"));
    const producer = producerResponse.webSocket as WebSocket;
    producer.accept();
    await nextMessage(producer);
    producer.send(new Uint8Array([1]).buffer);
    producer.send(new Uint8Array([2]).buffer);
    producer.send(new Uint8Array([3]).buffer);
    await waitForLatestSeq(producer, 3);

    const consumerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=consumer&fromSeq=2"));
    const consumer = consumerResponse.webSocket as WebSocket;
    consumer.accept();

    const connected = JSON.parse(String(await nextMessage(consumer)));
    const replayed2 = JSON.parse(String(await nextMessage(consumer)));
    const replayed3 = JSON.parse(String(await nextMessage(consumer)));

    expect(connected).toMatchObject({ type: "connected", latestSeq: 3, availableFromSeq: 1 });
    expect(replayed2).toMatchObject({ type: "audio-chunk", seq: 2, replayed: true });
    expect(replayed3).toMatchObject({ type: "audio-chunk", seq: 3, replayed: true });

    consumer.close();
    producer.close();
  });

  it("lets observers inspect telemetry without counting as consumers", async () => {
    const stub = mediaRoomStub();
    const observerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=observer"));
    const producerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=producer"));
    const observer = observerResponse.webSocket as WebSocket;
    const producer = producerResponse.webSocket as WebSocket;

    observer.accept();
    producer.accept();
    const connected = JSON.parse(String(await nextMessage(observer)));
    await nextMessage(producer);

    expect(connected).toMatchObject({
      type: "connected",
      role: "observer",
      snapshot: { consumers: 0, observers: 1 },
    });

    producer.send(new Uint8Array([9, 9]).buffer);
    let telemetry: any = null;
    for (let index = 0; index < 4; index += 1) {
      const next = JSON.parse(String(await nextMessage(observer)));
      if (next.event?.type === "chunk.in") {
        telemetry = next;
        break;
      }
    }

    expect(telemetry).toMatchObject({
      kind: "telemetry",
      event: { type: "chunk.in", seq: 1, consumers: 0 },
      snapshot: { consumers: 0, observers: 1, totalChunksIn: 1 },
    });

    observer.close();
    producer.close();
  });


  it("stops producers after the zero consumer grace window", async () => {
    const stub = mediaRoomStub();
    const observerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=observer"));
    const consumerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=consumer"));
    const producerResponse = await stub.fetch(websocketRequest("https://pulse.test/media-room/room-test-1?role=producer"));
    const observer = observerResponse.webSocket as WebSocket;
    const consumer = consumerResponse.webSocket as WebSocket;
    const producer = producerResponse.webSocket as WebSocket;

    observer.accept();
    consumer.accept();
    producer.accept();
    await nextMessage(observer);
    await nextMessage(consumer);
    await nextMessage(producer);

    consumer.close(1000, "test leave");
    const zeroStarted = await waitForEvent(observer, "zero_consumers.started");
    expect(zeroStarted).toMatchObject({ event: { type: "zero_consumers.started" } });

    const stopEventPromise = waitForEvent(observer, "producer.stop");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const stopEvent = await stopEventPromise;

    expect(stopEvent).toMatchObject({ event: { type: "producer.stop", reason: "zero_consumers" } });

    observer.close();
    producer.close();
  });

});
