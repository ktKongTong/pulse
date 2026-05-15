# Desktop App 文档

归属：`common`、`macosApp`

这里维护 Pulse 的 KMP 共享层和原生 macOS app。涉及 Kotlin shared code、Room/SQLite、Swift Export、SwiftUI 壳层、native service、权限、Xcode/Gradle 验证时，先读这个目录。

## 阅读顺序

1. [当前架构](./architecture.md)
2. [文件组织规范](./specs/file-organization.md)
3. [开发与验证规范](./specs/verification.md)
4. 如果任务涉及目标产品结构或 UI 重构，再读 [macOS App 重构 PRD](./design/mac-app-rebuild-prd.md)

## 子目录

- [设计](./design/index.md)
- [规范](./specs/index.md)
- [参考](./reference/index.md)
- [执行计划](./exec-plans/index.md)
- [决策记录](./decisions/index.md)

## 边界

通信格式、endpoint contract 和跨端兼容策略归 [Protocol](../protocol/index.md)。Desktop 侧如果序列化或消费协议消息，必须同步检查 protocol 文档和测试。
