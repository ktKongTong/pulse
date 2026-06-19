import { DurableObject } from "cloudflare:workers";
import { CLIENT_WS_PROTOCOL, DeviceMediaFrameSchema } from "@ktfun/pulse-protocol";
import type { Env } from "../env";
import { deviceStub, globalStub } from "../env";
import { emptyMediaState, type AudioChunkMeta, type BufferedAudioChunk, type MediaStoredState, type StreamClientMeta } from "../state/media";
import { mediaStateFrame } from "../state/media";
import { tabKey } from "../state/keys";
import { RingBuffer } from "../utils/ring-buffer";
import { nowIso } from "../utils/time";
import { binaryMatchesMeta, commandExpired, commandTimeoutMs, maxBufferedChunks } from "./media-command";
import { deviceCommandFrame } from "./media-sockets";
import { applyStreamRequestTimeout, bumpMediaState } from "./media-state-ops";
import { applyAcceptedStream, ensureStreamContext } from "./media-stream";

const STATE_KEY = "media-state";

export class MediaBase extends DurableObject<Env> {
  protected state: MediaStoredState = emptyMediaState(nowIso());
  protected streamClients = new Map<string, StreamClientMeta>();
  protected pendingChunk: AudioChunkMeta | null = null;
  protected buffer: RingBuffer<BufferedAudioChunk>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.buffer = new RingBuffer(maxBufferedChunks(env, null));
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<MediaStoredState>(STATE_KEY)) ?? emptyMediaState(nowIso());
    });
  }

  protected async acceptDeviceBytes(bytes: ArrayBuffer) {
    if (!this.pendingChunk) {
      console.log("[media-do] binary_chunk_without_meta", { byteLength: bytes.byteLength });
      return this.closeDeviceFatal("invalid_audio_chunk");
    }
    const meta = this.pendingChunk;
    this.pendingChunk = null;
    if (!binaryMatchesMeta(bytes, meta)) {
      console.log("[media-do] binary_chunk_mismatch", { byteLength: bytes.byteLength, meta });
      return this.closeDeviceFatal("invalid_audio_chunk");
    }
    this.buffer.resize(maxBufferedChunks(this.env, meta.durationMs));
    this.buffer.push({ meta, bytes });
    if (this.state.streamContext) {
      this.state.streamContext.latestSeq = meta.seq;
      this.state.streamContext.availableFromSeq = this.buffer.values()[0]?.meta.seq ?? meta.seq;
      this.state.streamContext.updatedAt = nowIso();
    }
    const frame = { protocol: CLIENT_WS_PROTOCOL, type: "audio.chunk", ...meta, replayed: false };
    const targets = Array.from(this.streamClients.values());
    if (targets.length > 0) {
      await globalStub(this.env).sendAudioChunk(targets, frame, bytes);
    }
  }

  protected async applyDeviceAck(frame: Extract<ReturnType<typeof DeviceMediaFrameSchema.parse>, { type: "ack" }>) {
    if (frame.payload.status === "rejected") {
      if (!this.consumePendingAck(frame.payload.commandId, "stream.requested")) return;
      this.state.streamRequestRejectedAt = frame.payload.sentAt;
      this.streamClients.clear();
      return this.stateChanged();
    }
    if (frame.payload.status === "stopped") return this.consumeStopAck(frame.payload.commandId);
    if (frame.payload.status !== "accepted") return;
    if (!this.consumePendingAck(frame.payload.commandId, "stream.requested")) return;
    const context = ensureStreamContext(this.state, frame.payload.streamId, frame.payload.generation);
    applyAcceptedStream(context, frame.payload);
    this.state.streamContext = context;
    await this.stateChanged(false);
  }

  protected async stopClientStream(meta: StreamClientMeta) {
    const key = tabKey(meta.sessionId, meta.tabId);
    this.streamClients.delete(key);
    await globalStub(this.env).sendClientFrame(meta.sessionId, meta.tabId, {
      protocol: CLIENT_WS_PROTOCOL,
      type: "stream.stopped",
    });
    await this.stopIfNoStreamClients();
  }

  protected async stopIfNoStreamClients() {
    if (this.streamClients.size > 0 || !this.state.streamContext) return;
    const context = this.state.streamContext;
    const sent = await this.sendDeviceCommand(
      "stream.stop",
      context.streamId,
      context.generation,
    );
    if (!sent) {
      await this.closeDeviceFatal("command_conflict");
    }
    this.state.streamContext = null;
    this.buffer.clear();
    await this.stateChanged(false);
  }

  protected context(streamId?: string, generation?: number) {
    return ensureStreamContext(this.state, streamId, generation);
  }

  protected async sendDeviceCommand(type: "stream.requested" | "stream.stop", streamId: string, generation: number) {
    const device = this.state.device;
    console.log("[media-do] device_command.prepare", { type, streamId, generation, device });
    if (!device) return false;
    if (this.state.pendingCommand) {
      console.log("[media-do] device_command.blocked", { type, pending: this.state.pendingCommand, device });
      return false;
    }
    const commandId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + commandTimeoutMs(this.env)).toISOString();
    const frame = deviceCommandFrame({ commandId, type, streamId, generation, expiresAt });
    console.log("[media-do] device_command.send", { commandId, type, streamId, generation, device });
    const sent = await deviceStub(this.env, device.deviceId).sendDeviceFrame(frame);
    if (!sent) {
      console.log("[media-do] device_command.send_failed", { commandId, type, device });
      return false;
    }
    this.state.pendingCommand = { commandId, type, streamId, generation, expiresAt };
    await this.persist();
    await this.ctx.storage.setAlarm(Date.parse(expiresAt));
    return true;
  }

  protected endStreamForClients() {
    const context = this.state.streamContext;
    if (!context) return;
    for (const meta of this.streamClients.values()) {
      void globalStub(this.env).sendClientFrame(meta.sessionId, meta.tabId, {
        protocol: CLIENT_WS_PROTOCOL,
        type: "stream.ended",
        streamId: context.streamId,
        generation: context.generation,
      });
    }
    this.streamClients.clear();
    this.state.streamContext = null;
    this.buffer.clear();
  }

  protected async endDeviceSession(deviceSessionId: string) {
    if (this.state.device?.deviceSessionId !== deviceSessionId) return;
    this.markDeviceOffline(nowIso());
    await this.stateChanged();
  }

  protected broadcastState() {
    void globalStub(this.env).broadcastClientFrame(mediaStateFrame(this.state));
  }

  protected async closeDeviceFatal(code: string) {
    const device = this.state.device;
    if (!device) return;
    this.markDeviceOffline(nowIso());
    await this.stateChanged();
    await deviceStub(this.env, device.deviceId).closeDeviceSocket(code);
  }

  protected markDeviceOffline(updatedAt: string) {
    this.state.device = null;
    this.state.pendingCommand = null;
    this.state.streamContext = null;
    this.streamClients.clear();
    this.buffer.clear();
    this.state.deviceStreamState = this.state.deviceStreamState
      ? { ...this.state.deviceStreamState, playback: "paused", capture: "no-capture" }
      : null;
    if (this.state.currentMedia) {
      this.state.currentMedia = {
        ...this.state.currentMedia,
        current: { ...this.state.currentMedia.current, playbackState: "paused" },
        playback: "paused",
        updatedAt,
      };
    }
  }

  protected consumePendingAck(
    commandId: string,
    type: "stream.requested" | "stream.stop",
  ) {
    const pending = this.state.pendingCommand;
    if (!pending || pending.commandId !== commandId || pending.type !== type) {
      void this.closeDeviceFatal("command_mismatch");
      return false;
    }
    this.state.pendingCommand = null;
    void this.ctx.storage.deleteAlarm();
    return true;
  }

  private consumeStopAck(commandId: string) {
    this.consumePendingAck(commandId, "stream.stop");
  }

  async alarm() {
    const pending = this.state.pendingCommand;
    if (!pending || !commandExpired(pending)) return;
    if (pending.type === "stream.requested") {
      applyStreamRequestTimeout(this.state);
      this.streamClients.clear();
    }
    this.state.pendingCommand = null;
    await this.closeDeviceFatal("command_timeout");
  }

  protected async stateChanged(broadcast = true) {
    bumpMediaState(this.state);
    await this.persist();
    if (broadcast) this.broadcastState();
  }

  private async persist() {
    await this.ctx.storage.put(STATE_KEY, this.state);
  }
}
