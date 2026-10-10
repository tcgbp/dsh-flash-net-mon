# dsh-flash-net-mon

> The **network monitor / outbound audit** companion plugin for
> [dsh-flash](https://gitee.com/lenin.guo/dsh-flash) — it registers its own alert
> providers and its own panel switch instead of living inside dsh-flash's `apply()`.

Version 0.1.0 · Apache-2.0

**[中文](./README.zh-CN.md)**

## What it does

Two capabilities, one in each half of the plugin:

1. **Network monitor (connectivity heartbeat)** — polls `/plugins/dock-flash/health`
   on a schedule and turns "slow" and "timed out" into dsh-flash alerts.
2. **Outbound audit (fetch tracing)** — optionally wraps the global `fetch` and
   records a **metadata-level** list of outbound requests, grades each one
   normal / suspect / dangerous by risk score, and offers filtering, whitelists and
   an explanation of the scoring.

Auditing is **off by default** (`netAuditEnabled: false`). The setting is
`volatile()` only in the Cordis sense (live-editable without remounting); once you
turn the switch on, the value is persisted through DSH's settings namespace and
survives restarts, exactly like the host whitelist.

## What it registers

### Host half — `src/index.ts` → `dist/index.js`

A Cordis plugin named `dsh-flash-net-mon`.

| Thing | Detail |
| --- | --- |
| Settings namespace | `dsh-flash-net-mon` |
| Fields | `netAuditEnabled`, `netLogCap`, `netLogTtlSec`, `netSuspectWarn`, `netSuspectErr`, `netWhitelist`, `netPluginWhitelist`, `netSlowThreshold`, `netPollBase`, `netPollMin` |
| Routes | `/plugins/dsh-flash-net-mon/network-log`, `/network-alerts`, `/network-whitelist`, `/network-plugin-whitelist` |

The host half has **no host-side service dependency** (`inject: []`): everything is
injected lazily — `settings` for preferences, `webServer` for the routes.

### Browser half — `lib/client.js` (no build step)

| Registration | Through |
| --- | --- |
| Alert provider `dsh-flash-net-mon:network-alert` (heartbeat) | `ctx.get('dockFlashAlerts').registerProvider()` |
| Alert provider `dsh-flash-net-mon:network-audit` (audit alerts) | `ctx.get('dockFlashAlerts').registerProvider()` |
| Panel switch `dsh-flash-net-mon:monitor-network` | `ctx.get('quickControl').registerSwitch()` |

Switch properties: `type: 'toggle'`, `group: 'system'`, `cluster: 'system-alerts'`,
`order: 60`, `icon: 'signal'`. Its **visibility follows dsh-flash's
`dock-flash:system-alerts` master toggle** — with the alert registry switched off,
this switch has nothing to drive. Its subtitle carries the current on/off state, and
the plugin notifies the row to re-render when that state changes.

> **Dual discovery.** `ctx.get('quickControl')` / `ctx.get('dockFlashAlerts')` resolve
> asynchronously, so registration has three routes: listening for the
> `dock-flash:ready` event (for when dsh-flash loads after us), a synchronous
> `ctx.get()` check (for when it loaded before us), and a short fallback poll — up to
> 15 attempts, 200 ms apart. The first one to succeed sets `_registered`, so nothing
> registers twice.

## Using the panel and the switch

### The switch

In dsh-flash's quick panel, under **⚙️ System → System Alerts**, find **Network
Monitor**:

- the subtitle shows the live on/off state;
- turning it on writes `netAuditEnabled = true` to the host, and the host installs the
  fetch tracer;
- turning it off **restores the original `fetch`** and releases the monitor, so all
  recording stops.

**Single authority.** The host-side `netAuditEnabled` setting is the one source of
truth for whether the monitor is on. It is written through DSH's settings namespace
(the same durable mechanism that persists the host whitelist), so it survives restart
— `volatile()` here only means the field is editable at runtime without remounting, not
that DSH forgets it. The switch reads that persisted value and writes back through the
settings bridge; there is no separate localStorage copy to reconcile, so the toggle is
exactly where you left it after a restart and can never silently fork from the host.

### The config modal

The **Configure** button beside the switch opens the network monitor config modal:

| Control | Range | Default |
| --- | --- | --- |
| Slow threshold `netSlowThreshold` | 1000–15000 ms, step 500 | 5000 ms |
| Poll base interval `netPollBase` | 10000–120000 ms, step 5000 | 60000 ms |
| Poll minimum interval `netPollMin` | 5000–30000 ms, step 1000 | 10000 ms |
| Log capacity `netLogCap` | 50–1000 entries, step 50 | 300 |
| Retention `netLogTtlSec` | 0–120 min, step 5 (0 = keep forever) | 60 min |
| Suspect threshold `netSuspectWarn` | 10–90, step 5 | 40 |
| Danger threshold `netSuspectErr` | 20–100, step 5 | 70 |

Below those, two more blocks: a foldable **risk scoring algorithm** explanation, and
the embedded **network audit** panel.

### The network audit panel

All three sub-tabs share one data source: the panel fetches `GET /network-log` every
`max(netPollMin, netPollBase)` (60 s by default) **without `limit`**, so it takes the
server's default of 100 entries, newest first — after that, every filter and page turn
happens in the browser.

- **Requests** — 10 rows per page, with page info and previous/next at the bottom.
  Columns: method, host, path, status (2xx green / 4xx yellow / 5xx red), risk,
  duration; time, request/response sizes, TLS, plugin and flags live in the
  **details** block that expands **inline** when a row is clicked (click the same row
  again or press Escape to collapse it; the rest of the modal stays visible).
- **Alerts** — the rows of that same data whose risk is ≥ `netSuspectWarn`, coloured by
  risk (≥ `netSuspectErr` takes the danger colour). This tab is **not** a second data
  stream.
- **Whitelist** — switch between the host and plugin views, remove entries with ✕. The
  host view also has "common services (one click)" chips and a **read-only**
  "auto-trusted" row; the plugin view lists the plugins seen in the log (click Trust to
  add one) plus a manual input. The details block still offers "add host to whitelist" /
  "add plugin to whitelist".

Toolbar: sub-tab switch, plugin filter (options come from the currently loaded
entries), risk filter (normal / suspect / dangerous), **pause / resume** (stops polling
while the backend keeps recording, so resuming shows what accumulated), and **clear**
(`DELETE /network-log`, which clears the backend ring buffer and scoring state rather
than just the screen — afterwards both Requests and Alerts are empty). Auto-scroll is
internal: while not paused and auto-scroll is on, the list follows the newest page.

**Alert notifications take a different route.** The
`dsh-flash-net-mon:network-audit` provider polls `GET /network-alerts` (at the same
`max(netPollMin, netPollBase)` cadence) and pushes newly seen high-risk requests into
dsh-flash's alert registry. It de-duplicates by `seq`, so the same request never
raises twice, and it skips anything matched by the host or plugin whitelist.

Whitelist writes go two ways: effective in memory immediately, and persisted through
`ctx.remote.settings` into the `dsh-flash-net-mon` namespace. The client and the two
`network-*-whitelist` routes use that same setting, so whichever writes second wins; if
the settings service is unavailable, the in-memory override still applies.

"Common services (one click)" offers 15 known API hosts (exact host names such as
`api.openai.com` or `dashscope.aliyuncs.com`); one click adds that host to the user's
whitelist. Anything already covered is greyed out and tagged with where the coverage
comes from ("added", "built-in", or "configured endpoint"). The list deliberately
contains **no host that serves user content** (`github.io`, `raw.githubusercontent.com`,
`*.s3.amazonaws.com`, `*.cloudfront.net`, …) — trusting one of those would open the audit
to every third-party payload fetched through it. It is a set of buttons, never an
automatic write.

## Risk scoring

Every outbound request scores 0–100:

| Factor | Adds |
| --- | --- |
| Unknown host: not on the built-in trusted list / user host whitelist, and not from a trusted plugin (baseline) | +30 |
| First time this host is seen (`new-host`) | +15 |
| Large upload: `POST`/`PUT`/`PATCH` with a body over 1 KB (`large-upload`) | +25 |
| Plaintext: not `https:` (`plaintext`) | +20 |
| High frequency: the same unknown host seen ≥ 3 times (`high-frequency`) | +15 |
| Redirected to a different, untrusted host (`redirected-host`) | 60 flat |
| Ceiling | 100 |

`redirected-host` is a **flat 60**, not an additive +. It fires when the initial
target and the response's final host differ AND the final host is not trusted —
even when the original host was trusted. You declared `A` trusted, but the data
actually went to `B`; that is exactly the redirect-based exfiltration case the
audit exists to catch. A benign redirect (same host, or a final host that is also
trusted) raises nothing. Note the final host comes from the SDK's `res.url` after
following redirects, so a bare `302` followed by a non-HTTP client API won't be
caught — only what Node's fetch follows.

Unlike `redirected-host`, `new-host` is additive. It is +15, not +5, because the
seen-host frequency is now **persisted** (see "Seen-host frequency persistence"
below): a host seen before a restart is *not* flagged new anymore, so a genuine
first contact is the *rare* case worth a warning by itself — 30 + 15 = 45 crosses
`netSuspectWarn` (40 by default). A first contact that also uploads or is
plaintext scores 70 / 65. Without a writable data dir the store degrades to
memory-only and every host reads as new again after a restart (`new-host` then
fires on first contact each session, same flag, same margin — just less precise).

A URL that names no host (a relative one, e.g. `/x`) is not scored at all: it records 0
with a `relative-url` flag and stays in the log, and it is kept **out** of the host
frequency counter — otherwise every relative URL would pile onto the same `?` key and no
whitelist entry could ever match it.

## Seen-host frequency persistence

The `host → {count, lastSeen}` table that drives both `new-host` and `high-frequency`
is the **only** thing written to disk. It lives at
`<DSH data dir>/dsh-flash-net-mon/seen-hosts.json`, where the data dir is DSH's
`baseDir`. When DSH does not expose a `baseDir` (or the directory is unwritable) the
plugin degrades gracefully to memory-only — the original behaviour.

Concretely:

- **Restart-safe `new-host`**: a host seen before a restart is not flagged `new-host` again.
  Only a genuinely new host is, restoring `new-host` to +15's intended rarity.
- **Retention**: entries not seen in the last 6 hours are dropped on load and on each
  new observation, and the table is capped at 500 hosts (least-recently-seen evicted), so
  the file reflects recent traffic and never grows unbounded.
- **Private**: host names only (they were already recorded in the audit log). No path,
  body, or header data is persisted. Writes are debounced (~2.5 s) and flushed on
  audit-off / context dispose; the clear endpoint resets the on-disk table too.

**Trusted means exempt.** If the host is trusted (built-in list, user whitelist, or an
auto-trusted endpoint) **or** the plugin is trusted, the risk is 0 and no flags are
raised — the request **is still recorded** in the request list. The one exception is a
redirect to a different, untrusted host, which still scores 60 (`redirected-host`)
regardless of how trusted the origin was.

Built-in trusted hosts: `www.google.com` (the default connectivity test target),
`api.deepseek.com`, `chat.deepseek.com`. Without an explicit override
`HOST_ALLOW_UNKNOWN = false`, i.e. **every unlisted host starts out suspect**.

Beyond that hard-coded list, the endpoints **DSH itself is configured to call** are
trusted too: any field named `baseURL`/`base_url`/`apiBase`/`api_base`/`endpoint` in what
`settings.describe()` returns (an LLM provider's `baseURL`, including the per-model
nesting `dsh-llm-pi-ai` uses), plus the `DEEPSEEK_BASE_URL` / `OPENAI_BASE_URL` /
`ANTHROPIC_BASE_URL` environment variables. This trust is **never** written into the
user's whitelist (a declaration the user made must stay distinguishable from what we
inferred), and it matches **exactly**: pointing a provider at `gw.example.com:8443` does
not trust `sub.gw.example.com`, and an `http://` endpoint is only accepted on loopback
(`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`). It is recomputed whenever settings
change, so removing a provider removes the trust. The whitelist tab's read-only
"auto-trusted" row shows exactly which hosts are in force.

A user whitelist entry covers **its subdomains** (adding `example.com` trusts
`api.example.com`), matching the semantics `NO_PROXY` uses elsewhere.

Entries are strictly canonicalised before being stored (and before persisting via the
settings service). Only a bare `host[:port]` is accepted: an optional `http(s)://`
prefix is stripped, hostname is lowercased, an explicit port must be an integer in
`0–65535`, and anything carrying a path, query, fragment or `user@` info is rejected.
The stored form is exactly the `host` value the scorer derives from a real outbound URL,
so "trust `example.com`" reliably matches the real `example.com` — earlier versions
stored the raw input, which silently failed to suppress alerts when a scheme/path/port
mismatch slipped in. Malformed input is refused with `400` instead of being trusted on
the user's behalf.

Plugin attribution resolves in this order: `AsyncLocalStorage` context (seeded by any
plugin) → a `node_modules/<pkg>/` hint in the stack frames → `unknown`. **`unknown` is
itself a meaningful alert signal** ("anonymous code is sending data") and is never
silently dropped. ⚠ The stack-frame heuristic is fragile (it misattributes when the call
passes through a bundler shim or a runtime wrapper); treat it as best effort.

A DSH plugin that wants its own outbound calls attributed precisely wraps them in
`withPluginContext(pluginId, fn)`:

```ts
import { withPluginContext } from 'dsh-flash-net-mon'
withPluginContext('my-plugin', () => { /* fetch() / http.request() here are 'my-plugin' */ })
```

The async context survives `await` (async_hooks), so even a resumed callback keeps its
identity. Outside any context the auditor falls back to the stack heuristic, then
`unknown`.

## HTTP routes

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/plugins/dsh-flash-net-mon/network-log` | Paged snapshot, newest first; `?offset=` `&limit=` (1–500, default 100); returns `{ entries, offset, limit, total }` |
| `DELETE` | `/plugins/dsh-flash-net-mon/network-log` | Clears the monitor history (ring buffer + sequence + host frequency) |
| `GET` | `/plugins/dsh-flash-net-mon/network-alerts` | Requests with risk ≥ `netSuspectWarn`, returned as `{ alerts }`, newest first |
| `GET` | `/plugins/dsh-flash-net-mon/network-whitelist` | Read-only view, returns `{ hosts, builtin, endpoints }`: the user list, the built-in trusted hosts, and the endpoints derived from DSH's configuration |
| `POST` | `/plugins/dsh-flash-net-mon/network-whitelist` | Body `{ "hosts": ["a.com", ...] }`, each validated as a host name (port allowed); writes memory + the setting |
| `POST` | `/plugins/dsh-flash-net-mon/network-plugin-whitelist` | Body `{ "plugins": ["pkg-name", ...] }`, same, keyed by plugin id |

Behaviour worth knowing:

- Request bodies are capped at 4096 bytes; over the cap, empty, or unparseable is
  treated as "no override supplied".
- The whitelist routes are a convenience for **tools that cannot reach the settings
  service**; the client itself goes through `ctx.remote.settings`.
- With auditing off these routes **stay registered** and answer empty lists (there is
  no monitor instance), so a panel that is already open never 500s.
- The `/plugins/dock-flash/health` route the heartbeat polls **belongs to dsh-flash**,
  not to this package.

## Heartbeat alerts (network monitor)

- Target `/plugins/dock-flash/health`, with a 10 s `AbortController` timeout;
- latency > 9 s → 🔴 "network timeout"; latency > `netSlowThreshold` → 🟡 "network
  latency high (N ms)";
- 3 consecutive failures → 🔴 timeout alert;
- the next interval adapts:
  `max(netPollMin, round(netPollBase * (1 - latency/timeout) ^ 1.5 + netPollMin))` —
  the closer a poll comes to timing out, the sooner the next one runs.

## Dependencies

| Package | Type | Purpose |
| --- | --- | --- |
| `@deepseek-ai/cordis` | peer | the plugin framework |
| `dsh-flash` `>=1.0.0-0 <2.0.0-0` | peer | supplies the `quickControl` and `dockFlashAlerts` services |
| `dock-base` `>=0.1.2-0 <2.0.0-0` | peer, optional | workbench mode only |
| `@deepseek-ai/schemastery` | dependency | the settings schema (`volatile()`) |

There is **no hard dependency** on dsh-flash: every service is resolved through
`ctx.get(...)`, and compatibility is declared by the **peer range** — the same shape
`dock-flash` (the v3 dock-base adapter) uses towards `dock-base`.

## Install

```sh
dsh plugin --profile <profile> add dsh-flash-net-mon
```

Requires **dsh-flash ≥ 1.0** — it supplies the `quickControl` and
`dockFlashAlerts` services and the `dock-flash:ready` event, and any 1.x satisfies it.
The dock-base workbench UI comes from the `dock-flash` v3 adapter, which mounts the
core's panel into the workbench.
Restart DSH after installing.

`cordis.patch.yml` inserts the host row. Its `name` is a **package name**, resolved
through the profile's `node_modules` — **never a relative path**.

The browser half needs no row: the module loader discovers it from `package.json`'s
`exports["./client"]` plus `dsh.client` and serves it at
`/plugins/dsh-flash-net-mon/client.js`.

## Build

```sh
pnpm install
pnpm run build       # tsc → dist/index.js   (host half only)
pnpm run typecheck
pnpm test            # build + unit tests (node:test, no framework dep)
```

`dist/index.js` is **tracked on purpose**, for the same reason dock-flash tracks its
own: a git install fetches sources and runs no build script, so a repository without
`dist/` would arrive missing the host entry point that `main` and `exports["."]` point
at. `lib/client.js` is a single file edited directly; it has no build step and takes
effect on page refresh.

The unit tests in `test/` import the **compiled** `dist/index.js` (not the `.ts`
source) because Node's strip-only TS mode cannot parse the parameter property in
`src/index.ts`. Run `pnpm build` before editing/rerunning: `pnpm test` builds first.

## Layout

```
src/index.ts          HOST half      → tsc → dist/index.js
lib/client.js         BROWSER half   → no build, edited directly
dist/index.js         compiled host half — tracked on purpose
cordis.patch.yml      bundle layer: inserts the host row into the profile
.github/workflows/    sync-from-gitee.yml — the Gitee → GitHub mirror
docs/releasing.md     mirror bootstrap, release runbook, dsh-market listing
docs/tcgbp__dsh-flash-net-mon.yml   the dsh-market submission entry to PR
```

Gitee is the authoritative repository and the only remote configured; GitHub
(`github.com/tcgbp/dsh-flash-net-mon`) is a mirror of it and the host of the release
tarball the dsh-market entry points at.

## Privacy and limits (deliberate)

- **Metadata only**: method, host, path, byte counts, status, duration, TLS or not,
  risk score, flags, timestamp, and the final host after a redirect (when it differs
  from the initial target). **Request and response bodies are never read, and
  header values are never recorded.** The response object is handed back to the caller
  untouched.
- **No stream consumption**: an opaque request body (a stream) still reports its size
  when the caller set an explicit `Content-Length` header — so a large streamed upload
  is no longer invisible to `large-upload`. Without that header it counts as 0 bytes
  (better to report 0 than to swallow the stream); a response with no `content-length`
  counts as `-1`, and a response that never arrived is `-1` bytes with status `0`.
- **History is memory-only**: a ring buffer capped by `netLogCap`, oldest dropped first.
  A second eviction axis — `netLogTtlSec` (default 60 min, 0 = off) — sheds entries older
  than the window even when the buffer is not full, so a long-running session does not keep
  stale logs forever. On `record`/`snapshot`/`alerts` the next call lazily prunes the front;
  the audit log stays session data, lost on restart — not user data that needs persisting.
  The one exception is the **seen-host frequency** (host → count + last-seen), which is
  persisted so `new-host` stays precise across restarts (see "Seen-host frequency
  persistence" below). No request log entry is ever written to disk.
- **Global reach**: the tracer wraps `globalThis.fetch` (Node 18+ undici; `ctx.http` and
  a bare `fetch()` share that entry point) **and** Node's native `http.request` /
  `https.request` (the path a plugin uses when it talks HTTP directly instead of through
  fetch). A WebSocket is opened with a first HTTP Upgrade request, so `ws`-style
  connections are captured as an Upgrade entry too. Turning the switch off restores all
  three entries and the `__dockFlashTraced` mark prevents a double wrapper after a hot
  reload or a repeated `apply()`. Neither wrapper reads or mutates request/response
  bodies — only metadata.
- **UI language**: the panel and the alert text carry both Chinese and English, and
  follow DSH's language setting.
