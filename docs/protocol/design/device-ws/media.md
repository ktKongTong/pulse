# Device Media 协议

归属：`packages/v2/realtime-protocol`
代码范围：`packages/v2/realtime-protocol`、`apps/realtime-worker-v2`、`common`、`macosApp`
状态：draft
验证：协议 schema、worker WS tests、KMP common compile

## Connection

media 业务帧承载在统一 device WS（`device.ws.v2`）上，不再有独立的 media connection hello。device WS hello ack 后，device 必须立即发送当前 `stream.state.updated` snapshot；如果当前存在 now playing item，也必须立即发送 `media.updated` snapshot。后续同类 frame 只在状态变化、media 变化或诊断需要时发送。

Media capability 规则：

- `media.capabilities.media = false` 表示 device WS 保持连接，但 server 不会发送 `stream.requested` / `stream.resume` / `stream.stop`，device 只上报 media state 和 now playing。
- codec 是 device 输出音频事实，server 不做重编码，也不以 codec 作为是否允许 streaming 的判断条件。

## Media

Media protocol：

```ts
type MediaDeviceProtocol = "device.media.v1";

type StreamFormat = {
  codec: "pcm16-wav" | "opus" | "aac";
  sampleRate: number;
  channels: number;
  bitDepth?: number;
};

type StreamBlockedReason =
  | "no_playable_media"
  | "capture_permission_missing"
  | "capture_permission_revoked"
  | "capture_source_unavailable"
  | "capture_source_lost"
  | "unsupported_app"
  | "native_error";

type DeviceStreamStoppedReason =
  | StreamBlockedReason
  | "native_shutdown"
  | "manual_stop";

type CaptureInfo = {
  provider?: string;
  displayName?: string;
  appId?: string;
};
```

stream state：

```ts
type StreamStateUpdatedFrame = {
  protocol: "device.media.v1";
  type: "stream.state.updated";
  payload: {
    sentAt: string;
    state: {
      permission: "allow" | "disallow";
      playback: "playing" | "paused";
      capture: "capturing" | "no-capture";
      streamFormat?: StreamFormat;
      reason?:
        | "no_playable_media"
        | "capture_permission_missing"
        | "capture_permission_revoked"
        | "capture_source_unavailable"
        | "capture_source_lost"
        | "unsupported_app"
        | "native_error";
      message?: string;
    };
  };
};
```

`stream.state.updated` 用于上报 streaming runtime/admission 状态：

| 字段 | 语义 |
| --- | --- |
| `permission` | device 是否允许 media/streaming |
| `playbackStatus` | 当前播放状态 |
| `captureStatus` | 当前是否正在采集音频 |
| `streamFormat` | 当前采集/编码输出格式；格式变化时通过 `stream.state.updated` 上报 |
| `reason` | 不可播放、不可采集或错误原因 |
| `message` | 面向诊断的补充文本 |

media item/clock：

```ts
type MediaUpdatedFrame = {
  protocol: "device.media.v1";
  type: "media.updated";
  payload: {
    sentAt: string;
    media: LiveListenMedia;
    clock?: LiveListenClock;
  };
};
```

`media.updated` 用于上报 now playing item 和媒体时钟。播放曲目、标题、封面、进度、时长变化时发送。

如果 streaming 正在进行时发生媒体变化，device 发送 `media.updated`，audio stream 继续使用当前 `streamId/generation`。server 更新 now playing view；后续 `audio.chunk` 仍属于同一个 stream，除非 device 发送 `stream.stopped` 或 server 发送新的 stream command。

自动切歌只改变 now playing item 和 media clock，不应改变 stream format。只有采集管线或编码参数实际变化时，才视为 stream format 变化。device 不能静默切换 format；发生 format 变化时必须通过 `stream.state.updated` 上报新的 `streamFormat`，stream 继续运行，不因此发送 `stream.stop` 或 `stream.stopped`。

使用新 format 的第一帧 `audio.chunk` 之前，device 必须先发送包含新 `streamFormat` 的 `stream.state.updated`。

server stream command：

```ts
type MediaCommandFrame = {
  protocol: "device.media.v1";
  type: "command";
  payload: {
    commandId: string;
    sentAt: string;
    expiresAt: string;
    command:
      | {
          type: "stream.requested";
          streamId: string;
          generation: number;
        }
      | {
          type: "stream.resume";
          streamId: string;
          generation: number;
          fromSeq: number;
        }
      | {
          type: "stream.stop";
          reason: string;
        };
  };
};
```

收到 `stream.requested` 后，device 自动响应：如果当前 media/capture 状态允许 streaming，则开始推送音频；否则返回 `ack.status = "rejected"`。音频采集细节和输出 codec 由 device 决定。

device 收到已经过期的 command 时直接丢弃，不执行，也不回 ack。

`stream.resume` 是一次续流行为请求，不是状态。server 用它表达“继续同一个 `streamId` 的当前音频流”。`stream.resume` 只在以下条件成立时发送：

- server 仍把同一条逻辑流视为当前可续流对象（`streamId/generation` 未终止）。
- server 当前仍有同一 `streamId/generation` 的 active stream context。
- server 计算出的 `fromSeq` 仍然有效。

device 收到 `stream.resume` 后按本地采集连续性决定响应：

- 如果能继续同一个 `streamId/generation`，返回 `ack.status = "accepted"`，并返回该 generation 的 `firstSeq`。
- 如果不能继续原 generation，但仍能为同一个 `streamId` 继续供流，device 可以直接切到下一代 generation，并返回 `ack.status = "accepted"`、新的 `generation` 和 `firstSeq`。
- 如果当前不能为该 stream 供流，返回 `ack.status = "rejected"`。

`stream.stop` 是 server 请求 device 停止当前 active stream 供音；`stream.stopped` 是 device 主动上报停止事实（权限丢失、source 丢失、native shutdown 等）。两者语义不同，不能互相替代。

device command ack：

```ts
type MediaCommandAckFrame = {
  protocol: "device.media.v1";
  type: "ack";
  payload:
    | {
        commandId: string;
        commandType: "stream.requested";
        status: "accepted";
        streamId: string;
        generation: number;
        firstSeq: number;
        capture?: CaptureInfo;
        streamFormat: StreamFormat;
        sentAt: string;
      }
    | {
        commandId: string;
        commandType: "stream.resume";
        status: "accepted";
        streamId: string;
        generation: number;
        firstSeq: number;
        unavailableBeforeSeq?: number;
        capture?: CaptureInfo;
        streamFormat?: StreamFormat;
        sentAt: string;
      }
    | {
        commandId: string;
        commandType: "stream.requested" | "stream.resume";
        status: "rejected";
        rejectedReason: StreamBlockedReason;
        sentAt: string;
      }
    | {
        commandId: string;
        commandType: "stream.stop";
        status: "stopped";
        streamId: string;
        generation: number;
        sentAt: string;
      };
};
```

Ack status 只描述 command 处理结果：

| status | 触发 | 语义 |
| --- | --- | --- |
| `accepted` | `stream.requested` / `stream.resume` | device 接受开流或续流请求，并会从 `firstSeq` 开始发送 audio chunk。 |
| `rejected` | `stream.requested` / `stream.resume` | device 当前不能满足请求，原因放在 `rejectedReason`。 |
| `stopped` | `stream.stop` | device 已停止对应 stream，不再发送该 `streamId/generation` 的 audio chunk。 |

字段规则：

- `commandId` 必须等于被响应 command 的 `commandId`。
- `type` 必须等于被响应 command 的 `command.type`。
- `stream.requested accepted` 必须返回 `streamId/generation/firstSeq/streamFormat`。
- `stream.resume accepted` 必须返回 `streamId/generation/firstSeq`；如果切到新的 generation，必须返回当前 `streamFormat`。
- `unavailableBeforeSeq` 只在接受 `stream.resume` 且 device 无法按 `fromSeq` 无缝继续时出现，表示 `seq < unavailableBeforeSeq` 的音频不可再由 device 补发。
- `rejectedReason` 只在 `stream.requested` / `stream.resume` 被拒绝时出现。
- `stream.stop stopped` 必须返回实际停止的 `streamId/generation`。
- `captureStatus` 是 device 返回的采集展示信息，只用于诊断或下游展示，不参与 server 对供流能力的判断。
- `streamFormat` 是当前采集/编码输出格式，必须在 `stream.requested` 被接受时返回；后续格式变化通过 `stream.state.updated` 上报。device 响应 `stream.resume` 时如果切到新的 generation，必须返回当前 `streamFormat`。

## Resume 游标语义

`stream.resume.fromSeq` 是 server 对 device 的续流请求游标，表示 server 期望 device 后续发送的第一帧 `audio.chunk.seq`。

```text
server latest received seq = 240
server -> device stream.resume(fromSeq = 241)
```

device 响应时：

- `firstSeq` 表示 device 实际承诺接下来发送的第一帧 seq。
- 如果 `firstSeq === fromSeq`，device 可以按 server 期望无缝继续。
- 如果 `firstSeq > fromSeq`，device 可以继续同一 `streamId/generation`，但 `[fromSeq, firstSeq)` 这段音频 device 已无法补发；此时必须带 `unavailableBeforeSeq = firstSeq`。
- 如果 device 无法继续同一 generation，但仍能为同一 `streamId` 供流，可以在 `ack` 中返回新的 `generation` 和 `firstSeq`，表示已切到新的音频 epoch。
- device 只能在同一个 `streamId` 内切换 generation，不能在 `stream.resume` ack 中切换 `streamId`。
- device 主动切换 generation 时只能递增到请求 generation 的下一代，不能跳号。
- 新 generation 的 `audio.chunk.seq` 从 `0` 开始。

server 的本地 buffer replay 不属于 device/server resume 语义。server 是否能用自己的 buffer 覆盖 `[fromSeq, firstSeq)` 缺口，是 server 内部供流能力，不通过 `MediaCommandAckFrame` 表达。

audio chunk：

```ts
type MediaAudioChunkFrame = {
  protocol: "device.media.v1";
  type: "audio.chunk";
  payload: {
    streamId: string;
    generation: number;
    seq: number;
    sentAt: string;
    durationMs: number;
    byteLength: number;
    clock?: LiveListenClock;
  };
};
```

`audio.chunk` 是 JSON metadata frame。其后紧跟一个 binary audio frame，binary frame 的长度必须等于 `payload.byteLength`。codec、sampleRate、channels、bitDepth 属于 stream generation 的格式声明，不在每个 chunk 中重复携带。

binary frame 只允许跟随 `audio.chunk` metadata frame：

```text
device -> server text:   { protocol: "device.media.v1", type: "audio.chunk", payload: { byteLength, ... } }
device -> server binary: audio bytes, length == payload.byteLength
```

规则：

- `audio.chunk` metadata frame 和其后的 binary audio frame 构成一个不可拆分的 chunk pair。
- binary frame 必须紧跟对应的 `audio.chunk` metadata frame，中间不能插入其他 text 或 binary frame。
- server 收到孤立 binary frame、连续 binary frame、或 `byteLength` 不匹配时，必须按协议错误处理。
- `stream.state.updated`、`media.updated`、`ack`、`stream.heartbeat`、`stream.stopped`、`error` 都是独立 text frame，不携带也不跟随 binary frame。

## Command 与供流连续性

- `stream.requested`、`stream.resume`、`stream.stop` 都是 server -> device 的 command。
- device 对未过期 command 必须回 `ack`，并复用同一个 `commandId`；过期 command 直接丢弃。
- server 对 device 发出的 `resume` 只是一次续流请求；device 是否能继续由 `ack`、`stream.state.updated`、`stream.stopped` 和后续 `audio.chunk` 共同表达。
- device 重连期间，server/device 协议只描述 media WS 上的请求、响应和音频事实，不定义 Web client 状态。

`stream.stop` 与 `stream.stopped` 顺序规则：

- server 发送 `stream.stop` 时，device 只返回 `MediaCommandAckFrame(status = "stopped")`，不再为同一次停止额外发送 `stream.stopped`。
- `stream.stop` 只应该在 device 有当前 active stream 时出现；如果 device 收到 stop 时没有 active stream，按协议错误关闭 media WS。
- device 主动停止当前 stream 时，device 发送 `stream.stopped`，不需要伪造 command ack。
- 同一个停止事实不能同时用 command ack 和 `stream.stopped` 上报，避免 server 重复处理。

## Frame 发送时机

| Frame | 方向 | 发送时机 | binary |
| --- | --- | --- | --- |
| `stream.state.updated` | device -> server | permission、playback、capture runtime 或阻断原因变化时。可在未串流时发送。 | no |
| `media.updated` | device -> server | now playing item 或 media clock 变化时。可在未串流时发送。 | no |
| `command` | server -> device | server 请求开流、续流或停止时。 | no |
| `ack` | device -> server | device 响应 server command 时。 | no |
| `audio.chunk` | device -> server | device 已接受开流/续流且正在推送音频时。 | yes, immediately after text metadata |
| `stream.heartbeat` | device -> server | 串流期间无 chunk 或需要上报 lastSeq/clock/capture 诊断时；必要性和周期仍待确认。 | no |
| `stream.stopped` | device -> server | device 主动停止当前 stream 时。 | no |
| `error` | device -> server | device 发现协议错误或不可恢复 media 错误时。 | no |

device -> server stream heartbeat：

```ts
type MediaStreamHeartbeatFrame = {
  protocol: "device.media.v1";
  type: "stream.heartbeat";
  payload: {
    streamId: string;
    generation: number;
    sentAt: string;
    lastSeq: number;
    clock?: LiveListenClock;
    capture?: CaptureInfo;
  };
};
```

device -> server stream stopped：

```ts
type MediaStreamStoppedFrame = {
  protocol: "device.media.v1";
  type: "stream.stopped";
  payload: {
    streamId: string;
    generation: number;
    reason: DeviceStreamStoppedReason;
    sentAt: string;
  };
};
```

device media error：

```ts
type MediaErrorFrame = {
  protocol: "device.media.v1";
  type: "error";
  payload: {
    sentAt: string;
    error: {
      code: string;
      message: string;
    };
  };
};
```
