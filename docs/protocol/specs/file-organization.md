# Protocol 文件组织

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`common`、`apps/realtime-worker`、`packages/realtime-react`
状态：active
验证：protocol package 或协议消费者目录变化后同步更新本文档

## 主要区域

- `packages/realtime-protocol/src`
  - TypeScript schema 和 protocol 常量。
- `packages/realtime-protocol/test`
  - 协议 shape 测试。
- `common/src/commonMain/kotlin/.../livelisten`
  - Native/Kotlin 侧 mirror wire shape。
- `apps/realtime-worker/src/api`
  - endpoint handler 和 websocket runtime 行为。
- `packages/realtime-react/src`
  - 面向业务侧的协议消费 facade。

## 放置规则

- canonical TypeScript schema 放 `packages/realtime-protocol`。
- Kotlin mirror 类型放在 native feature 附近，并用测试证明与协议包一致。
- 不能只在 worker route 里隐藏 wire change。
