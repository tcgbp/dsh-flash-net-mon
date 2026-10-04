# dsh-flash-net-mon

Network monitor, outbound audit and network-alert provider for
[dock-flash](https://gitee.com/lenin.guo/dock-flash) — a companion plugin that
registers its own alert providers and its own panel switch rather than living
inside dock-flash's `apply()`.

Version 0.1.0 · Apache-2.0

## What it registers

**Host half** — `src/index.ts` → `dist/index.js`, a Cordis plugin named
`dsh-flash-net-mon`.

| Thing | Detail |
|---|---|
| Settings namespace | `dsh-flash-net-mon` |
| Fields | `netAuditEnabled`, `netLogCap`, `netSuspectWarn`, `netSuspectErr`, `netWhitelist`, `netPluginWhitelist`, `netSlowThreshold`, `netPollBase`, `netPollMin` |
| Routes | `/plugins/dsh-flash-net-mon/network-log`, `/network-alerts`, `/network-whitelist`, `/network-plugin-whitelist` |

**Browser half** — `lib/client.js`, no build step.

| Registration | Through |
|---|---|
| Alert provider `dsh-flash-net-mon:network-alert` | `ctx.get('dockFlashAlerts').registerProvider()` |
| Alert provider `dsh-flash-net-mon:network-audit` | `ctx.get('dockFlashAlerts').registerProvider()` |
| Panel switch `dsh-flash-net-mon:monitor-network` | `ctx.get('quickControl').registerSwitch()` |

The fetch tracer is **opt-in**: `fetch` is wrapped only while `netAuditEnabled` is
true, and toggling that off restores the original `fetch` and stops all recording.
While it is off the routes above stay registered and answer empty lists, so a panel
that is already open never breaks.

## Requirements

| Package | Type | Why |
|---|---|---|
| `@deepseek-ai/cordis` | peer | the plugin framework |
| `dock-flash` `>=1.6.0-0 <2.0.0-0` | peer | supplies the `quickControl` and `dockFlashAlerts` services |
| `dock-base` `>=0.1.2-0 <2.0.0-0` | peer, optional | workbench mode only |

There is no hard dependency on dock-flash: the services are resolved through
`ctx.get(...)`, and the **peer range** is what states compatibility — the same shape
dock-flash itself uses towards dock-base.

## Install

```sh
dsh plugin --profile <profile> add <path-to-this-checkout>
```

`cordis.patch.yml` inserts the host row. Its `name` is a **package name**, resolved
through the profile's `node_modules` — never a relative path. The browser half needs
no row: the module loader discovers it from `package.json`'s `exports["./client"]`
plus `dsh.client` and serves it at `/plugins/dsh-flash-net-mon/client.js`.

## Build

```sh
pnpm install
pnpm run build       # tsc → dist/index.js   (host half only)
pnpm run typecheck
```

`dist/index.js` is **tracked on purpose**, for the same reason dock-flash tracks
its own: a git install fetches sources and runs no build script, so a repository
without `dist/` would arrive missing the host entry point that `main` and
`exports["."]` point at. `lib/client.js` is a single file edited directly; it has no
build step and takes effect on page refresh.

## Layout

```
src/index.ts       HOST half      → tsc → dist/index.js
lib/client.js      BROWSER half   → no build, edited directly
dist/index.js      compiled host half — tracked on purpose
cordis.patch.yml   bundle layer: inserts the host row into the profile
```
