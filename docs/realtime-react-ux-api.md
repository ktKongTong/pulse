# @pulse/realtime-react API
本文档整理 `@pulse/realtime-react` 应该对外暴露的 API。

## Before Start
`@pulse/realtime-react` 其目标是对 backend 暴露的 raw api 进行封装，让用户侧能够无痛调用，以提升用户体验。

因此有几个原则应当遵循：
- raw api 的细节不应该过度暴露，不应该成为用户使用的默认路径。
- 优先使用用户常用的 API，结合实际场景进行 API 设计，最好让用户在一个组件中，以一个 Hook 就能获取到需要的功能。



### 基础结构

因为底层 API 强依赖于 websocket，并且当前是按 room 维护多个 websocket transport，所以仍然需要一些全局状态与 transport registry 进行共享。因此会导出一个全局的 `LiveStatusProvider`.


在这个provider 中，会定义一些基础的、全局的配置。
```typescript
type ProviderConfig = {
  baseUrl: string // backend baseurl
  debug?: boolean // debug 模式
  readingHeartbeatMs?: number // 心跳间隔，保持默认即可
  readingProgressThrottleMs?: number // 节流时间，保持默认即可
  readingProgressDeltaPercent?: number // 进度上报的最小 delta，实际上，进度计算可以适当交给用户。

  sessionStorageKey?: string // browser 本地持久化用户 session，使得backend 能够进行适当识别
  tabStorageKey?: string // 一个用户可能同时开启多个 tab，每个 tab 都有一个 WS 连接，因此要进行区分。同样是browser本地存储，仅在tab 生命周期内有效。
}
```


典型使用方式如下：

```tsx
<LiveStatusProvider baseUrl={"https://example.com"}>
{children}
<LiveStatusProvider/>
```


#### 站点实时数据

这部分 API 用于用户访问实时数据，但是会按照场景不同进一步进行细分。
这些 Hook 的 API 除了导出数据字段外，还需要导出当前的状态字段，用于辅助 UI 的展示。(参考 react-query 的状态字段)
```ts
type NetStatus = {

  loading: boolean,
  error?: Error,
  refetch: () => void
  // more...
}
```

##### 站点全局数据

主要表示站点状态和owner状态，分为多个层级
1. 一个全局的统一的，allInOne 的大对象
```ts
type GlobalStatus = {
  pv: number,
  uv: number,
  // 游客/用户累计停留时间
  stayTimeInSec: number,
  // 当前活跃的 Session ID，一个 session 可以处于多个 page 中。
  // 可能不是全部（如果session 数比较多，可能只传递 3-5个
  sessions: {
    id: string,
    // 具体的用户信息可以不必如此详细，可能 sessionId/userId 就够了。
    // 如果接入外部用户系统，这些信息可以从外部 API 批量获取，从而减少数据量。
    userId?: string,
    userName?: string,
    userAvatar?: string
  }[]
  // 当前页面的 session 总数
  sessionCount: number,
  activePageCount: number,
  // 当前活跃的页面，key 通常是 page-id(可以是 id/url/slug or anything，取决于客户端)
  // 这个 activePageMap 并非从 server 侧传输过来就是如此，是为了易用性而进行的结构改造。
  activePage: Map<string, { pageDetial, sessionId }>
  ownerStatus: OwnerStatus
}

type OwnerStatus = {
  focus?: FocusStatus
  media?: MediaStatus
  lastActivedAt: Date
}

type FocusStatus = {
  id: string, // 当前 focus-app-id
  name: string, // 当前 focus 的应用名称，不对外暴露包名
  /**
   * metadata, 一些 与应用相关的 extra info
   * 比如在使用浏览器时，可能是浏览器标签名称，url
   * 在游玩 Steam 时，可能是游戏名称、最近游玩进度、成就解锁
   * 在敲代码时，可能是项目名称、language
   * 基于这些信息，用户可以进一步定制文本
   * 比如“正在与 codex battle”、“正在网上冲浪”、“正在游玩千恋万花”...
   */ 
  metadata?: Record<string, unknown>
  desc?: string, // 一些预定义的description
  // 可能是 focus 应用 icon 的 url，也可能是 SDK 中预定义的 Component
  icon?: string | React.ReactNode;
}
const globalStatus = useGlobalStatus()

```

2. 按照内容/场景划分的小 Hook。
比如 `useOwnerStatus`，这个 Hook 专门用于构建 owner 状态的场景。也有其他更细分的 hook。
 

```ts
// ownerStatus
const ownerStatus = useOwnerStatus()

// 当前的 focusApp
const { data: app, error, loading, refetch } = useOwnerFocusApp()

// 当前的 media
const { data: media, error, loading, refetch } = useOwnerMedia()

// media 的 duration信息通常不是实时的、但可以为了UX提供一个平滑 duration 的 Hook
const tick = useSmoothTick(media)

```

#### 页面级实时数据

表示页面独有的数据，比如当前页面活跃会话、阅读进度、累计停留时间等

```ts
type PageStatus = {
  // 这是不重要的指标
  pv?: number,
  uv?: number,
  // 游客/用户在当前页面累计停留的时间
  stayTimeInSec: number,
  // 当前页面活跃的 Session ID，一个 session 可以处于多个 page 中。
  // 当前页面的 sessions 信息，可能并不是全部（如果session 数比较多，可能只传递 3-5个
  sessions: {
    id: string,
    // 用户在当前页面的停留的具体信息。
    progress?: unknown,
    // 具体的用户信息可以不必如此详细，可能 sessionId/userId 就够了。
    // 如果接入外部用户系统，这些信息可以从外部 API 批量获取，从而减少数据量。
    userId?: string,
    userName?: string,
    userAvatar?: string
  }[]
  // 当前页面的 session 总数
  sessionCount: number,
  // 当前活跃的页面，key 通常是 page-id(可以是 id/url/slug or anything，取决于客户端)
  // 这个 activePageMap 并非从 server 侧传输过来就是如此，是为了易用性而进行的结构改造。
  activePage: Map<string, { pageDetial, sessionId }>
  
}

// pageStatus
const { data: pageStatus } = usePageStatus()

```

#### 其他数据
有一些数据并非与页面强相关，但也有一定的实时性，比如 chatroom。

这些数据则与具体场景高度相关，大部分是 SDK 无法覆盖的地方。

```ts

type ChatRoom = {
id: string
// 可能 public，也可能是临时的私聊
type: string,
// 最新的消息，可能只有最新的 10-20 条消息，剩下的则应该从历史消息 API 获取。
// 从历史 API 与实时 API 的获取转换是一个相对固定的流程，因此也可以进行封装，调用方可以不需要关心。
lastestMessage: Message[],
lastReadedMessageId: number,
unreadMessage: number,
messageCount: number,
}

const chatRoom = useChatRoom("roomId")

const chatRoom = useRandomRoom("shardingKey")
```
