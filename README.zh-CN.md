# dsh-flash-net-mon

> [dock-flash](https://gitee.com/lenin.guo/dock-flash) 的**网络监控 / 出站审计**伴生插件 —— 它自己注册告警提供者（alert provider）和自己的面板开关，而不是挤进 dock-flash 的 `apply()` 里。

版本 0.1.0 · Apache-2.0

**[English](./README.md)**

## 它做什么

两块能力，分别属于宿主（Host）和浏览器（Browser）：

1. **网络监控（连通性心跳）** —— 定时探测 `/plugins/dock-flash/health`，把「慢」和「超时」变成 dock-flash 的告警。
2. **出站审计（fetch 追踪）** —— 可选地包装全局 `fetch`，记录**元数据级**的出站请求清单，按风险分给出「正常 / 可疑 / 危险」分级，并提供筛选、白名单与风险评分说明。

审计是**默认关闭**的（`netAuditEnabled: false`，且该字段是 `volatile()`，每次 DSH 重启都会回到默认值）。

## 它注册了什么

### 宿主半 —— `src/index.ts` → `dist/index.js`

一个名为 `dsh-flash-net-mon` 的 Cordis 插件。

| 项目 | 内容 |
| --- | --- |
| 设置命名空间 | `dsh-flash-net-mon` |
| 字段 | `netAuditEnabled`、`netLogCap`、`netSuspectWarn`、`netSuspectErr`、`netWhitelist`、`netPluginWhitelist`、`netSlowThreshold`、`netPollBase`、`netPollMin` |
| 路由 | `/plugins/dsh-flash-net-mon/network-log`、`/network-alerts`、`/network-whitelist`、`/network-plugin-whitelist` |

宿主半**没有**宿主侧服务依赖（`inject: []`）：所有服务都是惰性注入的，设置走 `settings`，路由走 `webServer`。

### 浏览器半 —— `lib/client.js`（无构建步骤）

| 注册内容 | 通过 |
| --- | --- |
| 告警提供者 `dsh-flash-net-mon:network-alert`（心跳） | `ctx.get('dockFlashAlerts').registerProvider()` |
| 告警提供者 `dsh-flash-net-mon:network-audit`（审计告警） | `ctx.get('dockFlashAlerts').registerProvider()` |
| 面板开关 `dsh-flash-net-mon:monitor-network` | `ctx.get('quickControl').registerSwitch()` |

开关属性：`type: 'toggle'`、`group: 'system'`、`cluster: 'system-alerts'`、`order: 60`、`icon: 'signal'`。它的**可见性跟随 dock-flash 的 `dock-flash:system-alerts` 总开关** —— 告警注册表没开时，这个开关也没有意义。

> **双发现模式**：`ctx.get('quickControl')` / `ctx.get('dockFlashAlerts')` 是异步解析的，所以注册走三条路 —— 监听 `dock-flash:ready` 事件（应对 dock-flash 比我们晚加载）、同步 `ctx.get()` 主动检查（应对它比我们早加载）、以及最多 15 次 × 200ms 的短轮询兜底。任一成功即置位 `_registered`，不重复注册。

## 面板与开关怎么用

### 开关

在 dock-flash 快捷面板的「⚙️ 系统 → 系统告警」簇里找到 **网络监控**：

- 副标题实时显示 `已开启` / `已关闭`；
- 打开开关会写 `netAuditEnabled = true` 到宿主，宿主随即安装 fetch 追踪器；
- 关闭开关会**还原原始 `fetch`** 并释放监视器，所有记录停止。

**谁说了算**：`netAuditEnabled` 是 `volatile()`，DSH 每次重启都重置为 `false`；你真正的选择存在浏览器 `localStorage['dsh-flash-net-mon:monitor-network']`。加载时若两者不一致，**以 localStorage 为准并回写宿主** —— 这就是「重启后开关还是我上次开的样子」的原因。

### 配置弹窗

点开关右侧的「配置」打开网络监控配置弹窗，内含：

| 控件 | 范围 | 默认 |
| --- | --- | --- |
| 慢速阈值 `netSlowThreshold` | 1000–15000 ms，步长 500 | 5000 ms |
| 轮询基础间隔 `netPollBase` | 10000–120000 ms，步长 5000 | 60000 ms |
| 轮询最小间隔 `netPollMin` | 5000–30000 ms，步长 1000 | 10000 ms |
| 日志容量 `netLogCap` | 50–1000 条，步长 50 | 300 |
| 可疑阈值 `netSuspectWarn` | 10–90，步长 5 | 40 |
| 危险阈值 `netSuspectErr` | 20–100，步长 5 | 70 |

弹窗下方还有两块：可折叠的「**风险评分算法**」说明，以及内嵌的「**网络审计**」面板。

### 网络审计面板

三个子标签共用一份数据：面板每 `max(netPollMin, netPollBase)`（默认 60 秒）拉一次 `GET /network-log`（不带 `limit`，所以走服务端默认的 100 条、最新在前），随后所有筛选与分页都在浏览器里完成。

- **请求流** —— 每页 10 条，底部有页码信息与「上一页 / 下一页」。列：方法、主机、路径、状态（2xx 绿 / 4xx 黄 / 5xx 红）、风险、耗时；时间、请求/响应大小、TLS、插件、标记在点开行后的「详情」浮层里。
- **告警** —— 同一批数据里风险分 ≥ `netSuspectWarn` 的行，按风险着色（≥ `netSuspectErr` 为危险色）。这个标签页**不是**另一条数据流。
- **白名单** —— 在「主机」和「插件」两个视图间切换，用 ✕ 删条目；也可以用详情浮层里的「加主机白名单」「加插件白名单」一键加入。

工具栏：子标签切换、按插件筛选（选项来自当前已加载的条目）、按风险筛选（正常 / 可疑 / 危险）、**暂停 / 继续**（停掉轮询，但后端仍在记录，因此继续后会看到期间积累的条目）、**清空**（`DELETE /network-log`，清掉后端的环形缓冲与评分状态，而不只是清屏 —— 清空后「请求流」与「告警」都会变空）。自动滚动是内部行为：未暂停且开着自动滚动时，列表会跟到最新一页。

**告警通知走的是另一条路**：`dsh-flash-net-mon:network-audit` 提供者轮询 `GET /network-alerts`（间隔 `max(netPollMin, netPollBase)`），把新增的高风险请求推给 dock-flash 的告警注册表。它按 `seq` 去重，同一条不会重复弹出，还会跳过主机白名单 / 插件白名单里的命中项。

白名单写入走两路：内存里立即生效，同时通过 `ctx.remote.settings` 持久化到 `dsh-flash-net-mon` 命名空间。客户端与上面两条 `network-*-whitelist` 路由用的是同一份设置，所以哪边先写都会被后写的覆盖；设置服务不可用时，内存里的覆盖仍然生效。

## 风险评分算法

每次出站请求得到 0–100 的分数：

| 因素 | 加分 |
| --- | --- |
| 未知主机：既不在内置可信列表 / 用户主机白名单里，也不是可信插件发起的（基线分） | +30 |
| 首次访问该主机（`new-host`） | +15 |
| 大体积上传：`POST`/`PUT`/`PATCH` 且请求体 > 1 KB（`large-upload`） | +25 |
| 明文传输：非 `https:`（`plaintext`） | +20 |
| 高频访问：同一未知主机已出现 ≥ 3 次（`high-frequency`） | +15 |
| 上限 | 100 |

**可信就免检**：主机可信（内置可信列表 / 用户白名单）**或**插件可信时，风险分直接为 0，且不产生任何标记 —— 但请求**仍会记录**在请求流里。

内置可信主机：`www.google.com`（默认连通性测试目标）、`api.deepseek.com`、`chat.deepseek.com`。没有显式覆盖时 `HOST_ALLOW_UNKNOWN = false`，即**一切未列出的主机都从「可疑」起步**。

用户白名单里的**顶级域名覆盖其子域**（加入 `example.com` 即信任 `api.example.com`），与别处 `NO_PROXY` 的语义一致。

插件归属的解析顺序：`AsyncLocalStorage` 上下文（目前仅本包内部预留，等未来的 fork 钩子来填）→ 栈帧里的 `node_modules/<pkg>/` 提示 → `unknown`。**`unknown` 本身就是有意义的告警信号**（「有匿名代码在发数据」），不会被静默丢弃。⚠ 栈帧启发式是脆弱的（在打包器 shim 或运行时包装层之间调用会误判），只作为尽力而为的兜底。

## HTTP 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/plugins/dsh-flash-net-mon/network-log` | 分页快照，最新在前；`?offset=` `&limit=`（1–500，默认 100），返回 `{ entries, offset, limit, total }` |
| `DELETE` | `/plugins/dsh-flash-net-mon/network-log` | 清空监视器历史（环形缓冲 + 序号 + 主机频次） |
| `GET` | `/plugins/dsh-flash-net-mon/network-alerts` | 风险 ≥ `netSuspectWarn` 的请求，返回 `{ alerts }`（最新在前） |
| `POST` | `/plugins/dsh-flash-net-mon/network-whitelist` | 体 `{ "hosts": ["a.com", ...] }`，逐条校验为主机名（可带端口），写内存 + 持久化 |
| `POST` | `/plugins/dsh-flash-net-mon/network-plugin-whitelist` | 体 `{ "plugins": ["pkg-name", ...] }`，同上，按插件 ID |

行为要点：

- 请求体上限 4096 字节，超限/空/无法解析一律按「未提供覆盖」处理；
- 白名单路由是给**够不到设置服务的工具**准备的便利入口，客户端本身走 `ctx.remote.settings`；
- 审计关闭时这些路由**仍然注册**，只是返回空列表（此时不存在监视器实例），所以已经打开的面板不会 500；
- 心跳提供者轮询的 `/plugins/dock-flash/health` **属于 dock-flash**，不在这里（K6）。

## 心跳告警（网络监控）

- 目标 `/plugins/dock-flash/health`，10 秒 `AbortController` 超时；
- 延迟 > 9 秒 → 🔴「网络连接超时」；延迟 > `netSlowThreshold` → 🟡「网络延迟较高 (Nms)」；
- 连续失败 ≥ 3 次 → 🔴 超时告警；
- 下次间隔自适应：`max(netPollMin, round(netPollBase * (1 - 延迟/超时) ^ 1.5 + netPollMin))` —— 越接近超时，下一次探测越早。

## 依赖

| 包 | 类型 | 用途 |
| --- | --- | --- |
| `@deepseek-ai/cordis` | peer | 插件框架 |
| `dock-flash` `>=1.6.0-0 <2.0.0-0` | peer | 提供 `quickControl` 与 `dockFlashAlerts` 服务 |
| `dock-base` `>=0.1.2-0 <2.0.0-0` | peer，可选 | 仅工作台模式需要 |
| `@deepseek-ai/schemastery` | 直接依赖 | 设置 schema（`volatile()`） |

它**不硬依赖** dock-flash：服务全部通过 `ctx.get(...)` 解析，兼容性由 **peer 范围**声明 —— 与 dock-flash 对 dock-base 的做法一致。

## 安装

```sh
dsh plugin --profile <profile> add dsh-flash-net-mon
```

需要 **dock-flash ≥ 1.6**：它提供 `quickControl`、`dockFlashAlerts` 服务与 `dock-flash:ready` 事件，任何 2.x 都满足。安装后请重启 DSH。

`cordis.patch.yml` 只插入宿主行。注意它的 `name` 是**包名**，通过 profile 的 `node_modules` 解析，**绝不是相对路径**。

浏览器半不需要任何配置行：模块加载器从 `package.json` 的 `exports["./client"]` 加上 `dsh.client` 自动发现，并在 `/plugins/dsh-flash-net-mon/client.js` 提供它。

## 构建

```sh
pnpm install
pnpm run build       # tsc → dist/index.js   （只编译宿主半）
pnpm run typecheck
```

`dist/index.js` 是**故意入库的**，理由和 dock-flash 一样：git 安装只抓源码、不跑构建脚本，缺少 `dist/` 的仓库到手就少了 `main` 与 `exports["."]` 指向的宿主入口。`lib/client.js` 是直接手改的单文件，没有构建步骤，**刷新页面即生效**。

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

- **只记元数据**：方法、主机、路径、字节数、状态、耗时、TLS 与否、风险分、标记、时间。**从不读取请求/响应体，也从不记录请求头取值。** 响应对象原样返回给调用方。
- **不消费流**：请求体若是不透明流，字节数记为 0（宁可报 0 也不吞掉数据）；没有 `content-length` 时响应大小记为 `-1`；响应从未到达时同样为 `-1`、状态记为 0。
- **历史只在内存里**：环形缓冲上限 `netLogCap`，超出丢弃最旧的一条；进程重启即丢失 —— 网络审计记录是会话级数据，不是需要持久化的用户数据。
- **全局影响**：追踪器包装的是 `globalThis.fetch`（Node 18+ 的 undici fetch，`ctx.http` 与裸 `fetch()` 共用同一入口，所以一个包装即可覆盖两者）。关闭开关即还原；`__dockFlashTraced` 标记防止热重载/重复 `apply()` 造成的双重包装。
- **界面语言**：面板与告警文案自带中英文，跟随 DSH 的语言设置。
