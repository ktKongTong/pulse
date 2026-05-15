# Pulse Worker 文档

归属：`apps/realtime-worker`

这里维护 Cloudflare Worker 和它承载的 web app runtime。涉及 Worker 路由、Durable Object、React Router 页面、本地开发、Worker 侧诊断和测试时，先读这个目录。

## 阅读顺序

1. [当前架构](./architecture.md)
2. [文件组织规范](./specs/file-organization.md)
3. [运行与验证规范](./specs/verification.md)
4. [当前状态参考](./reference/realtime-current-state.md)

## 子目录

- [设计](./design/index.md)
- [规范](./specs/index.md)
- [参考](./reference/index.md)
- [执行计划](./exec-plans/index.md)
- [决策记录](./decisions/index.md)

## 边界

协议消息格式归 [Protocol](../protocol/index.md)。如果 worker 改动改变了 wire behavior，必须同步更新 protocol 文档和相关测试。
