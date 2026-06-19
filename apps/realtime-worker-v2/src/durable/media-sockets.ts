import { DEVICE_MEDIA_PROTOCOL } from "@ktfun/pulse-protocol";
import type { MediaAttachment } from "./media-base";
import { nowIso } from "../utils/time";
import { closeWith, socketAttachment } from "../utils/ws";

export function restoreMediaSockets(input: {
  sockets: WebSocket[];
  setDeviceSocket: (socket: WebSocket) => void;
}) {
  let activeDevice: WebSocket | null = null;
  for (const socket of input.sockets) {
    const attachment = socketAttachment<MediaAttachment>(socket);
    if (attachment?.kind === "device") {
      if (activeDevice) closeWith(activeDevice, 4000, "connection_superseded");
      activeDevice = socket;
      input.setDeviceSocket(socket);
    }
  }
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
