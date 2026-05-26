import { CLIENT_MEDIA_WS_PROTOCOL, DEVICE_MEDIA_PROTOCOL } from "@ktfun/pulse-protocol";
import { mediaStateFrame } from "../state/media";
import { tabKey } from "../state/keys";
import { nowIso } from "../utils/time";
import { closeWith, safeSend, socketAttachment } from "../utils/ws";
import type { MediaAttachment } from "./media-base";

export function restoreMediaSockets(input: {
  sockets: WebSocket[];
  clients: Map<string, WebSocket>;
  setDeviceSocket: (socket: WebSocket) => void;
}) {
  let activeDevice: WebSocket | null = null;
  for (const socket of input.sockets) {
    const attachment = socketAttachment<MediaAttachment>(socket);
    if (attachment?.kind === "client") {
      input.clients.set(tabKey(attachment.sessionId, attachment.tabId), socket);
    } else if (attachment?.kind === "device") {
      if (activeDevice) closeWith(activeDevice, 4000, "connection_superseded");
      activeDevice = socket;
      input.setDeviceSocket(socket);
    }
  }
}

export function sendAudioChunk(input: {
  sockets: Iterable<WebSocket>;
  frame: unknown;
  bytes: ArrayBuffer;
}) {
  for (const socket of input.sockets) {
    safeSend(socket, input.frame);
    try { socket.send(input.bytes); } catch {}
  }
}

export function broadcastMediaState(input: {
  sockets: Iterable<WebSocket>;
  state: Parameters<typeof mediaStateFrame>[0];
}) {
  const frame = mediaStateFrame(input.state);
  for (const socket of input.sockets) safeSend(socket, frame);
}

export function streamEndedFrame(streamId: string, generation: number) {
  return {
    protocol: CLIENT_MEDIA_WS_PROTOCOL,
    type: "stream.ended",
    streamId,
    generation,
  };
}

export function sendStreamEnded(
  sockets: Iterable<WebSocket>,
  streamId: string,
  generation: number,
) {
  const frame = streamEndedFrame(streamId, generation);
  for (const socket of sockets) safeSend(socket, frame);
}

export function deviceCommandFrame(input: {
  commandId: string;
  type: "stream.requested" | "stream.stop";
  streamId: string;
  generation: number;
  expiresAt: string;
}) {
  const command = input.type === "stream.stop"
    ? { type: input.type, reason: "no_stream_clients" }
    : { type: input.type, streamId: input.streamId, generation: input.generation };
  return {
    protocol: DEVICE_MEDIA_PROTOCOL,
    type: "command",
    payload: {
      commandId: input.commandId,
      sentAt: nowIso(),
      expiresAt: input.expiresAt,
      command,
    },
  };
}
