# Device Interaction WS 协议

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、`common`、`macosApp`
状态：draft
验证：协议草案；实现前需要补 schema、worker/native 测试和端到端验证

Interaction protocol：

```ts
type InteractionWsProtocol = "interaction.ws.v1";
```

server command：

```ts
type InteractionCommandRequestFrame = {
  protocol: "interaction.ws.v1";
  type: "command.request";
  payload: {
    request: InteractionState;
  };
};
```

device ack：

```ts
type InteractionCommandAckFrame = {
  protocol: "interaction.ws.v1";
  type: "command.ack";
  payload: {
    requestId: string;
    accepted: boolean;
    status: "acknowledged" | "rejected" | "executing" | "failed";
  };
};
```

device result：

```ts
type InteractionCommandResultFrame = {
  protocol: "interaction.ws.v1";
  type: "command.result";
  payload: {
    requestId: string;
    status: "succeeded" | "rejected" | "failed";
    error?: {
      code: string;
      message: string;
    };
  };
};
```
