# Device WS 协议

归属：`packages/v2/realtime-protocol`
代码范围：`packages/v2/realtime-protocol`、`apps/realtime-worker-v2`、`common`、`macosApp`
状态：draft
验证：协议 schema、worker WS tests、KMP common compile

## Connection

device WS 连接生命周期使用：

```ts
type DeviceWsProtocol = "device.ws.v2";
```

hello（统一携带 device metadata、presence capabilities、media capabilities、audio capabilities）：

```ts
type DeviceWsHello = {
  protocol: "device.ws.v2";
  type: "hello";
  payload: {
    device: {
      name: string;
      platform: "macos" | "windows" | "linux" | "other";
      appVersion?: string;
      mode?: string;
      displayName?: string;
    };
    capabilities: {
      focusApp: boolean;
      windowTitle: boolean;
      pageTitle: boolean;
      pageUrl: boolean;
    };
    media: {
      capabilities: {
        media: boolean;
        localPlayback: boolean;
        remotePlayback: boolean;
        binaryAudio?: boolean;
        localRingBuffer?: boolean;
        localRingBufferSeconds?: number;
      };
      audio: {
        codecs: Array<"pcm16-wav" | "opus" | "aac" | "mp3">;
        chunkDurationMs?: number;
      };
    };
    supportedProtocols: string[];
  };
};
```

hello ack：

```ts
type DeviceWsHelloAck = {
  protocol: "device.ws.v2";
  type: "hello_ack";
  payload:
    | {
        accepted: true;
        serverTime: string;
        connectionId: string;
        deviceSessionId: string;
        selectedProtocols: string[];
        capabilities: {
          streaming: boolean;
        };
      }
    | {
        accepted: false;
        serverTime: string;
        error: {
          code: string;
          message: string;
        };
      };
};
```

`accepted = false` 后，server 必须立即关闭 device WS。

身份绑定规则：

- `deviceId` 是 device WS 连接建立时的 endpoint 参数，不通过 hello frame 传递。
- `deviceSessionId` 由 server 在 device WS hello ack 中生成并返回。
- server 在 upgrade/鉴权阶段绑定 device WS 连接上下文；hello 只做 device metadata、capability、protocol negotiation 和 `deviceSessionId` 分配。
- device WS 上的后续业务 frame 默认继承连接上下文，不需要每帧重复 `deviceId/deviceSessionId`。
- 旧 `/api/v1/device/media/ws` endpoint 已删除；media 业务帧（`device.media.v1`）和 presence 业务帧（`presence.v2`）都承载在统一 device WS 上。

## Presence

Presence protocol：

```ts
type PresenceProtocol = "presence.v2";
```

```ts
type CommonPresenceState = {
  availability: {
    state: "active" | "idle";
    idleSeconds?: number;
  };
  focus: {
    app?: {
      name?: string;
      id?: string;
      category?: string;
      window?: {
        title?: string;
      };
      page?: {
        title?: string;
        url?: string;
      };
    };
  };
};
```

字段语义：

| 字段 | 语义 |
| --- | --- |
| `availability.state` | device 当前可用状态 |
| `availability.idleSeconds` | device 进入 idle 后的持续秒数 |
| `focus.app` | 当前 focus app |
| `focus.app.window` | 当前 focus app 内的窗口上下文 |
| `focus.app.page` | 当前 focus app 内的页面上下文 |

snapshot：

```ts
type PresenceSnapshotFrame = {
  protocol: "presence.v2";
  type: "snapshot";
  payload: {
    eventId: string;
    seq: number;
    observedAt: string;
    sentAt: string;
    state: CommonPresenceState;
  };
};
```

Presence event metadata：

| 字段 | 语义 |
| --- | --- |
| `eventId` | device 本地生成的事件唯一 ID |
| `seq` | device 本地单调递增序号 |
| `observedAt` | device 观测到该状态的时间 |
| `sentAt` | device 发送该 message 的时间 |

heartbeat：

```ts
type PresenceHeartbeatFrame = {
  protocol: "presence.v2";
  type: "heartbeat";
  payload: {
    eventId: string;
    seq: number;
    observedAt: string;
    sentAt: string;
  };
};
```

规则：

- device WS 每 60 秒发送一次 heartbeat。
- server 使用 device WS heartbeat 作为整个 device session 的共享 lease。
- server 150 秒未观察到 heartbeat 后，主动关闭 device session，释放 `deviceSessionId` 绑定的全部上下文（presence/focus、media state、stream）。
- heartbeat 只用于 lease，不更新 presence/focus 业务状态。

session end：

```ts
type PresenceSessionEndFrame = {
  protocol: "presence.v2";
  type: "session_end";
  payload: {
    eventId: string;
    seq: number;
    observedAt: string;
    sentAt: string;
    reason?: "app_shutdown" | "logout" | "sleep" | "network_change" | "unknown";
  };
};
```

`session_end` 表示 device 主动结束当前 device session。发送 `session_end` 后，device 必须立即关闭 device WS。server 收到后释放该 `deviceSessionId` 对应的整个 device session 上下文（presence/focus、media state、stream）。
