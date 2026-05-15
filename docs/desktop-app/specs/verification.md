# Desktop App 开发与验证

归属：`common`、`macosApp`
代码范围：`package.json`、`common`、`macosApp`
状态：active

## 1. KMP 编译 / 共享层门槛

默认入口：

```bash
pnpm check:native
```

等价于根目录脚本：

```bash
./gradlew --no-daemon -Dorg.gradle.vfs.watch=false :common:compileKotlinJvm :common:compileKotlinMacosArm64
```

适用场景：

- shared model / bridge / Swift Export / native build wiring 变更
- 需要确认 `common` 当前可编译

## 2. Swift/macOS 构建门槛

Swift 文件、Xcode 工程、entitlements、资源或 native app wiring 变更后运行：

```bash
xcodebuild -project macosApp/PulseBarNative.xcodeproj \
  -scheme PulseBarNative \
  -configuration Debug \
  -derivedDataPath macosApp/.xcode-derived \
  CODE_SIGNING_ALLOWED=NO build
```

## 3. 启动已有 Debug 包

如果目标是观察运行态，且 Debug app bundle 已存在，先启动现有包，不要先重建：

```bash
open macosApp/.xcode-derived/Build/Products/Debug/PulseBarNative.app
```

适用场景：

- 只验证菜单栏行为、dashboard 行为、权限弹窗、媒体读取、Live Listen 或 endpoint 上报
- 已确认当前 Debug bundle 足够新，不需要因为观察运行态而先浪费一次重建

## 4. 最低验证门槛

### 只改文档

- 更新相关文档链接和入口
- 搜索旧路径、本机绝对路径和明显过期表述残留

### 改 shared/KMP

- `pnpm check:native`

### 改 Swift / Xcode / 资源 / entitlements

- `xcodebuild ... build`
- 如果同时影响 shared bridge，再跑 `pnpm check:native`

### 改运行态相关路径

涉及菜单栏、权限、媒体、Live Listen 或 endpoint 上报时，构建通过不是完成证据。必须启动 app，并验证用户关心的真实路径。

## 5. 运行态验证原则

构建成功只说明能编译，不说明用户路径正确。以下类型改动需要至少做一轮真实路径验证：

- 菜单栏展示 / 打开 / 关闭
- dashboard 页面切换和关键操作
- 权限申请与拒绝后的行为
- frontmost app / browser / media 读取
- Live Listen capture / connect / stop
- endpoint connect / disconnect / replay / 上报

如果无法在当前环境完成真实路径验证，必须在任务记录里明确写出阻塞原因。
