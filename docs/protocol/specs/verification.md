# Protocol 验证门槛

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol` 和协议消费者
状态：active
验证：本文就是 protocol 验证入口

## 标准门槛

```bash
pnpm --filter @pulse/realtime-protocol typecheck
pnpm --filter @pulse/realtime-protocol test
```

## 消费者门槛

影响 worker 行为时：

```bash
pnpm --filter @pulse/realtime-worker typecheck
pnpm --filter @pulse/realtime-worker test
```

影响 native 序列化时：

```bash
pnpm check:native
```

只有覆盖所有受影响消费者，协议验证才算完整。
