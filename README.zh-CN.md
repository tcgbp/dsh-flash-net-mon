# dsh-flash-net-mon

> [dsh-flash](https://gitee.com/lenin.guo/dsh-flash) 的**网络监控 / 出站审计**伴生插件 —— 它自己注册告警提供者（alert provider）和自己的面板开关，而不是挤进 dsh-flash 的 `apply()` 里。

版本 0.1.0 · Apache-2.0

**[English](./README.md)**

## 它做什么

两块能力，分别属于宿主（Host）和浏览器（Browser）：

1. **网络监控（连通性心跳）** —— 定时探测 `/plugins/dock-flash/health`，把「慢」和「超时」变成 dsh-flash 的告警。
2. **出站审计（fetch 追踪）** —— 可选地包装全局 `fetch`，记录**元数据级**的出站请求清单，按风险分给出「正常 / 可疑 / 危险」分级，并提供筛选、白名单与风险评分说明。

审计是**默认关闭**的（`netAuditEnabled: false`）。该字段只在 Cordis 意义上 `volatile()`（可运行时免重挂载地编辑）；一旦你把开关打开，这个值就会通过 DSH 的 settings 命名空间持久化并跨重启存活，与主机白名单完全一致。

## 它注册了什么

### 宿主半 —— `src/index.ts` → `dist/index.js`

一个名为 `dsh-flash-net-mon` 的 Cordis 插件。

| 项目 | 内容 |
| --- | --- |
| 设置命名空间 | `dsh-flash-net-mon` |
| 字段 | `netAuditEnabled`、`netLogCap`、`netLogTtlSec`、`netSuspectWarn`、`netSuspectErr`、`netWhitelist`、`netPluginWhitelist`、`netSlowThreshold`、`netPollBase`、`netPollMin` |
| 路由 | `/plugins/dsh-flash-net-mon/network-log`、`/network-alerts`、`/network-whitelist`、`/network-plugin-whitelist` |

宿主半**没有**宿主侧服务依赖（`inject: []`）：所有服务都是惰性注入的，设置走 `settings`，路由走 `webServer`。

### 浏览器半 —— `lib/client.js`（无构建步骤）

| 注册内容 | 通过 |
| --- | --- |
| 告警提供者 `dsh-flash-net-mon:network-alert`（心跳） | `ctx.get('dockFlashAlerts').registerProvider()` |
| 告警提供者 `dsh-flash-net-mon:network-audit`（审计告警） | `ctx.get('dockFlashAlerts').registerProvider()` |
| 面板开关 `dsh-flash-net-mon:monitor-network` | `ctx.get('quickControl').registerSwitch()` |

开关属性：`type: 'toggle'`、`group: 'system'`、`cluster: 'system-alerts'`、`order: 60`、`icon: 'signal'`。它的**可见性跟随 dsh-flash 的 `dock-flash:system-alerts` 总开关** —— 告警注册表没开时，这个开关也没有意义。

> **双发现模式**：`ctx.get('quickControl')` / `ctx.get('dockFlashAlerts')` 是异步解析的，所以注册走三条路 —— 监听 `dock-flash:ready` 事件（应对 dsh-flash 比我们晚加载）、同步 `ctx.get()` 主动检查（应对它比我们早加载）、以及最多 15 次 × 200ms 的短轮询兜底。任一成功即置位 `_registered`，不重复注册。

## 面板与开关怎么用

### 开关

在 dsh-flash 快捷面板的「⚙️ 系统 → 系统告警」簇里找到 **网络监控**：

- 副标题实时显示 `已开启` / `已关闭`；
- 打开开关会写 `netAuditEnabled = true` 到宿主，宿主随即安装 fetch 追踪器；
- 关闭开关会**还原原始 `fetch`** 并释放监视器，所有记录停止。

**单权威**：宿主机上的 `netAuditEnabled` 设置是「开关是否开启」的唯一事实来源。它经由 DSH 的 settings 命名空间写入（与持久化主机白名单完全相同的机制），因此能跨重启存活——这里的 `volatile()` 只表示该字段可在运行时免重挂载地编辑，**不是**「DSH 会忘掉它」。开关直接读取这个已持久化的值、并通过 settings 桥写回；不存在另一份 localStorage 副本需要对齐，所以重启后开关就是你上次留的样子，也永远不会与宿主「静默分叉」。

### 配置弹窗

点开关右侧的「配置」打开网络监控配置弹窗，内含：

| 控件 | 范围 | 默认 |
| --- | --- | --- |
| 慢速阈值 `netSlowThreshold` | 1000–15000 ms，步长 500 | 5000 ms |
| 轮询基础间隔 `netPollBase` | 10000–120000 ms，步长 5000 | 60000 ms |
| 轮询最小间隔 `netPollMin` | 5000–30000 ms，步长 1000 | 10000 ms |
| 日志容量 `netLogCap` | 50–1000 条，步长 50 | 300 |
| 保留时长 `netLogTtlSec` | 0–120 分钟，步长 5（0 = 永不超时） | 60 分钟 |
| 可疑阈值 `netSuspectWarn` | 10–90，步长 5 | 40 |
| 危险阈值 `netSuspectErr` | 20–100，步长 5 | 70 |

弹窗下方还有两块：可折叠的「**风险评分算法**」说明，以及内嵌的「**网络审计**」面板。

### 网络审计面板

三个子标签共用一份数据：面板每 `max(netPollMin, netPollBase)`（默认 60 秒）拉一次 `GET /network-log`（不带 `limit`，所以走服务端默认的 100 条、最新在前），随后所有筛选与分页都在浏览器里完成。

- **请求流** —— 每页 10 条，底部有页码信息与「上一页 / 下一页」。列：方法、主机、路径、状态（2xx 绿 / 4xx 黄 / 5xx 红）、风险、耗时；时间、请求/响应大小、TLS、插件、标记在点开行后于**行内展开**的「详情」里（同一个弹窗内，再点一次该行或按 Esc 收起，不会盖住其余内容）。
- **告警** —— 同一批数据里风险分 ≥ `netSuspectWarn` 的行，按风险着色（≥ `netSuspectErr` 为危险色）。这个标签页**不是**另一条数据流。
- **白名单** —— 在「主机」和「插件」两个视图间切换，用 ✕ 删条目。主机视图还有「常见服务（一键加入）」（只给精确主机名，见下）与**只读**的「自动信任」行；插件视图额外列出日志中出现过的插件（点「信任」即加入）与手动输入框。详情里也保留「加主机白名单」「加插件白名单」。

工具栏：子标签切换、按插件筛选（选项来自当前已加载的条目）、按风险筛选（正常 / 可疑 / 危险）、**暂停 / 继续**（停掉轮询，但后端仍在记录，因此继续后会看到期间积累的条目）、**清空**（`DELETE /network-log`，清掉后端的环形缓冲与评分状态，而不只是清屏 —— 清空后「请求流」与「告警」都会变空）。自动滚动是内部行为：未暂停且开着自动滚动时，列表会跟到最新一页。

**告警通知走的是另一条路**：`dsh-flash-net-mon:network-audit` 提供者轮询 `GET /network-alerts`（间隔 `max(netPollMin, netPollBase)`），把新增的高风险请求推给 dsh-flash 的告警注册表。它按 `seq` 去重，同一条不会重复弹出，还会跳过主机白名单 / 插件白名单里的命中项。

白名单写入走两路：内存里立即生效，同时通过 `ctx.remote.settings` 持久化到 `dsh-flash-net-mon` 命名空间。客户端与上面两条 `network-*-whitelist` 路由用的是同一份设置，所以哪边先写都会被后写的覆盖；设置服务不可用时，内存里的覆盖仍然生效。

「常见服务（一键加入）」是 15 个已知 API 主机（精确主机名，如 `api.openai.com`、`dashscope.aliyuncs.com`），点一下即加入用户白名单；已被覆盖的会置灰，并标出它是「已添加」「内置」还是「已配置端点」。这份建议里**不放内容托管域名**（`github.io`、`raw.githubusercontent.com`、`*.s3.amazonaws.com`、`*.cloudfront.net` 之类）——信任它们等于对所有经其分发的第三方内容放行。它只是按钮列表，不会替你自动写入。

## 风险评分算法

每次出站请求得到 0–100 的分数：

| 因素 | 加分 |
| --- | --- |
| 未知主机：既不在内置可信列表 / 用户主机白名单里，也不是可信插件发起的（基线分） | +30 |
| 首次访问该主机（`new-host`） | +15 |
| 大体积上传：`POST`/`PUT`/`PATCH` 且请求体 > 1 KB（`large-upload`） | +25 |
| 明文传输：非 `https:`（`plaintext`） | +20 |
| 高频访问：同一未知主机已出现 ≥ 3 次（`high-frequency`） | +15 |
| 重定向到另一个不受信的主机（`redirected-host`） | 固定 60 |
| 上限 | 100 |

`redirected-host` 是一个**固定 60 分**（不是累加）。当初始目标与响应的最终主机不一致、且最终主机不受信时触发 —— 即便**初始主机本身是可信的**。你声明 `A` 可信，但数据实际发往了 `B`；这正是审计要抓的重定向式数据外传。良性重定向（同主机，或最终主机也一样可信）不加分。注意：最终主机取自 SDK 跟随重定向之后的 `res.url`，所以裸 `302` 且之后并不由 Node fetch 跟随的情况抓不到。

与 `redirected-host` 不同，`new-host` 是**累加**的。它现在是 +15 而不是 +5：因为主机频次表已改为**持久化**（见下文「主机频次持久化」）—— 重启前见过的机器重启后不再算「首次」，所以真正的首次访问变成**罕见**情况，值得单次连击告警：30 + 15 = 45 越过 `netSuspectWarn`（默认 40）。首次访问同时叠加上传或明文时，得 70 / 65。若拿不到可写的数据目录，存储会退化为纯内存，重启后每个主机又都算「首次」（此时 `new-host` 会在每次会话的首次访问时触发——标记、阈值线都不变，只是不再精确）。

URL 解析不出主机时（相对地址，如 `/x`）不参与评分：记 0 分、打 `relative-url` 标记、照常写入日志，也**不**计入主机频次表（否则所有相对地址都会堆到同一个 `?` 键上，谁也白名单不掉）。

## 主机频次持久化

驱动 `new-host` 与 `high-frequency` 的 `host → {次数, 最近一次时间}` 表，是**唯一**落盘的数据。文件在 `<DSH 数据目录>/dsh-flash-net-mon/seen-hosts.json`，其中数据目录就是 DSH 的 `baseDir`。当 DSH 拿不到 `baseDir`（或目录不可写）时，插件优雅退化为纯内存 —— 即原来的行为。

具体来说：

- **重启安全的 `new-host`**：重启前见过的主机，重启后不再算 `new-host`；只有真正的新主机才算，让 `new-host` 回归 +15 应有的「罕见 → 告警」语义。
- **留存**：距最近一次访问超过 6 小时、以及容量超过 500 个主机（按最近访问时间逐出）的条目，会在载入和新增观测时被清理 —— 文件只反映近期流量，永不无限膨胀。
- **隐私**：只记主机名（本就在审计日志里出现过）。路径、请求体、请求头数据一律不落盘。写入做了约 2.5 秒防抖，关闭审计 / 上下文销毁时冲刷落盘；清空端点也会一并重置磁盘上的这张表。

**可信就免检**：主机可信（内置可信列表 / 用户白名单 / 自动信任的端点）**或**插件可信时，风险分直接为 0，且不产生任何标记 —— 但请求**仍会记录**在请求流里。唯一的例外是重定向到另一个不受信主机，无论初始主机多可信都照样记 60（`redirected-host`）。

内置可信主机：`www.google.com`（默认连通性测试目标）、`api.deepseek.com`、`chat.deepseek.com`。没有显式覆盖时 `HOST_ALLOW_UNKNOWN = false`，即**一切未列出的主机都从「可疑」起步**。

除这份代码里的内置列表外，**DSH 自己配置的端点**也按可信处理：`settings.describe()` 里任何名字为 `baseURL`/`base_url`/`apiBase`/`api_base`/`endpoint` 的字段（LLM provider 的 `baseURL`，含 `dsh-llm-pi-ai` 那种按模型嵌套的写法），以及 `DEEPSEEK_BASE_URL` / `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` 环境变量。这一组信任**不会**写进用户白名单（用户声明与推断出的信任必须可区分），且只做**精确匹配**：配置了 `gw.example.com:8443` 不会顺带信任 `sub.gw.example.com`；`http://` 端点只在 loopback（`localhost` / `127.0.0.1` / `[::1]` / `*.localhost`）上被接受。设置一变就重算，移除 provider 后信任随之消失。白名单页的「自动信任（只读）」列出的就是当前实际生效的这批主机。

用户白名单里的**顶级域名覆盖其子域**（加入 `example.com` 即信任 `api.example.com`），与别处 `NO_PROXY` 的语义一致。

插件归属的解析顺序：`AsyncLocalStorage` 上下文（任意插件经 `withPluginContext` 播种）→ 栈帧里的 `node_modules/<pkg>/` 提示 → `unknown`。**`unknown` 本身就是有意义的告警信号**（「有匿名代码在发数据」），不会被静默丢弃。⚠ 栈帧启发式是脆弱的（在打包器 shim 或运行时包装层之间调用会误判），只作为尽力而为的兜底。为减少最常见的误判，栈扫描会跳过透明 HTTP/WS 客户端库（`axios`、`got`、`node-fetch`、`ws`、`follow-redirects`、`undici` 等），继续往真正发起请求的插件帧追——所以经由客户端库发出去的流量，归属落在调用者身上，而不是 axios/ws。

想让自己的出站调用被精确归属的 DSH 插件，用 `withPluginContext(pluginId, fn)` 包一层即可：

```ts
import { withPluginContext } from 'dsh-flash-net-mon'
withPluginContext('my-plugin', () => { /* 这里的 fetch() / http.request() 都归到 'my-plugin' */ })
```

异步上下文在 `await` 后依然存活（async_hooks），所以恢复后的回调也保持同一个 pluginId。任何上下文之外，审计器先回退到栈启发式，最后才是 `unknown`。

## HTTP 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/plugins/dsh-flash-net-mon/network-log` | 分页快照，最新在前；`?offset=` `&limit=`（1–500，默认 100），返回 `{ entries, offset, limit, total }` |
| `DELETE` | `/plugins/dsh-flash-net-mon/network-log` | 清空监视器历史（环形缓冲 + 序号 + 主机频次） |
| `GET` | `/plugins/dsh-flash-net-mon/network-alerts` | 风险 ≥ `netSuspectWarn` 的请求，返回 `{ alerts }`（最新在前） |
| `GET` | `/plugins/dsh-flash-net-mon/network-whitelist` | 只读视图，返回 `{ hosts, builtin, endpoints }`：用户白名单、内置可信主机、从 DSH 配置推导出的端点 |
| `POST` | `/plugins/dsh-flash-net-mon/network-whitelist` | 体 `{ "hosts": ["a.com", ...] }`，严格规范化为裸 `host[:port]`：去 `http(s)://` 前缀、小写化、端口须为 `0–65535` 整数，带路径/查询/片段/`user@` 一律 `400` 拒绝；写内存 + 持久化 |
| `POST` | `/plugins/dsh-flash-net-mon/network-plugin-whitelist` | 体 `{ "plugins": ["pkg-name", ...] }`，同上，按插件 ID |

行为要点：

- 请求体上限 4096 字节，超限/空/无法解析一律按「未提供覆盖」处理；
- 白名单路由是给**够不到设置服务的工具**准备的便利入口，客户端本身走 `ctx.remote.settings`；
- 审计关闭时这些路由**仍然注册**，只是返回空列表（此时不存在监视器实例），所以已经打开的面板不会 500；
- 心跳提供者轮询的 `/plugins/dock-flash/health` **属于 dsh-flash**，不在这里（K6）。

## 心跳告警（网络监控）

- 目标 `/plugins/dock-flash/health`，10 秒 `AbortController` 超时；
- 延迟 > 9 秒 → 🔴「网络连接超时」；延迟 > `netSlowThreshold` → 🟡「网络延迟较高 (Nms)」；
- 连续失败 ≥ 3 次 → 🔴 超时告警；
- 下次间隔自适应：`max(netPollMin, round(netPollBase * (1 - 延迟/超时) ^ 1.5 + netPollMin))` —— 越接近超时，下一次探测越早。

## 依赖

| 包 | 类型 | 用途 |
| --- | --- | --- |
| `@deepseek-ai/cordis` | peer | 插件框架 |
| `dsh-flash` `>=1.0.0-0 <2.0.0-0` | peer | 提供 `quickControl` 与 `dockFlashAlerts` 服务 |
| `dock-base` `>=0.1.2-0 <2.0.0-0` | peer，可选 | 仅工作台模式需要 |
| `@deepseek-ai/schemastery` | 直接依赖 | 设置 schema（`volatile()`） |

它**不硬依赖** dsh-flash：服务全部通过 `ctx.get(...)` 解析，兼容性由 **peer 范围**声明 —— 与 `dock-flash`（v3 dock-base 适配器）对 `dock-base` 的做法一致。

## 安装

```sh
dsh plugin --profile <profile> add dsh-flash-net-mon
```

需要 **dsh-flash ≥ 1.0**：它提供 `quickControl`、`dockFlashAlerts` 服务与 `dock-flash:ready` 事件，任何 1.x 都满足。dock-base 工作台里的面板 UI 来自 `dock-flash` v3 适配器（它把核心的面板挂载进工作台）。安装后请重启 DSH。

`cordis.patch.yml` 只插入宿主行。注意它的 `name` 是**包名**，通过 profile 的 `node_modules` 解析，**绝不是相对路径**。

浏览器半不需要任何配置行：模块加载器从 `package.json` 的 `exports["./client"]` 加上 `dsh.client` 自动发现，并在 `/plugins/dsh-flash-net-mon/client.js` 提供它。

## 构建

```sh
pnpm install
pnpm run build       # tsc → dist/index.js   （只编译宿主半）
pnpm run typecheck
pnpm test            # 先构建 + 单元测试（node:test，无框架依赖）
```

`dist/index.js` 是**故意入库的**，理由和 dock-flash 一样：git 安装只抓源码、不跑构建脚本，缺少 `dist/` 的仓库到手就少了 `main` 与 `exports["."]` 指向的宿主入口。`lib/client.js` 是直接手改的单文件，没有构建步骤，**刷新页面即生效**。

`test/` 里的单元测试从**编译产物** `dist/index.js`（而非 `.ts` 源码）导入，因为 Node 的 strip-only 模式解析不了 `src/index.ts` 里的参数属性（parameter property）。改代码后记得先 `pnpm build`；`pnpm test` 会自动先构建。

## 目录结构

```
src/index.ts           宿主半      → tsc → dist/index.js
lib/client.js          浏览器半    → 无构建，直接编辑
dist/index.js          编译产物 —— 故意入库
cordis.patch.yml       bundle 层：把宿主行插进 profile
.github/workflows/     sync-from-gitee.yml —— Gitee → GitHub 镜像
docs/releasing.md      镜像引导、发版手册、dsh-market 上架
docs/tcgbp__dsh-flash-net-mon.yml   dsh-market 登记项（提交用）
```

Gitee 是权威仓库，也是本地唯一配置的 remote；GitHub（`github.com/tcgbp/dsh-flash-net-mon`）
是它的镜像，同时托管 dsh-market 登记项所指向的 Release tarball。

## 隐私与限制（有意为之）

- **只记元数据**：方法、主机、路径、字节数、状态、耗时、TLS 与否、风险分、标记、时间，以及重定向后的最终主机（与初始目标不同时）。**从不读取请求/响应体，也从不记录请求头取值。** 响应对象原样返回给调用方。
- **不消费流**：请求体若是不透明流，当调用方带了显式 `Content-Length` 头时仍会据此报出字节数——所以大体积的流式上传不再对 `large-upload` 隐形；没这个头时字节数记为 0（宁可报 0 也不吞掉流）；没有 `content-length` 时响应大小记为 `-1`；响应从未到达时同样为 `-1`、状态记为 0。
- **历史只在内存里**：环形缓冲上限 `netLogCap`，超出丢弃最旧的一条。第二条淘汰轴——`netLogTtlSec`（默认 60 分钟，0 = 关闭）——会剔除早于该窗口的条目，即使缓冲未满，这样长时间运行的会话不会一直囤着陈旧日志；`record`/`snapshot`/`alerts` 下次调用时惰性裁剪前端。始终是会话数据，进程重启即丢失。唯一的例外是**主机频次表**（host → 次数 + 最近一次时间）会持久化，让 `new-host` 跨重启保持精确（见上「主机频次持久化」）。任何请求日志条目都绝不落盘。
- **全局影响**：追踪器包装的是 `globalThis.fetch`（Node 18+ 的 undici fetch，`ctx.http` 与裸 `fetch()` 共用同一入口）**以及** Node 原生 `http.request` / `https.request`（插件不走 fetch、直接谈 HTTP 时走的路径）。WebSocket 以一次 HTTP Upgrade 启程，所以 `ws`-style 连接也会被记成一条 Upgrade 请求。关闭开关会一并还原两者；`__dockFlashTraced` 标记防止热重载/重复 `apply()` 造成的双重包装。两条包装都**不读不写**请求/响应体，只记元数据。
- **实例级状态**：审计器的监视器、追踪器还原钩子与可信端点列表都收在**每个 `apply()` 自己的对象**里，不再放在模块作用域。这样第二次挂载（嵌套上下文或 remount）各握各的状态，销毁任一实例都不会把另一个的追踪器拆掉或清掉它的监视器。
- **界面语言**：面板与告警文案自带中英文，跟随 DSH 的语言设置。
