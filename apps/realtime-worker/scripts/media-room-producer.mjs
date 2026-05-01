#!/usr/bin/env node
import { createReadStream, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_ROOM_ID = "room-test-1";
const DEFAULT_FILE = "test.mp3";
const DEFAULT_CHUNK_BYTES = 128 * 1024;
const DEFAULT_INTERVAL_MS = 1000;

function readArgs(argv) {
  const args = {
    url: process.env.MEDIA_ROOM_URL ?? "ws://localhost:8900/api/v1/media-room/room-test-1?role=producer",
    file: process.env.MEDIA_ROOM_FILE ?? DEFAULT_FILE,
    chunkBytes: Number(process.env.MEDIA_ROOM_CHUNK_BYTES ?? DEFAULT_CHUNK_BYTES),
    intervalMs: Number(process.env.MEDIA_ROOM_INTERVAL_MS ?? DEFAULT_INTERVAL_MS),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--url" && next) {
      args.url = next;
      index += 1;
    } else if (arg === "--file" && next) {
      args.file = next;
      index += 1;
    } else if (arg === "--chunk-bytes" && next) {
      args.chunkBytes = Number(next);
      index += 1;
    } else if (arg === "--interval-ms" && next) {
      args.intervalMs = Number(next);
      index += 1;
    } else if (arg === "--room" && next) {
      const url = new URL(args.url);
      url.pathname = url.pathname.replace(/\/[^/]+$/, `/${next || DEFAULT_ROOM_ID}`);
      args.url = url.toString();
      index += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.chunkBytes) || args.chunkBytes < 1024) {
    throw new Error("--chunk-bytes must be a number >= 1024");
  }
  if (!Number.isFinite(args.intervalMs) || args.intervalMs < 50) {
    throw new Error("--interval-ms must be a number >= 50");
  }
  return args;
}

function printHelp() {
  console.log(`Media Room Producer\n\nUsage:\n  node scripts/media-room-producer.mjs --file test.mp3 --url ws://localhost:8900/api/v1/media-room/room-test-1?role=producer\n\nOptions:\n  --url <url>             Producer WebSocket URL. Use wss://<worker>/api/v1/media-room/room-test-1?role=producer in production.\n  --room <room-id>        Replace room id in the URL path. Defaults to ${DEFAULT_ROOM_ID}.\n  --file <path>           Local MP3/AAC file. Defaults to ${DEFAULT_FILE}.\n  --chunk-bytes <bytes>   Bytes sent per tick. Defaults to ${DEFAULT_CHUNK_BYTES}.\n  --interval-ms <ms>      Send interval. Defaults to ${DEFAULT_INTERVAL_MS}.\n`);
}

function waitForOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", () => resolveOpen(), { once: true });
    ws.addEventListener("error", () => rejectOpen(new Error("WebSocket connection failed")), { once: true });
  });
}

async function* readChunks(path, chunkBytes) {
  const stream = createReadStream(path, { highWaterMark: chunkBytes });
  for await (const chunk of stream) {
    yield chunk;
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const filePath = resolve(args.file);
  const fileSize = statSync(filePath).size;
  const ws = new WebSocket(args.url);

  ws.binaryType = "arraybuffer";
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      console.log("[producer] control", event.data);
    }
  });

  console.log(`[producer] connecting ${args.url}`);
  await waitForOpen(ws);
  console.log(`[producer] streaming ${basename(filePath)} size=${fileSize} chunkBytes=${args.chunkBytes} intervalMs=${args.intervalMs}`);

  let sentBytes = 0;
  let chunkIndex = 0;
  for await (const chunk of readChunks(filePath, args.chunkBytes)) {
    if (ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket closed while streaming");
    }

    // 核心：按固定节奏发送二进制块，模拟 Mac App 端稳定推流。
    ws.send(chunk);
    sentBytes += chunk.byteLength;
    chunkIndex += 1;
    console.log(`[producer] chunk=${chunkIndex} bytes=${chunk.byteLength} sent=${sentBytes}/${fileSize}`);
    await delay(args.intervalMs);
  }

  console.log("[producer] file ended; closing websocket");
  ws.close(1000, "producer finished");
}

main().catch((error) => {
  console.error("[producer] failed", error);
  process.exit(1);
});
