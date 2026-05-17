# Protocol 文档

归属：`packages/realtime-protocol` 以及 worker、desktop、browser、SDK 共同遵守的 wire contract。

这里维护通信协议，不维护单个 runtime 的内部实现细节。

## 阅读顺序

1. [当前架构](./architecture.md)
2. [Device WebSocket 协议草案](./design/device-ws/index.md)
3. [文件组织规范](./specs/file-organization.md)
4. [消息模型规范](./specs/message-model.md)
5. [Endpoint Contract](./specs/endpoint-contracts.md)
6. [兼容策略](./specs/compatibility.md)
7. [验证门槛](./specs/verification.md)

## 子目录

- [设计](./design/index.md)
- [规范](./specs/index.md)
- [执行计划](./exec-plans/index.md)
- [决策记录](./decisions/index.md)

## 边界

Protocol 文档定义合同。Worker 和 Desktop 文档定义各自如何实现或消费这些合同。
