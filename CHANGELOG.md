# Changelog — dsh-flash-net-mon

Release-by-release history: what changed and, where it matters, why.
`git log` remains the authoritative record of individual commits — the entries
below summarise releases.

The **network monitor / outbound audit** companion for the core `dsh-flash`
package: a connectivity-heartbeat provider that polls the host's health endpoint
and turns "slow" / "timed out" into alerts, plus an **opt-in** fetch tracer that
grades each outbound request normal / suspect / dangerous and offers filtering
and whitelists. Auditing is off by default; once you turn it on it persists across
restarts (see the 0.3.0 note on the single-authority setting).

## 0.3.0

Everything since `v0.2.0`. It is a minor bump because the host gained a settings
field, the audit grades two new cases, and one settings route now rejects input it
used to accept — all observable from outside this package.

**A redirect to an untrusted host is now its own signal.** `fetch` follows redirects
silently, so a trusted target that bounced the payload somewhere else scored as the
target you asked for. The final host is read from undici's `res.url` after the
redirects settle; a different, untrusted host scores a flat **60** and carries a
`redirected-host` flag even when the original target was trusted. That is the
"trusted A, data went to B" case, and it used to be invisible. A row detail gained a
*redirect target* line.

**Streamed uploads are no longer measured as zero bytes.** An opaque or streamed
request body cannot be sized without consuming it, so it counted as `0` and a large
streamed upload never tripped `large-upload` (+25). The caller's explicit
`Content-Length` is now used as a fallback across the three shapes it arrives in
(`init.headers`, `Request` headers, plain object/array); with no header the body still
reports `0` rather than being swallowed.

**`new-host` is back to +15 — the score it had before 0.2.0 lowered it.** 0.2.0 cut it
to +5 because the seen-host counter lived in memory, so after every restart *every*
host looked new and 30 + 5 was enough to trip a warning on an innocent first contact.
The counter is now persisted, so "new" means genuinely new and the original +15 is
honest again — with one dependency worth naming: the persistence needs a data
directory, and where there is none the counter is still memory-only and a restart flags
everything new again. This reverses a documented 0.2.0 decision deliberately; the flag
itself was never removed.

**New setting: `netLogTtlSec`.** The audit log had a size cap (`netLogCap`) but no age
cap, so a quiet profile kept entries from weeks ago indefinitely. Entries older than the
window are now dropped — lazily, on the paths that actually read the buffer (`record`,
the snapshot and the alert feed) rather than on a timer. It defaults to **3600** seconds;
`0` turns time-based retention off and restores the old count-only ring-buffer
behaviour. This bounds the *log*; the seen-host frequency map has always had its own
fixed retention and is unaffected.

**The host-side setting is the single authority for the audit toggle.** The switch used
to keep a second copy in `localStorage['dsh-flash-net-mon:monitor-network']` and win on
disagreement, because `netAuditEnabled` was read as volatile and reset on restart. The
value now persists through DSH's settings namespace — the same mechanism the host
whitelist uses — and there is no browser copy left to reconcile. `volatile()` here only
means editable without remounting.

**Whitelist entries are strictly canonicalised, or refused with `400`.** Only a bare
`host[:port]` is accepted: an `http(s)://` prefix is stripped, the hostname is
lowercased, an explicit port must be an integer in `0–65535`, and anything carrying a
path, query, fragment or `user@` is rejected. The stored form is now byte-identical to
the `host` the scorer derives from a real URL, so "trust `example.com`" reliably
matches the real `example.com` — raw storage used to suppress nothing when a scheme or
path slipped in. Note for anyone calling `POST /network-whitelist` directly: input that
used to be accepted is now a `400`.

**Attribution stops guessing, and native `http`/`https` is traced too.** The plugin id
is resolved through the public `withPluginContext` / `AsyncLocalStorage` path instead of
being reconstructed from a stack scan after an `await`, when the caller's frames are
already gone; transparent HTTP/WS client libraries are skipped so the attribution lands
on the plugin, not on `undici`. Separately, the tracer now wraps `http.request` /
`https.request` as well as `fetch`, so WebSocket upgrades and non-`fetch` callers are
audited instead of being invisible.

**Audit state is per-`apply()` instead of module-level.** The monitor, the tracer
restore hooks and the trusted-endpoint list live in a per-instance runtime. A second
mount — a nested context or a remount — now owns its own state, so disposing one
instance can no longer tear out another's tracer or wipe its monitor.

**A missing host half is reported instead of polled silently.** The browser half is
served as soon as `exports["./client"]` resolves, so it can be live while the host half
is absent — a profile that gained this bundle after boot never mounts it, because
relinking a package needs a process restart. Every request hit a `404`, `r.json()`
rejected on the empty body, and an empty `catch` swallowed it: the panel showed an empty
stream, indistinguishable from a healthy idle host, while hammering a dead route every
few seconds forever. `r.ok` is now checked before parsing, only a `404` counts as a
miss (any status the server returned proves the route is mounted; a transport failure
stays neutral), and after 3 misses one shared verdict is published to both the provider
and the panel so they cannot disagree — with a red banner and a retry, an undismissible
`net-host-down` alert, one console line naming the cause, and a 60s backoff probe rather
than a stop.

**Packaging.** The `dock-base` optional peer and its `dsh.client.inject` hint are gone —
they survived the move to `dsh-flash` and nothing imports them any more. `@deepseek-ai/dsh-client-locale`
is added to `dsh.client.inject`, so its module is loaded before the browser half.

**i18n now reuses DSH's official internationalization framework.** The client half
used to run its own locale detection: read `<html lang>`, map it to `zh`/`en`, and
keep a `MutationObserver` on that attribute. `<html lang>` is not this plugin's
property — the client Cordis service `locale` (`@deepseek-ai/dsh-client-locale`)
owns the active-locale preference, the dictionary registry, the `locale/change`
event and that attribute. Watching it was a side channel: it could not see a switch
that had not reached the DOM yet, it fired for a value nobody had chosen, and —
because it only mutated a module variable — it repainted nothing. The tables are now
registered with the service under the `dsh-flash-net-mon` namespace and every read
goes through it, with the eager `ctx.get('locale')` claim paired to a
`ctx.inject(['locale'])` watcher for the case where the service is provided after
this module; a transient miss never tears down a working registration, and the
fallback stays the browser language on the primary subtag. The claim is released on
plugin dispose because `register()` refuses a repeat locale under one namespace.
Since `t()` only became a *live* read, the surfaces drawn outside a React render get
an explicit nudge on a language switch: the Quick Control row through
`registry.notifyChange()`, the alert feed through `alerts.notify()`, and the open
config modal through its own `t.onLocaleChange()` subscription. This plugin never
writes the locale — the Language settings row belongs to `dsh-flash` — and
`@deepseek-ai/dsh-client-locale` is now listed in `dsh.client.inject`, so its module
is loaded before this one. Making `t()` a live read also exposed one frozen string:
an audit alert resolved its risk-flag labels when the alert was *emitted*, so after
a language switch the alert showed a new-language title over an old-language flag
list. The flags are now resolved inside the `message` function, like the rest of it.

**The install policy stops being silently reversible.** `dsh-flash` is an *optional*
peer so the fetcher tracer never pulls a panel dependency it does not import, and
`.npmrc` guarded that with `auto-install-peers=false`. pnpm 12 ignores that key once
a `pnpm-workspace.yaml` exists — and it runs an install before *every* command, so
`pnpm typecheck` alone rewrote the lockfile to `autoInstallPeers: true` and resolved
`dsh-flash` as a real peer: a dependency change hiding inside a type check. `pnpm
install --frozen-lockfile`, the CI path, failed outright on the mismatch. The
settings now live in `pnpm-workspace.yaml`, which is what pnpm 12 reads, and are kept
in `.npmrc` too because pnpm ≤ 10 reads only that file. `test/install-policy.test.ts`
asserts both files and the lockfile agree, so the drift fails a test instead of
landing in a commit.

## 0.2.0

**First-contact noise cut; the audit trusts the endpoints DSH is configured to
call.** The outbound tracer stopped flagging the requests DSH makes by design — a
user who configured a given endpoint no longer sees it graded "suspect" on every
boot. This is the first minor bump (new audit behavior, not just a fix), and the
first net-mon row not tied to the single-package-era peer.

## 0.1.4

**Follows the panel core to `dsh-flash`.** First release after the core/adapter
split: the `dsh-flash` peer range is the one the combined package now demands
(`>=1.0.0-0 <2.0.0-0`), pairing with the standalone core like the other
companions. Behavior unchanged.

## 0.1.3

**Market + repository identity.** The `repository` field pointing at this
repository and a real install command, so the market resolves this plugin's npm
name and the card can be installed from the storefront.

## 0.1.2

**Peer range fixed.** Accept the `dock-flash` 2.x line that the combined package
published at the time, so installs against the single-package era resolve.

## 0.1.1

**Hardening + audit readibility.** A failed `apply()` is non-fatal instead of a
vanished plugin; the preference read no longer assumes `settings.describe()`
returns a promise (see Critical Rule 13 in the core's AGENTS.md). On the audit
side: a request's detail opens inline instead of covering the screen, the
attribution resolves the full scoped package name and keeps the caller's stack
intact across the `await`, the table exposes a `pluginId` column, and the
audit/net panel colors move to the light-theme tokens.

## 0.1.0

**First tagged release** — the extracted companion standing up on its own. Ships
the connectivity-heartbeat provider and the opt-in outbound audit, with
`dock-base` declared an optional peer and `autoInstallPeers` disabled so the
fetcher tracer does not pull a dock dependency it does not use. The Gitee→GitHub
mirror is bootstrapped and the Chinese README verified section-for-section
against the English one.