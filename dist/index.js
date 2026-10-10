import nodeHttp from 'node:http';
import nodeHttps from 'node:https';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// Default export only (`export default Schema`); there is no named `Schema`.
import Schema from '@deepseek-ai/schemastery';
export const name = 'dsh-flash-net-mon';
// No host-side service dependencies; all services are injected lazily.
export const inject = [];
/** Network Monitor defaults — mirrored from dock-flash src/index.ts. */
const DEFAULT_NET_SLOW_THRESHOLD = 5000;
const DEFAULT_NET_POLL_BASE = 60000;
const DEFAULT_NET_POLL_MIN = 10000;
const DEFAULT_NET_LOG_CAP = 300;
const DEFAULT_NET_SUSPECT_WARN = 40;
const DEFAULT_NET_SUSPECT_ERR = 70;
const DEFAULT_NET_AUDIT_ENABLED = false;
/** #6: expire audited entries older than this (in seconds) when they would not
 *  otherwise be shed by the ring buffer. 0 disables time-based eviction, so a
 *  session only ever drops by count (the historical behaviour). */
const DEFAULT_NET_LOG_TTL_SEC = 3600;
export const Config = Schema.object({
    netAuditEnabled: Schema.boolean().default(DEFAULT_NET_AUDIT_ENABLED).volatile(),
    netLogCap: Schema.number().default(DEFAULT_NET_LOG_CAP).volatile(),
    netSuspectWarn: Schema.number().default(DEFAULT_NET_SUSPECT_WARN).volatile(),
    netSuspectErr: Schema.number().default(DEFAULT_NET_SUSPECT_ERR).volatile(),
    netWhitelist: Schema.array(String).default([]).volatile(),
    netPluginWhitelist: Schema.array(String).default([]).volatile(),
    netSlowThreshold: Schema.number().default(DEFAULT_NET_SLOW_THRESHOLD).volatile(),
    netPollBase: Schema.number().default(DEFAULT_NET_POLL_BASE).volatile(),
    netPollMin: Schema.number().default(DEFAULT_NET_POLL_MIN).volatile(),
    netLogTtlSec: Schema.number().default(DEFAULT_NET_LOG_TTL_SEC).volatile(),
});
// ── Private types & helpers ──────────────────────────────────────────────
/**
 * AsyncLocalStorage for propagating the caller's plugin identity through
 * the fetch wrapper. Currently private to this package — a future fork-hook
 * could adopt it without restructuring.
 */
const _requestContext = new AsyncLocalStorage();
const _UNKNOWN_PLUGIN = 'unknown';
/**
 * Resolve which plugin initiated a request.
 *
 * Priority: AsyncLocalStorage context (populated only if a future fork-hook
 * calls `_requestContext.run(...)`) → stack-trace hint → `unknown`. `unknown`
 * is itself a meaningful, alarming signal ("something anonymous is sending
 * data"), never a silent discard.
 *
 * ⚠ The stack-trace heuristic is fragile — it walks Error().stack looking
 * for `node_modules/<pkg>/` frames. It misattributes when called from inside
 * a bundler shim or a runtime wrapper that sits between the real caller and
 * us. It is kept as a best-effort fallback only.
 */
function resolvePluginId() {
    const store = _requestContext.getStore();
    if (store && store.pluginId)
        return store.pluginId;
    const hint = _pluginIdFromStack();
    return hint || _UNKNOWN_PLUGIN;
}
/** Extract `<pkg>` from the first `node_modules/<pkg>/` stack frame, if any. */
function _pluginIdFromStack() {
    let stack;
    try {
        stack = new Error().stack || '';
    }
    catch (_) {
        return null;
    }
    // Capture the full package path segment after `node_modules/`, handling
    // scoped packages: a plain package is `foo`, a scoped one is `@scope/name`
    // (its on-disk layout is `node_modules/@scope/name/...`). Group 1 therefore
    // is the whole package id — e.g. `@michengai/dsh-archive-manager`. Without
    // the scope branch we would stop at the first `/` and attribute traffic to
    // just the scope (`@michengai`) instead of the real bundle.
    const re = /node_modules[\\/]+((?:@[^\\/]+[\\/]+)?[^\\/]+)/g;
    let m;
    // Walk every frame, preferring the outermost (caller-most) plugin path, i.e.
    // the last match that is a real package rather than a loader shim.
    let candidate = null;
    while ((m = re.exec(stack)) !== null) {
        const pkg = m[1];
        // Skip the common well-known loader/runtime names that sit between the real
        // caller and us, so we attribute to the plugin that actually issued the call.
        if (/^(@deepseek-ai|cordis|undici|node:|internal)/i.test(pkg))
            continue;
        // Also skip an isolated scope dir (e.g. `node_modules/@scope/` with no
        // package under it, which can appear in some install layouts) — there is
        // no real package to attribute the request to yet.
        if (/^@[^\\/]+[\\/]?$/.test(pkg))
            continue;
        candidate = pkg;
    }
    return candidate;
}
/** Built-in hosts considered trustworthy — anything else starts suspect. */
const BUILTIN_TRUSTED_HOSTS = new Set([
    'www.google.com', // default connectivity test target
    'api.deepseek.com', // DSH API
    'chat.deepseek.com', // DSH API
]);
/** Default guard: without an explicit override every host is suspect. */
const HOST_ALLOW_UNKNOWN = false;
/**
 * Field names that carry an API endpoint in a provider's settings. Matched
 * case-insensitively against the keys of every namespace `settings.describe()`
 * returns: DSH's own providers name the field `baseURL` (dsh-llm-deepseek,
 * dsh-llm-pi-ai, …) and a user-configured gateway uses the same key.
 */
const ENDPOINT_FIELD_NAMES = new Set(['baseurl', 'base_url', 'apibase', 'api_base', 'endpoint']);
/** Environment fallbacks for the same endpoints — the SDKs' own conventions. */
const ENDPOINT_ENV_VARS = ['DEEPSEEK_BASE_URL', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL'];
/** Loopback names: an `http://` endpoint there is this machine, not the network. */
function _isLoopbackHost(h) {
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
}
/**
 * Turn one configured endpoint into a trusted host, or null when we are not
 * willing to trust it on the user's behalf.
 *
 * https is accepted anywhere; plain http only for loopback, because a local
 * gateway is still DSH's own traffic. The result is the exact `host` including
 * a non-default port — never an apex domain: trusting `example.com` here would
 * silently cover every subdomain of a host the user merely pointed an SDK at.
 */
function _endpointHost(raw) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s)
        return null;
    let u;
    try {
        u = new URL(s);
    }
    catch (_) {
        return null;
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && _isLoopbackHost(u.hostname.toLowerCase())))
        return null;
    if (!u.host)
        return null;
    return u.host.toLowerCase();
}
/**
 * Collect endpoint hosts from a settings value tree. Bounded depth, because a
 * provider config can nest a `baseURL` per model entry (dsh-llm-pi-ai does):
 * a flat top-level scan would miss the gateway that is actually in use.
 */
function _collectEndpointHosts(node, depth, out) {
    if (depth > 4 || node == null || typeof node !== 'object')
        return;
    if (Array.isArray(node)) {
        for (const item of node)
            _collectEndpointHosts(item, depth + 1, out);
        return;
    }
    for (const [key, value] of Object.entries(node)) {
        if (ENDPOINT_FIELD_NAMES.has(key.toLowerCase())) {
            const h = _endpointHost(value);
            if (h)
                out.add(h);
            continue;
        }
        _collectEndpointHosts(value, depth + 1, out);
    }
}
/** Retention: drop a host's frequency once it has not been seen for this long. */
const SEEN_RETENTION_MS = 6 * 60 * 60 * 1000; // 6 hours
/** Hard cap on host-frequency entries — defends the file from unbounded growth
 *  under a large or rotating host set. */
const SEEN_MAX_ENTRIES = 500;
/** Debounce for mirroring the frequency map to disk (ms). */
const SEEN_PERSIST_DEBOUNCE_MS = 2500;
/**
 * Durable, restart-safe seen-host frequency.
 *
 * Keeps `host -> {count, lastSeen}` and, when a persist directory is supplied,
 * mirrors it to `seen-hosts.json` there. On load it applies retention (entries
 * last seen more than `SEEN_RETENTION_MS` ago are dropped) and a size cap, so
 * the counters reflect recent history rather than all-time traffic and never
 * grow unbounded. Writes are debounced; `clear()` persists the reset and
 * `flush()` forces a write (shutdown / toggle-off / dispose).
 *
 * This is what restores `new-host` to its intended scarcity after a restart and
 * lets `high-frequency` build across restarts instead of being wiped to 0. When
 * no directory is available it degrades gracefully to memory-only, preserving
 * the plugin's "session-scoped unless a data dir exists" stance.
 */
export class SeenHostStore {
    _seen = new Map();
    _file = null;
    _timer = null;
    _dirty = false;
    constructor(persistDir) {
        if (persistDir) {
            try {
                if (!existsSync(persistDir))
                    mkdirSync(persistDir, { recursive: true });
                this._file = join(persistDir, 'seen-hosts.json');
                this._load();
            }
            catch (_) {
                // Persistence unavailable (unwritable/foreign dir): degrade to memory-only.
                this._file = null;
            }
        }
    }
    has(host) {
        return this._seen.has(host);
    }
    /** Current count for a host (0 when never seen). */
    count(host) {
        const r = this._seen.get(host);
        return r ? r.count : 0;
    }
    /** Record one observation of a host, then prune + schedule persistence. */
    hit(host) {
        const now = Date.now();
        const prev = this._seen.get(host);
        if (prev) {
            prev.count++;
            prev.lastSeen = now;
        }
        else {
            this._seen.set(host, { count: 1, lastSeen: now });
        }
        this._prune(now);
        this._schedulePersist();
    }
    /** Wipe the frequency map and persist the reset (used by the clear route). */
    clear() {
        this._seen.clear();
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this._persist();
    }
    /** Force an immediate write (shutdown / toggle-off / context dispose). */
    flush() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this._persist();
    }
    _prune(now = Date.now()) {
        const cutoff = now - SEEN_RETENTION_MS;
        for (const [h, r] of this._seen) {
            if (r.lastSeen < cutoff)
                this._seen.delete(h);
        }
        // Bound the map: evict the least-recently-seen entries until under the cap.
        while (this._seen.size > SEEN_MAX_ENTRIES) {
            let oldest = null;
            let oldestAt = Infinity;
            for (const [h, r] of this._seen) {
                if (r.lastSeen < oldestAt) {
                    oldestAt = r.lastSeen;
                    oldest = h;
                }
            }
            if (oldest === null)
                break;
            this._seen.delete(oldest);
        }
    }
    _schedulePersist() {
        if (!this._file || this._dirty)
            return;
        this._dirty = true;
        this._timer = setTimeout(() => {
            this._timer = null;
            this._persist();
        }, SEEN_PERSIST_DEBOUNCE_MS);
    }
    _persist() {
        this._dirty = false;
        if (!this._file)
            return;
        try {
            const payload = {};
            for (const [h, r] of this._seen)
                payload[h] = r;
            writeFileSync(this._file, JSON.stringify(payload));
        }
        catch (_) {
            /* best-effort: a failed write never breaks recording */
        }
    }
    _load() {
        if (!this._file || !existsSync(this._file))
            return;
        try {
            const raw = JSON.parse(readFileSync(this._file, 'utf8'));
            for (const [h, v] of Object.entries(raw || {})) {
                const r = v;
                if (r && typeof r.count === 'number' && typeof r.lastSeen === 'number') {
                    this._seen.set(h, { count: r.count, lastSeen: r.lastSeen });
                }
            }
            this._prune();
        }
        catch (_) {
            // Corrupted or foreign-shaped file: ignore and start empty.
        }
    }
}
/**
 * The in-memory auditor. A ring buffer capped at `cap` entries (oldest dropped
 * on overflow) plus a suspicion scorer. Lost on restart — intentional: network
 * audit history is session-scoped, not durable user data.
 */
export class NetworkMonitor {
    _cap;
    _entries = [];
    _seq = 0;
    /** Resolved once; the mutable set of user-trusted hosts. */
    _userTrusted = new Set();
    /** Resolved once; the mutable set of user-trusted plugin IDs. */
    _pluginTrusted = new Set();
    /** Hosts DSH itself is configured to call (provider endpoints); refreshed on settings change. */
    _endpointTrusted = new Set();
    /** Restart-safe seen-host frequency (persisted when a dir is available). */
    _seenHosts;
    /** #6: time-based eviction window in ms; 0 disables it (count-only buffer). */
    _ttlMs = 0;
    constructor(_cap, persistDir) {
        this._cap = _cap;
        this._seenHosts = new SeenHostStore(persistDir);
    }
    setCap(cap) {
        this._cap = Math.max(1, Math.floor(cap) || 1);
        while (this._entries.length > this._cap)
            this._entries.shift();
    }
    /** Configure time-based retention. `ttlSec` of 0 turns it off (count-only). */
    setTtl(ttlSec) {
        const s = Number(ttlSec);
        this._ttlMs = isFinite(s) && s > 0 ? s * 1000 : 0;
        this._evictStale();
    }
    setUserTrusted(hosts) {
        this._userTrusted = new Set((hosts || []).map((h) => String(h).toLowerCase()));
    }
    setPluginTrusted(plugins) {
        this._pluginTrusted = new Set((plugins || []).map((p) => String(p).toLowerCase()));
    }
    /**
     * Hosts derived from DSH's own configuration (LLM provider `baseURL`,
     * `DEEPSEEK_BASE_URL`, …). Matched EXACTLY — unlike the user's list there is
     * no apex/subdomain rule here, because a configured endpoint is one concrete
     * server, not a grant over its whole domain.
     */
    setEndpointTrusted(hosts) {
        this._endpointTrusted = new Set((hosts || []).map((h) => String(h).toLowerCase()));
    }
    /** A plugin on the user-trusted list, or a request not attributable to any */
    isTrustedPlugin(pluginId) {
        const p = (pluginId || '').toLowerCase();
        if (!p || p === _UNKNOWN_PLUGIN)
            return false;
        return this._pluginTrusted.has(p);
    }
    isTrusted(host) {
        const h = host.toLowerCase();
        if (BUILTIN_TRUSTED_HOSTS.has(h) || HOST_ALLOW_UNKNOWN)
            return true;
        if (this._endpointTrusted.has(h))
            return true;
        if (this._userTrusted.has(h))
            return true;
        // A user trust on an apex domain covers bare subdomains (api.example.com
        // under an added example.com), matching the NO_PROXY semantics elsewhere.
        for (const t of this._userTrusted) {
            if (h.endsWith('.' + t))
                return true;
        }
        return false;
    }
    _score(host, pluginId, method, reqBytes, tls, isNew, absolute = true, redirectedToUntrusted = false) {
        // Trusted host OR trusted plugin ⇨ no suspicion, no flags — unless the
        // response redirected to a DIFFERENT, untrusted host. That is exactly the
        // case #1 targets: you trusted `A`, but the data actually went to `B`.
        if ((this.isTrusted(host) || this.isTrustedPlugin(pluginId)) && !redirectedToUntrusted) {
            return { risk: 0, flags: [] };
        }
        // A relative or unparsable request is recorded with one benign flag (see
        // below). There is no resolved host to judge and such a request cannot
        // redirect to an outside host, so it never carries `redirected-host`.
        if (!absolute)
            return { risk: 0, flags: ['relative-url'] };
        if (redirectedToUntrusted) {
            // The strongest signal: a request reached a host we do NOT trust, having
            // claimed a different target up front. Score 60 regardless of whether the
            // origin itself was trusted — trusted-but-redirected is just as bad.
            return { risk: 60, flags: ['redirected-host'] };
        }
        let risk = 30; // unknown host
        const flags = ['unknown-host'];
        // +15, not +5: with a persistent seen-host store (when a data dir exists) a
        // genuinely-new host is now the RARE case — a host seen before a restart is
        // not flagged new anymore — so a first contact is worth a warning by itself
        // (30 + 15 = 45). Without a data dir the store is still memory-only and this
        // degrades back toward the old cold-start behaviour; the flag and the alert
        // margin are the same either way.
        if (isNew) {
            risk += 15;
            flags.push('new-host');
        }
        if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && reqBytes > 1024) {
            risk += 25;
            flags.push('large-upload');
        }
        if (!tls) {
            risk += 20;
            flags.push('plaintext');
        }
        // Touch-and-go heuristic: repeated calls to the same unknown host raise it.
        const seen = this._seenHosts.count(host);
        if (seen >= 3) {
            risk += 15;
            flags.push('high-frequency');
        }
        return { risk: Math.min(100, risk), flags };
    }
    /** #6: drop entries older than the TTL window. No-op when TTL is disabled, so
     *  the historical count-only ring-buffer behaviour is preserved. Run lazily on
     *  the code paths that observe the buffer (record, snapshot, alerts). */
    _evictStale(now = Date.now()) {
        if (this._ttlMs <= 0 || this._entries.length === 0)
            return;
        const cutoff = now - this._ttlMs;
        if (this._entries[this._entries.length - 1].timestamp >= cutoff)
            return;
        // Entries are pushed chronologically, so once we find one at/after the
        // cutoff all earlier ones are stale too — walk from the (oldest) front.
        let i = 0;
        while (i < this._entries.length && this._entries[i].timestamp < cutoff)
            i++;
        if (i > 0)
            this._entries.splice(0, i);
    }
    record(input, preResolvedPluginId) {
        this._evictStale();
        let host = '?';
        let pathname = '';
        // The host the response *actually* arrived from (undici exposes the final
        // URL after following redirects); empty when none / same as `host`.
        let finalHost = '';
        // Whether the request ended up on an untrusted final host different from
        // the initial target — the #1 redirect-based exfiltration signal.
        let redirectedToUntrusted = false;
        // Whether the target actually named a host. A relative/unparsable URL cannot
        // be judged by host (see _score) and must stay out of the frequency counter,
        // where every such call would pile onto the same '?' key.
        let absolute = false;
        try {
            const u = new URL(input.url);
            host = u.host || '?';
            pathname = u.pathname || '';
            absolute = !!u.host;
        }
        catch (_) {
            // Non-URL input; keep whatever we have.
        }
        if (input.finalUrl) {
            try {
                const fu = new URL(input.finalUrl);
                finalHost = fu.host || '';
                redirectedToUntrusted = !!absolute && !!finalHost && finalHost.toLowerCase() !== host.toLowerCase() && !this.isTrusted(finalHost);
            }
            catch (_) {
                // Unparsable final URL; leave finalHost empty.
            }
        }
        const firstSeen = absolute ? !this._seenHosts.has(host) : false;
        if (absolute)
            this._seenHosts.hit(host);
        // Use the pre-resolved pluginId when available — the caller captures it
        // synchronously before `await fetch()` so the stack trace is intact.
        // After `await`, the caller's frames are gone and _pluginIdFromStack()
        // misattributes scoped packages (e.g. resolves `@michengai` instead of
        // `@michengai/dsh-archive-manager`).
        const pluginId = preResolvedPluginId || resolvePluginId();
        const { risk, flags } = this._score(host, pluginId, input.method, input.reqBytes, input.tls, firstSeen, absolute, redirectedToUntrusted);
        const entry = {
            seq: ++this._seq,
            pluginId,
            method: input.method,
            host,
            pathname,
            finalHost,
            reqBytes: input.reqBytes,
            resBytes: input.resBytes,
            status: input.status,
            durationMs: input.durationMs,
            tls: input.tls,
            risk,
            flags,
            timestamp: Date.now(),
        };
        this._entries.push(entry);
        if (this._entries.length > this._cap)
            this._entries.shift();
        return entry;
    }
    snapshot() {
        this._evictStale();
        return this._entries.slice();
    }
    alerts(threshold) {
        this._evictStale();
        return this._entries.filter((e) => e.risk >= threshold);
    }
    /**
     * Reset the auditor's captured history: the ring buffer, the inventory
     * counter and the seen-host/frequency scoring all start over, so both the
     * stream log and the alert stream come back empty. Mirrors the panel's 清空
     * button, which must clear the backend data, not just the displayed list.
     */
    clear() {
        this._entries = [];
        this._seq = 0;
        this._seenHosts.clear();
    }
    /** Flush the seen-host store to disk (shutdown / toggle-off / dispose). */
    flush() {
        this._seenHosts.flush();
    }
}
/** Module-level so the tracer and routes share one instance per process. */
let _networkMonitor = null;
/** The wrapper we installed, saved so dispose can restore the original fetch. */
let _restoreFetch = null;
/** Original http/https `.request` refs, restored on dispose. */
let _restoreHttp = null;
/** Endpoint hosts derived from DSH's own configuration; also read by the GET route. */
let _configuredEndpoints = [];
/**
 * Recompute the endpoints DSH is configured to call and hand them to the
 * auditor as trusted hosts.
 *
 * This is what keeps the audit useful without hardcoding vendors: any host the
 * user pointed an LLM provider at (or exported as DEEPSEEK_BASE_URL) is, by
 * construction, traffic DSH means to send — so it must not read as an "unknown
 * host" and alert on every restart. It is deliberately NOT written into
 * `netWhitelist`: that list is the user's own declaration and must stay
 * distinguishable from what we inferred. Removing the provider drops the trust
 * again on the next refresh.
 */
function refreshConfiguredEndpoints(source) {
    const out = new Set();
    try {
        const descriptors = source && typeof source.describe === 'function' ? source.describe() : [];
        for (const d of descriptors || []) {
            // `user`/`base` are the layers; `value` is the resolved configuration.
            _collectEndpointHosts(d && (d.value ?? d.user ?? d.base), 0, out);
        }
    }
    catch (_) {
        // Settings not ready (or a foreign shape): the env fallback below still counts.
    }
    for (const name of ENDPOINT_ENV_VARS) {
        const h = _endpointHost(process.env[name]);
        if (h)
            out.add(h);
    }
    _configuredEndpoints = Array.from(out).sort();
    if (_networkMonitor)
        _networkMonitor.setEndpointTrusted(_configuredEndpoints);
    return _configuredEndpoints;
}
/**
 * Estimate the byte size of a fetch RequestInit body WITHOUT reading its
 * content — sizing only, never capturing data.
 *
 * Directly measurable bodies (string / buffer / params / blob / arraybuffer)
 * are sized lexically. Streams and other opaque bodies cannot be sized without
 * consuming them, so we fall back to an explicit `Content-Length` header when
 * the caller supplied one — that keeps a large streamed upload from silently
 * reading as 0 bytes and never tripping `large-upload`. When neither applies we
 * report 0 (better than swallowing the stream).
 */
export function _estimateReqBytes(body, contentLength) {
    if (body != null) {
        if (typeof body === 'string')
            return Buffer.byteLength(body, 'utf8');
        if (Buffer.isBuffer(body))
            return body.byteLength;
        if (body instanceof URLSearchParams)
            return Buffer.byteLength(body.toString(), 'utf8');
        if (body instanceof Blob)
            return typeof body.size === 'number' ? body.size : 0;
        if (body instanceof ArrayBuffer)
            return body.byteLength;
        if (ArrayBuffer.isView(body))
            return body.byteLength;
    }
    // Streams / other: unknowable without consuming. Use an explicit Content-Length
    // if the caller set one, otherwise report 0 rather than swallow the body.
    if (typeof contentLength === 'number' && contentLength >= 0)
        return contentLength;
    return 0;
}
/**
 * Read a `Content-Length` value from fetch's headers, whichever shape they take
 * (undici `Headers`, an array of `[k, v]` pairs, or a plain object). Returns the
 * parsed non-negative length when present, else `undefined` — never swallows the
 * body, only reads the header metadata.
 */
function _contentLengthOf(headers) {
    if (!headers)
        return undefined;
    let get;
    try {
        get = headers.get;
    }
    catch (_) {
        get = undefined;
    }
    if (typeof get === 'function') {
        try {
            const v = headers.get('content-length');
            const n = v == null ? NaN : parseInt(String(v), 10);
            return Number.isFinite(n) && n >= 0 ? n : undefined;
        }
        catch (_) {
            return undefined;
        }
    }
    if (Array.isArray(headers)) {
        for (const kv of headers) {
            if (kv && String(kv[0]).toLowerCase() === 'content-length') {
                const n = parseInt(String(kv[1]), 10);
                return Number.isFinite(n) && n >= 0 ? n : undefined;
            }
        }
        return undefined;
    }
    if (typeof headers === 'object') {
        try {
            for (const k of Object.keys(headers)) {
                if (k.toLowerCase() === 'content-length') {
                    const n = parseInt(String(headers[k]), 10);
                    return Number.isFinite(n) && n >= 0 ? n : undefined;
                }
            }
        }
        catch (_) { /* ignore */ }
    }
    return undefined;
}
/**
 * Install a global outbound-request tracer by wrapping `globalThis.fetch`.
 *
 * Node.js 18+/undici fetch is the shared entry point for `ctx.http` and raw
 * `fetch()` calls alike, so a single wrapper captures both. We record metadata
 * around the promise; the body is only NEVER read (the Response is returned
 * untouched to the caller).
 *
 * Returns a disposer that restores the original fetch and stops capture.
 */
function installRequestTracer() {
    const origFetch = globalThis.fetch;
    // Guard against double-install on hot reload / re-apply.
    if (!origFetch || origFetch.__dockFlashTraced)
        return () => { };
    const wrap = async (input, init) => {
        const method = (init && init.method) || (typeof input === 'string' ? 'GET' : (input && input.method) || 'GET');
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        // For a streamed/opaque body we fall back to the caller's Content-Length.
        // It may live on `init.headers` or on the `Request` object itself.
        const inputHeaders = input && typeof input.headers?.get === 'function' ? input.headers : undefined;
        const clFromHeaders = _contentLengthOf((init && init.headers) ?? inputHeaders);
        const reqBytes = _estimateReqBytes(init && init.body, clFromHeaders);
        // Capture pluginId synchronously — before `await` — so the call stack
        // still contains the caller's frames.  After `await`, only the microtask
        // resume frame remains and _pluginIdFromStack() loses the real caller.
        const callerPluginId = resolvePluginId();
        const started = Date.now();
        let status = 0;
        let resBytes = -1;
        let tls = false;
        try {
            tls = typeof url === 'string' && /^https:/i.test(url);
        }
        catch (_) { }
        try {
            const res = await origFetch.call(globalThis, input, init);
            status = res.status;
            const cl = res.headers && res.headers.get && res.headers.get('content-length');
            resBytes = cl ? (parseInt(cl, 10) || 0) : -1;
            // undici's Response exposes `.redirected` (boolean) and `.url` (the final
            // URL after following any redirects). Pass those through so record() can
            // see where the request *actually* landed, not just where it was aimed.
            const finalUrl = res && typeof res.url === 'string' && res.url ? res.url : undefined;
            const end = Date.now();
            if (_networkMonitor) {
                try {
                    _networkMonitor.record({ method, url, finalUrl, reqBytes, resBytes, status, durationMs: end - started, tls }, callerPluginId);
                }
                catch (_) { }
            }
            return res;
        }
        catch (e) {
            const end = Date.now();
            if (_networkMonitor) {
                try {
                    // On an aborted/rejected request (DNS / refused / timeout) there is no
                    // final URL to record — the response never arrived.
                    _networkMonitor.record({ method, url, reqBytes, resBytes: -1, status: 0, durationMs: end - started, tls }, callerPluginId);
                }
                catch (_) { }
            }
            throw e;
        }
    };
    wrap.__dockFlashTraced = true;
    globalThis.fetch = wrap;
    _restoreFetch = () => {
        if (globalThis.fetch === wrap)
            globalThis.fetch = origFetch;
        _restoreFetch = null;
    };
    return _restoreFetch;
}
/**
 * Install a tracer on Node's native `http.request` / `https.request`.
 *
 * undici fetch (and therefore `ctx.http` / raw `fetch`) is already captured by
 * installRequestTracer. This second wrapper closes the gap for plugins that talk
 * to hosts directly through `node:http`/`node:https` — and, because a WebSocket
 * is opened with a first HTTP Upgrade request, for `ws`-style connections too,
 * which is the heart of the #3 "security / non-fetch" ask.
 *
 * We only tap metadata listeners on the returned ClientRequest; neither the
 * request nor the response stream is read or mutated, so bodies stay untouched
 * (privacy + non-intrusion). Host/path/method are read off the ClientRequest's
 * public surface (robust against every overload form of request()).
 *
 * Returns a disposer that restores both originals.
 */
export function installHttpTracer() {
    // Keep the originals so dispose can restore exactly what we replaced.
    const mods = [nodeHttp, nodeHttps];
    const origs = [nodeHttp.request, nodeHttps.request];
    if (nodeHttp.request.__dockFlashTraced)
        return () => { };
    for (const mod of mods) {
        const orig = mod.request;
        mod.request = function (...args) {
            let callerPluginId = '';
            try {
                callerPluginId = resolvePluginId();
            }
            catch (_) { }
            const started = Date.now();
            const isHttps = mod === nodeHttps;
            let req;
            try {
                req = orig.apply(this, args);
            }
            catch (e) {
                // request() returns synchronously; only invalid args throw.
                throw e;
            }
            const proto = isHttps ? 'https:' : 'http:';
            const host = (req && req.host) || '?';
            const path = (req && (req.path || req.pathname)) || '/';
            const url = proto + '//' + host + path;
            const method = (req && req.method) || 'GET';
            let reqBytes = 0;
            try {
                if (req && typeof req.getHeaders === 'function') {
                    const h = req.getHeaders();
                    reqBytes = _contentLengthOf(h) || 0;
                }
            }
            catch (_) { }
            try {
                req.on('response', (res) => {
                    const status = res && res.statusCode != null ? res.statusCode : 0;
                    let resBytes = -1;
                    try {
                        if (res && res.headers) {
                            const cl = res.headers['content-length'];
                            resBytes = cl != null ? (parseInt(String(cl), 10) || -1) : -1;
                        }
                    }
                    catch (_) { }
                    if (_networkMonitor) {
                        try {
                            _networkMonitor.record({ method, url, reqBytes, resBytes, status, durationMs: Date.now() - started, tls: isHttps }, callerPluginId);
                        }
                        catch (_) { }
                    }
                });
                req.on('error', () => {
                    if (_networkMonitor) {
                        try {
                            _networkMonitor.record({ method, url, reqBytes, resBytes: -1, status: 0, durationMs: Date.now() - started, tls: isHttps }, callerPluginId);
                        }
                        catch (_) { }
                    }
                });
            }
            catch (_) { }
            return req;
        };
        mod.request.__dockFlashTraced = true;
    }
    _restoreHttp = () => {
        for (let i = 0; i < mods.length; i++) {
            if (mods[i].request && mods[i].request.__dockFlashTraced) {
                mods[i].request = origs[i];
            }
        }
        _restoreHttp = null;
    };
    return _restoreHttp;
}
/** Send a JSON response with no-store cache control. */
function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
}
/**
 * Read an optional JSON request body, bounded so a client cannot feed the
 * host an unbounded buffer. Returns null for an empty, oversized, or
 * unparseable body — callers treat that as "no override supplied".
 */
async function readJsonBody(req, limit = 4096) {
    try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > limit)
                return null;
            chunks.push(chunk);
        }
        if (chunks.length === 0)
            return null;
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch (_) {
        return null;
    }
}
export function apply(ctx, config) {
    // ── Settings namespace registration ──────────────────────────────────
    ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
        // Trust the endpoints DSH itself is configured to call, so the user's own
        // providers do not read as "unknown hosts" (see refreshConfiguredEndpoints).
        refreshConfiguredEndpoints(settingsCtx.settings);
        // Re-evaluate the audit toggle here too: at apply() time the resolved
        // config may not yet reflect the PERSISTED netAuditEnabled (the settings
        // service injects asynchronously). reconfigureAudit() reads the volatile
        // reference, so once settings are live it must run again to start the fetch
        // tracer if the user had auditing on (single authority = host-settings).
        // reconfigureAudit is a hoisted closure defined later in apply(); this
        // callback fires after apply() has fully initialised it.
        try {
            reconfigureAudit();
        }
        catch (_) { }
        settingsCtx.effect(() => settingsCtx.on('settings/document-updated', () => {
            refreshConfiguredEndpoints(settingsCtx.settings);
        }));
    });
    // ── Network Monitor bootstrap ────────────────────────────────────────
    // One bounded monitor per process. Config is (re)read from volatile
    // references so a late settings reply or an unrelated field edit refreshes
    // thresholds and whitelist. The tracer wrapper is installed ONLY while
    // `netAuditEnabled` is true — it is opt-in, NOT the default — so toggling
    // the setting off at runtime restores the original fetch and stops all
    // recording. When disabled the routes below stay registered but answer
    // empty lists (no monitor instance), so an already-open panel never 500s.
    //
    // The seen-host frequency store is persisted under DSH's data dir so cold
    // starts stop false-alarming and `high-frequency` survives restarts. The
    // dir resolves from ctx.baseDir when available; otherwise persistence is a
    // no-op and the store stays memory-only (the plugin's original behaviour).
    const baseDir = typeof ctx.baseDir === 'string' ? ctx.baseDir : undefined;
    const persistDir = baseDir ? join(baseDir, 'dsh-flash-net-mon') : undefined;
    const reconfigureAudit = () => {
        if (config.netAuditEnabled.get()) {
            // Enabled: ensure the monitor exists, refresh cap/whitelist, and install
            // the tracer once. Both `_restoreFetch === null` and `__dockFlashTraced`
            // are kept as guards — the latter also protects against another plugin
            // having wrapped fetch (installRequestTracer checks it again internally).
            if (!_networkMonitor)
                _networkMonitor = new NetworkMonitor(config.netLogCap.get() || DEFAULT_NET_LOG_CAP, persistDir);
            _networkMonitor.setCap(config.netLogCap.get());
            _networkMonitor.setTtl(config.netLogTtlSec.get());
            _networkMonitor.setUserTrusted(Array.isArray(config.netWhitelist.get()) ? config.netWhitelist.get() : []);
            _networkMonitor.setPluginTrusted(Array.isArray(config.netPluginWhitelist.get()) ? config.netPluginWhitelist.get() : []);
            // Derive the trusted endpoints again: settings may have become available
            // (or changed) while auditing was off, in which case the inject callback
            // had no live monitor to hand the list to.
            try {
                refreshConfiguredEndpoints(ctx.get ? ctx.get('settings') : null);
            }
            catch (_) { }
            _networkMonitor.setEndpointTrusted(_configuredEndpoints);
            if (_restoreFetch === null && !globalThis.fetch?.__dockFlashTraced) {
                installRequestTracer();
            }
            if (_restoreHttp === null) {
                installHttpTracer();
            }
        }
        else if (_restoreFetch !== null || _restoreHttp !== null) {
            // Disabled: stop wrapping fetch (restores the original) and release the
            // monitor so no further recording happens. The routes read the nulled
            // monitor as empty. Flush the seen-host store first so the reset (or the
            // latest frequencies) lands on disk.
            if (_restoreFetch)
                _restoreFetch();
            if (_restoreHttp)
                _restoreHttp();
            if (_networkMonitor)
                _networkMonitor.flush();
            _networkMonitor = null;
        }
    };
    reconfigureAudit();
    ctx.effect(() => {
        // Return the cleanup function — Cordis calls it when the context is disposed.
        // Read the current restorers at teardown time (they null themselves), so a
        // toggle before dispose is also correctly undone — fetch and http both.
        return () => {
            if (_restoreFetch)
                _restoreFetch();
            if (_restoreHttp)
                _restoreHttp();
            if (_networkMonitor)
                _networkMonitor.flush();
            _networkMonitor = null;
        };
    });
    // ── C · Network audit — volatile-update subscription ─────────────────
    // Self-contained: listens for changes on its own audit paths only.
    ctx.on('loader/volatile-update', (paths) => {
        const auditPaths = ['netAuditEnabled', 'netLogCap', 'netLogTtlSec', 'netSuspectWarn', 'netSuspectErr', 'netWhitelist', 'netPluginWhitelist'];
        const relevant = (p) => p.length === 1;
        if (!paths.some((p) => relevant(p) && auditPaths.includes(p[0])))
            return;
        reconfigureAudit();
    });
    // ── HTTP API routes for client-side features ─────────────────────────
    // The webServer type augmentation lives in @deepseek-ai/dsh-host-webserver
    // which is not a direct dependency; cast through `any` for the register calls.
    ctx.inject(['webServer'], (wsCtx) => {
        // C · Network audit (outbound request auditor) ──────────────────────
        // These routes read `_networkMonitor`, which exists ONLY while
        // `netAuditEnabled` is on; when the auditor is off they answer empty
        // lists rather than 500 (K4: audit is opt-in, nothing here wraps fetch).
        // Paged snapshot of the audited-request ring buffer, newest first.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dsh-flash-net-mon/network-log',
            handler: async (req, res) => {
                // DELETE clears the auditor's captured history (ring buffer + scoring
                // state), so the stream log and the alert stream both come back empty —
                // what the panel 清空 button must do, not just blank the displayed list.
                if (req.method === 'DELETE') {
                    if (_networkMonitor)
                        _networkMonitor.clear();
                    sendJson(res, 200, { ok: true });
                    return;
                }
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET, DELETE');
                    res.end();
                    return;
                }
                if (!_networkMonitor) {
                    sendJson(res, 200, { entries: [], offset: 0 });
                    return;
                }
                const u = new URL(req.url || '/', 'http://localhost');
                const offset = Math.max(0, parseInt(u.searchParams.get('offset') || '0', 10) || 0);
                let limit = parseInt(u.searchParams.get('limit') || '100', 10) || 100;
                limit = Math.max(1, Math.min(limit, 500));
                const all = _networkMonitor.snapshot().reverse();
                const entries = all.slice(offset, offset + limit);
                sendJson(res, 200, { entries, offset, limit, total: all.length });
            },
        }), 'dsh-flash-net-mon: GET /plugins/dsh-flash-net-mon/network-log');
        // Suspicious/dangerous requests (risk >= warn threshold).
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dsh-flash-net-mon/network-alerts',
            handler: async (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET');
                    res.end();
                    return;
                }
                if (!_networkMonitor) {
                    sendJson(res, 200, { alerts: [] });
                    return;
                }
                const threshold = config.netSuspectWarn.get() ?? DEFAULT_NET_SUSPECT_WARN;
                sendJson(res, 200, { alerts: _networkMonitor.alerts(threshold).reverse() });
            },
        }), 'dsh-flash-net-mon: GET /plugins/dsh-flash-net-mon/network-alerts');
        // Whitelist management — persist trusted hosts via the settings service.
        // The client writes through the same `ctx.remote.settings` path as the
        // proxies; this route is a convenience for tools that cannot reach the
        // settings service. We re-resolve and call reconfigureAudit() ourselves so the
        // monitor picks up the change immediately regardless of which writer used.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dsh-flash-net-mon/network-whitelist',
            handler: async (req, res) => {
                // GET is the read-only view: the user's own list plus what is trusted on
                // their behalf (built-in hosts and the endpoints DSH is configured to
                // call). Trust the user cannot see is trust they cannot audit.
                if (req.method === 'GET') {
                    sendJson(res, 200, {
                        hosts: Array.isArray(config.netWhitelist.get()) ? config.netWhitelist.get() : [],
                        builtin: Array.from(BUILTIN_TRUSTED_HOSTS).sort(),
                        endpoints: _configuredEndpoints,
                    });
                    return;
                }
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET, POST');
                    res.end();
                    return;
                }
                const body = await readJsonBody(req);
                if (!body || !Array.isArray(body.hosts)) {
                    sendJson(res, 400, { error: 'Missing or invalid hosts array' });
                    return;
                }
                const hosts = [];
                for (const h of body.hosts) {
                    if (typeof h !== 'string') {
                        sendJson(res, 400, { error: 'hosts must be strings' });
                        return;
                    }
                    try {
                        // Validate: each entry must parse as a valid host (optionally :port).
                        const s = h.trim();
                        if (!s)
                            continue;
                        new URL('http://' + s.replace(/^https?:\/\//i, ''));
                        hosts.push(s.toLowerCase());
                    }
                    catch (_) {
                        sendJson(res, 400, { error: 'Invalid host: ' + h });
                        return;
                    }
                }
                if (_networkMonitor)
                    _networkMonitor.setUserTrusted(hosts);
                // Persist so the setting survives restart. If the remote settings
                // service is unavailable we still apply the in-memory override above.
                let rs = null;
                try {
                    rs = ctx.get ? ctx.get('remote.settings') ?? ctx.remote?.settings ?? null : null;
                }
                catch (_) {
                    rs = null;
                }
                if (rs && typeof rs.update === 'function') {
                    try {
                        await rs.update('dsh-flash-net-mon', { netWhitelist: hosts });
                    }
                    catch (_) { /* memory override already in force */ }
                }
                sendJson(res, 200, { ok: true, hosts });
            },
        }), 'dsh-flash-net-mon: POST /plugins/dsh-flash-net-mon/network-whitelist');
        // Plugin whitelist management — same shape as the host whitelist, but keyed
        // on plugin ID. The auditor zeroes the risk of every request attributed to
        // a whitelisted plugin (the log still records it).
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dsh-flash-net-mon/network-plugin-whitelist',
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'POST');
                    res.end();
                    return;
                }
                const body = await readJsonBody(req);
                if (!body || !Array.isArray(body.plugins)) {
                    sendJson(res, 400, { error: 'Missing or invalid plugins array' });
                    return;
                }
                const plugins = [];
                for (const p of body.plugins) {
                    if (typeof p !== 'string') {
                        sendJson(res, 400, { error: 'plugins must be strings' });
                        return;
                    }
                    const s = p.trim();
                    if (!s)
                        continue;
                    plugins.push(s.toLowerCase());
                }
                if (_networkMonitor)
                    _networkMonitor.setPluginTrusted(plugins);
                let rs = null;
                try {
                    rs = ctx.get ? ctx.get('remote.settings') ?? ctx.remote?.settings ?? null : null;
                }
                catch (_) {
                    rs = null;
                }
                if (rs && typeof rs.update === 'function') {
                    try {
                        await rs.update('dsh-flash-net-mon', { netPluginWhitelist: plugins });
                    }
                    catch (_) { /* memory override already in force */ }
                }
                sendJson(res, 200, { ok: true, plugins });
            },
        }), 'dsh-flash-net-mon: POST /plugins/dsh-flash-net-mon/network-plugin-whitelist');
    });
}
