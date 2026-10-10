# Changelog — dsh-flash-net-mon

Release-by-release history: what changed and, where it matters, why.
`git log` remains the authoritative record of individual commits — the entries
below summarise releases.

The **network monitor / outbound audit** companion for the core `dsh-flash`
package: a connectivity-heartbeat provider that polls the host's health endpoint
and turns "slow" / "timed out" into alerts, plus an **opt-in** fetch tracer that
grades each outbound request normal / suspect / dangerous and offers filtering
and whitelists. Auditing is off by default and resets to off on every restart.

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