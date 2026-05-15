# Pulse Worker 当前架构

归属：`apps/realtime-worker`
代码范围：`apps/realtime-worker`
状态：active
验证：`pnpm --filter @pulse/realtime-worker typecheck` 和相关 focused tests

`apps/realtime-worker` 同时承担服务端 runtime 和 worker-hosted web UI。当前结构包含 React Router route module、Cloudflare Worker API handler、Durable Object、统计查询和前端组件。

## 当前职责

- 接收 native 和 browser 的 HTTP ingest。
- 提供 realtime room、Live Listen、media room 等 WebSocket endpoint。
- 用 Durable Object 维护房间状态和热状态。
- 提供本地和部署后的 web UI，用于 status、debug、Live Listen、media room 等流程。
- 为 `@pulse/realtime-react` 和页面提供查询 endpoint。

## 当前非职责

- 不定义 canonical wire schema；schema 归 `packages/realtime-protocol` 和 `docs/protocol/`。
- 不拥有 native 本地持久化、权限或 SwiftUI app 行为；这些归 `docs/desktop-app/`。
- 不把协议变更藏在 UI helper 中；协议变更必须在 protocol docs 和测试中可见。

## 关键运行规则

本地验证 `localhost:8900` 时，必须同时检查用户可见 root page 和目标 API。API 正常不代表 React Router 入口正常。
