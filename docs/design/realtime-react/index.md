# Realtime React 设计

归属：global
代码范围：`packages/realtime-react`
状态：active
验证：设计文档入口；实现与协议改动分别按 `packages/realtime-react`、worker 和 protocol 的验证门槛执行

这里放 `@pulse/realtime-react` 的目标 API 设计和草案，不放当前 API reference，也不放共享 spec。

- [目标 API](./target-api.md)
  - 目标 facade 设计，描述希望收敛成什么样的业务 API。
- [UX API 草案](./ux-api-sketch.md)
  - 早期草案/备忘，不代表当前实现或稳定 contract。

当前公开面和用法说明见 `docs/reference/realtime-react/`；wire contract 归 `docs/protocol/`；稳定跨域规范仍放 `docs/specs/`。