# Pulse Worker 运行与验证

归属：`apps/realtime-worker`
代码范围：`apps/realtime-worker/package.json`、`apps/realtime-worker`
状态：active
验证：本文就是 worker 运行与验证入口

## 本地命令

```bash
pnpm --filter @pulse/realtime-worker dev
pnpm --filter @pulse/realtime-worker start
```

根目录快捷命令：

```bash
pnpm dev:worker
```

## 本地 URL

- Worker 和 web app：`http://127.0.0.1:8900`
- Root page gate：`http://127.0.0.1:8900/`

## 标准门槛

```bash
pnpm --filter @pulse/realtime-worker typecheck
pnpm --filter @pulse/realtime-worker test
pnpm --filter @pulse/realtime-worker build
```

Live Listen 改动要额外跑覆盖对应 API/DO 的 focused tests，不能只依赖 workspace 级信号。

## 本地用户可见门槛

涉及本地服务、React Router route、worker wiring、dev server 或本地 browser entry 时，至少验证：

```bash
curl -i http://127.0.0.1:8900/
curl -i "http://127.0.0.1:8900/api/v1/live-listen/state?workspaceId=pulse-demo&roomId=live-listen:owner"
```

第二个 URL 只适用于 Live Listen。其他功能使用对应 feature endpoint。
