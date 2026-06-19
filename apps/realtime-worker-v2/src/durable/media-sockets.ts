import { DEVICE_MEDIA_PROTOCOL } from "@ktfun/pulse-protocol";
import { nowIso } from "../utils/time";

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
