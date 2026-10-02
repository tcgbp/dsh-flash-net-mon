import { AsyncLocalStorage } from 'node:async_hooks';
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
    const re = /node_modules[\\/]+([^\\/]+)/g;
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
 * The in-memory auditor. A ring buffer capped at `cap` entries (oldest dropped
 * on overflow) plus a suspicion scorer. Lost on restart — intentional: network
 * audit history is session-scoped, not durable user data.
 */
class NetworkMonitor {
    _cap;
    _entries = [];
    _seq = 0;
    /** Resolved once; the mutable set of user-trusted hosts. */
    _userTrusted = new Set();
    /** Resolved once; the mutable set of user-trusted plugin IDs. */
    _pluginTrusted = new Set();
    _seenHosts = new Map();
    constructor(_cap) {
        this._cap = _cap;
    }
    setCap(cap) {
        this._cap = Math.max(1, Math.floor(cap) || 1);
        while (this._entries.length > this._cap)
            this._entries.shift();
    }
    setUserTrusted(hosts) {
        this._userTrusted = new Set((hosts || []).map((h) => String(h).toLowerCase()));
    }
    setPluginTrusted(plugins) {
        this._pluginTrusted = new Set((plugins || []).map((p) => String(p).toLowerCase()));
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
    _score(host, pluginId, method, reqBytes, tls, isNew) {
        // Trusted host OR trusted plugin ⇨ no suspicion, no flags.
        if (this.isTrusted(host) || this.isTrustedPlugin(pluginId))
            return { risk: 0, flags: [] };
        let risk = 30; // unknown host
        const flags = ['unknown-host'];
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
        const seen = this._seenHosts.get(host) || 0;
        if (seen >= 3) {
            risk += 15;
            flags.push('high-frequency');
        }
        return { risk: Math.min(100, risk), flags };
    }
    record(input) {
        let host = '?';
        let pathname = '';
        try {
            const u = new URL(input.url);
            host = u.host || '?';
            pathname = u.pathname || '';
        }
        catch (_) {
            // Non-URL input; keep whatever we have.
        }
        const firstSeen = !this._seenHosts.has(host);
        this._seenHosts.set(host, (this._seenHosts.get(host) || 0) + 1);
        const pluginId = resolvePluginId();
        const { risk, flags } = this._score(host, pluginId, input.method, input.reqBytes, input.tls, firstSeen);
        const entry = {
            seq: ++this._seq,
            pluginId,
            method: input.method,
            host,
            pathname,
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
        return this._entries.slice();
    }
    alerts(threshold) {
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
        this._seenHosts = new Map();
    }
}
/** Module-level so the tracer and routes share one instance per process. */
let _networkMonitor = null;
/** The wrapper we installed, saved so dispose can restore the original fetch. */
let _restoreFetch = null;
/**
 * Estimate the byte size of a fetch RequestInit body WITHOUT reading its
 * content — sizing only, never capturing data.
 */
function _estimateReqBytes(body) {
    if (body == null)
        return 0;
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
    // Streams / other: unknowable without consuming — report 0 rather than swallow.
    return 0;
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
        const reqBytes = _estimateReqBytes(init && init.body);
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
            const end = Date.now();
            if (_networkMonitor) {
                try {
                    _networkMonitor.record({ method, url, reqBytes, resBytes, status, durationMs: end - started, tls });
                }
                catch (_) { }
            }
            return res;
        }
        catch (e) {
            const end = Date.now();
            if (_networkMonitor) {
                try {
                    _networkMonitor.record({ method, url, reqBytes, resBytes: -1, status: 0, durationMs: end - started, tls });
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
    });
    // ── Network Monitor bootstrap ────────────────────────────────────────
    // One bounded monitor per process. Config is (re)read from volatile
    // references so a late settings reply or an unrelated field edit refreshes
    // thresholds and whitelist. The tracer wrapper is installed ONLY while
    // `netAuditEnabled` is true — it is opt-in, NOT the default — so toggling
    // the setting off at runtime restores the original fetch and stops all
    // recording. When disabled the routes below stay registered but answer
    // empty lists (no monitor instance), so an already-open panel never 500s.
    const reconfigureAudit = () => {
        if (config.netAuditEnabled.get()) {
            // Enabled: ensure the monitor exists, refresh cap/whitelist, and install
            // the tracer once. Both `_restoreFetch === null` and `__dockFlashTraced`
            // are kept as guards — the latter also protects against another plugin
            // having wrapped fetch (installRequestTracer checks it again internally).
            if (!_networkMonitor)
                _networkMonitor = new NetworkMonitor(config.netLogCap.get() || DEFAULT_NET_LOG_CAP);
            _networkMonitor.setCap(config.netLogCap.get());
            _networkMonitor.setUserTrusted(Array.isArray(config.netWhitelist.get()) ? config.netWhitelist.get() : []);
            _networkMonitor.setPluginTrusted(Array.isArray(config.netPluginWhitelist.get()) ? config.netPluginWhitelist.get() : []);
            if (_restoreFetch === null && !globalThis.fetch?.__dockFlashTraced) {
                installRequestTracer();
            }
        }
        else if (_restoreFetch !== null) {
            // Disabled: stop wrapping fetch (restores the original) and release the
            // monitor so no further recording happens. The routes read the nulled
            // monitor as empty.
            _restoreFetch();
            _networkMonitor = null;
        }
    };
    reconfigureAudit();
    ctx.effect(() => {
        // Return the cleanup function — Cordis calls it when the context is disposed.
        const restore = _restoreFetch;
        return () => {
            if (restore)
                restore();
            _networkMonitor = null;
        };
    });
    // ── C · Network audit — volatile-update subscription ─────────────────
    // Self-contained: listens for changes on its own audit paths only.
    ctx.on('loader/volatile-update', (paths) => {
        const auditPaths = ['netAuditEnabled', 'netLogCap', 'netSuspectWarn', 'netSuspectErr', 'netWhitelist', 'netPluginWhitelist'];
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
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'POST');
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
                        await rs.update('net-mon', { netWhitelist: hosts });
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
                        await rs.update('net-mon', { netPluginWhitelist: plugins });
                    }
                    catch (_) { /* memory override already in force */ }
                }
                sendJson(res, 200, { ok: true, plugins });
            },
        }), 'dsh-flash-net-mon: POST /plugins/dsh-flash-net-mon/network-plugin-whitelist');
    });
}
