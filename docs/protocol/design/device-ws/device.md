# Device WS 协议

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、`common`、`macosApp`
状态：draft
验证：协议草案；实现前需要补 schema、worker/native 测试和端到端验证

## Connection

common WS 连接生命周期使用：

```ts
type CommonConnectionProtocol = "device.connection.v1";
```

hello：

```ts
type CommonConnectionHello = {
  protocol: "device.connection.v1";
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
    supportedProtocols: string[];
  };
};
```

hello ack：

```ts
type CommonConnectionHelloAck = {
  protocol: "device.connection.v1";
  type: "hello_ack";
  payload:
    | {
        accepted: true;
        serverTime: string;
        connectionId: string;
        deviceSessionId: string;
        selectedProtocols: string[];
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

`accepted = false` 后，server 必须立即关闭 common WS。

身份绑定规则：

- `workspaceId/siteId/deviceId` 是 common WS 连接建立时的 endpoint 参数，不通过 hello frame 传递。
- `deviceSessionId` 由 server 在 common WS hello ack 中生成并返回。
- server 在 upgrade/鉴权阶段绑定 common WS 连接上下文；hello 只做 device metadata、capability、protocol negotiation 和 `deviceSessionId` 分配。
- common WS 上的后续业务 frame 默认继承连接上下文，不需要每帧重复 `workspaceId/siteId/deviceId/deviceSessionId`。
- media WS 必须使用 common WS hello ack 返回的 `deviceSessionId` 绑定到同一 device session。

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

`session_end` 表示 device 主动结束当前 device session。发送 `session_end` 后，device 必须立即关闭 common WS；如果 media WS 存在，也必须关闭。server 收到后释放该 `deviceSessionId` 对应的整个 device session 上下文。
