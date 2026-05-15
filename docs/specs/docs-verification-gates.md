# 验证门槛

归属：global
代码范围：`package.json`、`apps/realtime-worker/package.json`、`packages/realtime-protocol/package.json`、`common`、`macosApp`
状态：active
验证：命令必须和当前 package scripts 对齐

使用能覆盖改动归属的最窄门槛。宽泛命令只有在实际覆盖目标行为时才算证据。

## Worker

```bash
pnpm --filter @pulse/realtime-worker typecheck
pnpm --filter @pulse/realtime-worker test
pnpm --filter @pulse/realtime-worker build
```

## Protocol

```bash
pnpm --filter @pulse/realtime-protocol typecheck
pnpm --filter @pulse/realtime-protocol test
```

## Desktop

```bash
pnpm check:native
```

Swift 或 Xcode 工程变更还需要跑 Xcode build。

## Workspace

```bash
pnpm check
pnpm check:all
```

跨 package 或跨 owner 改动，先跑 owner-specific 门槛，再按需要跑 workspace 门槛。
