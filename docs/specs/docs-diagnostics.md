# 诊断

归属：global
代码范围：runtime commands 和未来 scripts
状态：active
验证：诊断命令必须实际跑过，才能作为文档中的 gate

诊断要从真实 runtime 收集事实，不能用推测替代验证。

## 本地 Worker

调试 `localhost:8900` 时，同时检查 root page 和相关 API：

```bash
curl -i http://127.0.0.1:8900/
```

Live Listen state：

```bash
curl -i "http://127.0.0.1:8900/api/v1/live-listen/state?workspaceId=pulse-demo&roomId=live-listen:owner"
```

## Native App

如果目标是观察 runtime，且 Debug bundle 已存在，先启动现有包：

```bash
open macosApp/.xcode-derived/Build/Products/Debug/PulseBarNative.app
```

构建门槛见 desktop app 验证文档。
