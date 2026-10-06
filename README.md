# dsh-flash-net-mon

> The **network monitor / outbound audit** companion plugin for
> [dock-flash](https://gitee.com/lenin.guo/dock-flash) — it registers its own alert
> providers and its own panel switch instead of living inside dock-flash's `apply()`.

Version 0.1.0 · Apache-2.0

**[中文](./README.zh-CN.md)**

## What it does

Two capabilities, one in each half of the plugin:

1. **Network monitor (connectivity heartbeat)** — polls `/plugins/dock-flash/health`
   on a schedule and turns "slow" and "timed out" into dock-flash alerts.
2. **Outbound audit (fetch tracing)** — optionally wraps the global `fetch` and
   records a **metadata-level** list of outbound requests, grades each one
   normal / suspect / dangerous by risk score, and offers filtering, whitelists and
   an explanation of the scoring.

Auditing is **off by default** (`netAuditEnabled: false`, and the field is
`volatile()`, so every DSH restart returns it to that default).

## What it registers

### Host half — `src/index.ts` → `dist/index.js`

A Cordis plugin named `dsh-flash-net-mon`.

| Thing | Detail |
| --- | --- |
| Settings namespace | `dsh-flash-net-mon` |
| Fields | `netAuditEnabled`, `netLogCap`, `netSuspectWarn`, `netSuspectErr`, `netWhitelist`, `netPluginWhitelist`, `netSlowThreshold`, `netPollBase`, `netPollMin` |
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
`order: 60`, `icon: 'signal'`. Its **visibility follows dock-flash's
`dock-flash:system-alerts` master toggle** — with the alert registry switched off,
this switch has nothing to drive. Its subtitle carries the current on/off state, and
the plugin notifies the row to re-render when that state changes.

> **Dual discovery.** `ctx.get('quickControl')` / `ctx.get('dockFlashAlerts')` resolve
> asynchronously, so registration has three routes: listening for the
> `dock-flash:ready` event (for when dock-flash loads after us), a synchronous
> `ctx.get()` check (for when it loaded before us), and a short fallback poll — up to
> 15 attempts, 200 ms apart. The first one to succeed sets `_registered`, so nothing
> registers twice.

## Using the panel and the switch

### The switch

In dock-flash's quick panel, under **⚙️ System → System Alerts**, find **Network
Monitor**:

- the subtitle shows the live on/off state;
- turning it on writes `netAuditEnabled = true` to the host, and the host installs the
  fetch tracer;
- turning it off **restores the original `fetch`** and releases the monitor, so all
  recording stops.

**Who wins.** `netAuditEnabled` is `volatile()`: DSH resets it to `false` on every
restart. Your actual choice lives in the browser, at
`localStorage['dsh-flash-net-mon:monitor-network']`. When the two disagree on load,
**localStorage is authoritative and is written back to the host** — which is why the
switch is still where you left it after a restart.

### The config modal

The **Configure** button beside the switch opens the network monitor config modal:

| Control | Range | Default |
| --- | --- | --- |
| Slow threshold `netSlowThreshold` | 1000–15000 ms, step 500 | 5000 ms |
| Poll base interval `netPollBase` | 10000–120000 ms, step 5000 | 60000 ms |
| Poll minimum interval `netPollMin` | 5000–30000 ms, step 1000 | 10000 ms |
| Log capacity `netLogCap` | 50–1000 entries, step 50 | 300 |
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
  **details** overlay that opens when a row is expanded.
- **Alerts** — the rows of that same data whose risk is ≥ `netSuspectWarn`, coloured by
  risk (≥ `netSuspectErr` takes the danger colour). This tab is **not** a second data
  stream.
- **Whitelist** — switch between the host and plugin views, remove entries with ✕, or
  add one straight from the details overlay ("add host to whitelist" / "add plugin to
  whitelist").

Toolbar: sub-tab switch, plugin filter (options come from the currently loaded
entries), risk filter (normal / suspect / dangerous), **pause / resume** (stops polling
while the backend keeps recording, so resuming shows what accumulated), and **clear**
(`DELETE /network-log`, which clears the backend ring buffer and scoring state rather
than just the screen — afterwards both Requests and Alerts are empty). Auto-scroll is
internal: while not paused and auto-scroll is on, the list follows the newest page.

**Alert notifications take a different route.** The
`dsh-flash-net-mon:network-audit` provider polls `GET /network-alerts` (at the same
`max(netPollMin, netPollBase)` cadence) and pushes newly seen high-risk requests into
dock-flash's alert registry. It de-duplicates by `seq`, so the same request never
raises twice, and it skips anything matched by the host or plugin whitelist.

Whitelist writes go two ways: effective in memory immediately, and persisted through
`ctx.remote.settings` into the `dsh-flash-net-mon` namespace. The client and the two
`network-*-whitelist` routes use that same setting, so whichever writes second wins; if
the settings service is unavailable, the in-memory override still applies.

## Risk scoring

Every outbound request scores 0–100:

| Factor | Adds |
| --- | --- |
| Unknown host: not on the built-in trusted list / user host whitelist, and not from a trusted plugin (baseline) | +30 |
| First time this host is seen (`new-host`) | +15 |
| Large upload: `POST`/`PUT`/`PATCH` with a body over 1 KB (`large-upload`) | +25 |
| Plaintext: not `https:` (`plaintext`) | +20 |
| High frequency: the same unknown host seen ≥ 3 times (`high-frequency`) | +15 |
| Ceiling | 100 |

**Trusted means exempt.** If the host is trusted (built-in list or user whitelist)
**or** the plugin is trusted, the risk is 0 and no flags are raised — but the request
**is still recorded** in the request list.

Built-in trusted hosts: `www.google.com` (the default connectivity test target),
`api.deepseek.com`, `chat.deepseek.com`. Without an explicit override
`HOST_ALLOW_UNKNOWN = false`, i.e. **every unlisted host starts out suspect**.

A user whitelist entry covers **its subdomains** (adding `example.com` trusts
`api.example.com`), matching the semantics `NO_PROXY` uses elsewhere.

Plugin attribution resolves in this order: `AsyncLocalStorage` context (reserved for
this package's own use today, waiting for a future fork hook) → a `node_modules/<pkg>/`
hint in the stack frames → `unknown`. **`unknown` is itself a meaningful alert
signal** ("anonymous code is sending data") and is never silently dropped. ⚠ The
stack-frame heuristic is fragile (it misattributes when the call passes through a
bundler shim or a runtime wrapper); treat it as best effort.

## HTTP routes

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/plugins/dsh-flash-net-mon/network-log` | Paged snapshot, newest first; `?offset=` `&limit=` (1–500, default 100); returns `{ entries, offset, limit, total }` |
| `DELETE` | `/plugins/dsh-flash-net-mon/network-log` | Clears the monitor history (ring buffer + sequence + host frequency) |
| `GET` | `/plugins/dsh-flash-net-mon/network-alerts` | Requests with risk ≥ `netSuspectWarn`, returned as `{ alerts }`, newest first |
| `POST` | `/plugins/dsh-flash-net-mon/network-whitelist` | Body `{ "hosts": ["a.com", ...] }`, each validated as a host name (port allowed); writes memory + the setting |
| `POST` | `/plugins/dsh-flash-net-mon/network-plugin-whitelist` | Body `{ "plugins": ["pkg-name", ...] }`, same, keyed by plugin id |

Behaviour worth knowing:

- Request bodies are capped at 4096 bytes; over the cap, empty, or unparseable is
  treated as "no override supplied".
- The whitelist routes are a convenience for **tools that cannot reach the settings
  service**; the client itself goes through `ctx.remote.settings`.
- With auditing off these routes **stay registered** and answer empty lists (there is
  no monitor instance), so a panel that is already open never 500s.
- The `/plugins/dock-flash/health` route the heartbeat polls **belongs to dock-flash**,
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
| `dock-flash` `>=1.6.0-0 <2.0.0-0` | peer | supplies the `quickControl` and `dockFlashAlerts` services |
| `dock-base` `>=0.1.2-0 <2.0.0-0` | peer, optional | workbench mode only |
| `@deepseek-ai/schemastery` | dependency | the settings schema (`volatile()`) |

There is **no hard dependency** on dock-flash: every service is resolved through
`ctx.get(...)`, and compatibility is declared by the **peer range** — the same shape
dock-flash itself uses towards dock-base.

## Install

```sh
dsh plugin --profile <profile> add dsh-flash-net-mon
```

Requires **dock-flash ≥ 1.6** — it supplies the `quickControl` and
`dockFlashAlerts` services and the `dock-flash:ready` event, and any 2.x satisfies it.
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
```

`dist/index.js` is **tracked on purpose**, for the same reason dock-flash tracks its
own: a git install fetches sources and runs no build script, so a repository without
`dist/` would arrive missing the host entry point that `main` and `exports["."]` point
at. `lib/client.js` is a single file edited directly; it has no build step and takes
effect on page refresh.

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
  risk score, flags, timestamp. **Request and response bodies are never read, and
  header values are never recorded.** The response object is handed back to the caller
  untouched.
- **No stream consumption**: an opaque request body counts as 0 bytes (better to report
  0 than to swallow the data); a response with no `content-length` counts as `-1`, and a
  response that never arrived is `-1` bytes with status `0`.
- **History is memory-only**: a ring buffer capped by `netLogCap`, oldest dropped first,
  lost on restart — the audit log is session data, not user data that needs persisting.
- **Global reach**: the tracer wraps `globalThis.fetch` (Node 18+ undici; `ctx.http` and
  a bare `fetch()` share that entry point, so one wrapper covers both). Turning the
  switch off restores it, and the `__dockFlashTraced` mark prevents a double wrapper
  after a hot reload or a repeated `apply()`.
- **UI language**: the panel and the alert text carry both Chinese and English, and
  follow DSH's language setting.
