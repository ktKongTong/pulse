import {
  CLIENT_WS_PROTOCOL,
  DeviceMediaFrameSchema,
} from "@ktfun/pulse-protocol";
import { globalStub } from "../env";
import { MediaBase } from "./media-base";
import { sourceFromState, type StreamClientMeta } from "../state/media";
import { tabKey } from "../state/keys";
import { parseFrame, parseJson } from "../utils/frame";
import { nowIso } from "../utils/time";

export class MediaDO extends MediaBase {
  async acceptDeviceSession(deviceId: string, deviceSessionId: string, streaming: boolean) {
    this.state.device = {
      connectionId: crypto.randomUUID(),
      deviceId,
      deviceSessionId,
      connectedAt: nowIso(),
      capabilities: { streaming },
    };
    this.state.streamRequestRejectedAt = undefined;
    await this.stateChanged();
  }

  async endDeviceSession(deviceSessionId: string) {
    await super.endDeviceSession(deviceSessionId);
  }

  async handleDeviceFrame(deviceSessionId: string, message: string | ArrayBuffer) {
    if (this.state.device?.deviceSessionId !== deviceSessionId) {
      console.log("[media-do] stale_device_frame", { deviceSessionId, currentDevice: this.state.device?.deviceSessionId });
      return;
    }
    if (message instanceof ArrayBuffer) return this.acceptDeviceBytes(message);
    console.log("[media-do] device_frame", { message: message.slice(0, 500) });
    const frame = parseFrame(DeviceMediaFrameSchema, message);
    if (!frame) {
      const parsed = DeviceMediaFrameSchema.safeParse(parseJson(message));
      console.log("[media-do] device_invalid_frame", {
        errors: parsed.success ? null : parsed.error.issues,
      });
      return this.closeDeviceFatal("invalid_frame");
    }
    if (frame.type === "stream.state.updated") {
      this.state.deviceStreamState = frame.payload.state;
      if (this.state.currentMedia) {
        const playback = frame.payload.state.playback;
        this.state.currentMedia = {
          ...this.state.currentMedia,
          current: { ...this.state.currentMedia.current, playbackState: playback },
          playback,
          updatedAt: frame.payload.sentAt,
        };
      }
      this.state.streamRequestRejectedAt = undefined;
      return this.stateChanged();
    }
    if (frame.type === "media.updated") {
      this.state.currentMedia = {
        current: frame.payload.media, clock: frame.payload.clock,
        playback: frame.payload.media.playbackState ?? "playing", updatedAt: frame.payload.sentAt,
      };
      return this.stateChanged();
    }
    if (frame.type === "ack") return this.applyDeviceAck(frame);
    if (frame.type === "audio.chunk") this.pendingChunk = { ...frame.payload, codec: this.state.streamContext?.codec ?? "pcm16-wav" };
    if (frame.type === "stream.stopped" || frame.type === "error") this.endStreamForClients();
  }

  async handleDeviceBinary(deviceSessionId: string, bytes: ArrayBuffer) {
    if (this.state.device?.deviceSessionId !== deviceSessionId) return;
    return this.acceptDeviceBytes(bytes);
  }

  async removeClientStream(sessionId: string, tabId: string) {
    this.streamClients.delete(tabKey(sessionId, tabId));
    await this.stopIfNoStreamClients();
  }

  async sendCurrentState(sessionId: string, tabId: string) {
    await globalStub(this.env).sendClientFrame(sessionId, tabId, {
      protocol: CLIENT_WS_PROTOCOL,
      type: "state",
      revision: this.state.revision,
      updatedAt: this.state.updatedAt,
      media: this.state.currentMedia,
      stream: { source: sourceFromState(this.state) },
    });
  }

  async handleStreamRequest(sessionId: string, tabId: string, requestId: string) {
    const source = sourceFromState(this.state);
    if (source.state !== "ready") {
      await globalStub(this.env).sendClientFrame(sessionId, tabId, {
        protocol: CLIENT_WS_PROTOCOL,
        type: "stream.rejected",
        requestId,
        source,
      });
      return;
    }
    const context = this.context();
    const meta: StreamClientMeta = { sessionId, tabId };
    this.streamClients.set(tabKey(sessionId, tabId), meta);
    await globalStub(this.env).sendClientFrame(sessionId, tabId, {
      protocol: CLIENT_WS_PROTOCOL,
      type: "stream.accepted",
      requestId,
      stream: { streamId: context.streamId, generation: context.generation },
    });
    const sent = await this.sendDeviceCommand("stream.requested", context.streamId, context.generation);
    if (!sent) {
      this.streamClients.delete(tabKey(sessionId, tabId));
      await this.closeDeviceFatal("command_conflict");
      await globalStub(this.env).sendClientFrame(sessionId, tabId, {
        protocol: CLIENT_WS_PROTOCOL,
        type: "stream.rejected",
        requestId,
        source: sourceFromState(this.state),
      });
    }
  }

  async handleStreamStop(sessionId: string, tabId: string) {
    await this.stopClientStream({ sessionId, tabId });
  }

  async handleClientAck(sessionId: string, tabId: string, _streamId: string, _generation: number, seq: number) {
    const meta = this.streamClients.get(tabKey(sessionId, tabId));
    if (meta) meta.lastAckSeq = seq;
  }
}
