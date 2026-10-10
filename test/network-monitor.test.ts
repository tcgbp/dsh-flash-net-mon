// Unit tests for the pure-logic core of the outbound auditor.
//
// Run against the compiled `dist/index.js` (plain ESM), because Node's
// strip-only mode cannot parse the TypeScript *parameter property* used in
// src. Build first (`pnpm build`), then:
//
//   pnpm test
//
// No test framework dependency is needed: Node's built-in `node:test` runs it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NetworkMonitor, SeenHostStore, _estimateReqBytes, installHttpTracer, withPluginContext, resolvePluginId, _canonicalHost, mkRuntime, _pluginIdFromStackText } from '../dist/index.js'
import nodeHttp from 'node:http'

function rec(mon, over = {}, pid = 'test-plugin') {
  return mon.record(
    {
      method: 'GET',
      url: 'https://unknown-evil.example/path',
      reqBytes: 0,
      resBytes: 100,
      status: 200,
      durationMs: 50,
      tls: true,
      ...over,
    },
    pid,
  )
}

test('unknown host, first contact: baseline 30 + new-host 15 = 45, alerts', () => {
  const m = new NetworkMonitor(100)
  const e = rec(m)
  assert.equal(e.risk, 45)
  assert.ok(e.flags.includes('unknown-host'))
  assert.ok(e.flags.includes('new-host'))
})

test('same unknown host on 3rd call gains high-frequency (+15 → 45)', () => {
  const m = new NetworkMonitor(100)
  assert.equal(rec(m).risk, 45) // 1st: new-host (30+15)
  assert.equal(rec(m).risk, 30) // 2nd: plain unknown
  assert.equal(rec(m).risk, 45) // 3rd: high-frequency (30+15)
})

test('large upload (+25) alerts on its own with a new host (70)', () => {
  const m = new NetworkMonitor(100)
  const e = rec(m, { method: 'POST', reqBytes: 2048 })
  assert.equal(e.risk, 70)
  assert.ok(e.flags.includes('large-upload'))
})

test('plaintext (+20) alerts with a new host (65)', () => {
  const m = new NetworkMonitor(100)
  const e = rec(m, { url: 'http://unknown-evil.example/', tls: false })
  assert.equal(e.risk, 65)
  assert.ok(e.flags.includes('plaintext'))
})

test('trusted host scores 0', () => {
  const m = new NetworkMonitor(100)
  m.setUserTrusted(['trusted.example'])
  const e = rec(m, { url: 'https://trusted.example/x' })
  assert.equal(e.risk, 0)
  assert.equal(e.flags.length, 0)
})

test('user trust on apex covers subdomains (NO_PROXY semantics)', () => {
  const m = new NetworkMonitor(100)
  m.setUserTrusted(['example.com'])
  assert.equal(m.isTrusted('api.example.com'), true)
  assert.equal(rec(m, { url: 'https://api.example.com/x' }).risk, 0)
})

test('trusted plugin zeroes risk even for unknown host', () => {
  const m = new NetworkMonitor(100)
  m.setPluginTrusted(['my-plugin'])
  assert.equal(rec(m, {}, 'my-plugin').risk, 0)
})

test('#1: trusted origin redirected to an untrusted host scores 60', () => {
  const m = new NetworkMonitor(100)
  m.setUserTrusted(['trusted.example'])
  const e = rec(m, {
    url: 'https://trusted.example/start',
    finalUrl: 'https://evil.example/land',
  })
  assert.equal(e.risk, 60)
  assert.ok(e.flags.includes('redirected-host'))
  assert.equal(e.finalHost, 'evil.example')
})

test('redirect to a THIRD-PARTY host that is itself whitelisted is fine', () => {
  const m = new NetworkMonitor(100)
  m.setUserTrusted(['trusted.example', 'evil.example'])
  const e = rec(m, {
    url: 'https://trusted.example/start',
    finalUrl: 'https://evil.example/land',
  })
  assert.equal(e.risk, 0)
})

test('untrusted origin redirected to untrusted host still 60 (not additive)', () => {
  const m = new NetworkMonitor(100)
  const e = rec(m, {
    url: 'https://a.example/start',
    finalUrl: 'https://b.example/land',
  })
  // Origin itself is unknown (would be 30) but the redirect dominates.
  assert.equal(e.risk, 60)
})

test('benign redirect (same host) is ignored', () => {
  const m = new NetworkMonitor(100)
  m.setUserTrusted(['api.example'])
  const e = rec(m, {
    url: 'https://api.example/start',
    finalUrl: 'https://api.example/land',
  })
  assert.equal(e.risk, 0)
  assert.equal(e.finalHost, 'api.example')
})

test('relative URL records 0 with relative-url flag and sits out the counter', () => {
  const m = new NetworkMonitor(100)
  const e = rec(m, { url: '/local/thing' })
  assert.equal(e.risk, 0)
  assert.ok(e.flags.includes('relative-url'))
  // A subsequent genuinely-unknown host must still read as FIRST-seen, proving
  // the '?' key never accumulated during the relative-URL calls.
  assert.equal(rec(m, {}).flags.includes('new-host'), true)
})

test('ring buffer drops oldest past cap; alerts() only returns >= threshold', () => {
  const m = new NetworkMonitor(2)
  m.setUserTrusted(['trusted.example'])
  // a) trusted → 0; b) and c) unknown first contacts → 45 each.
  const a = rec(m, { url: 'https://trusted.example/' })
  const b = rec(m, { url: 'https://one.example/' })
  const c = rec(m, { url: 'https://two.example/' })
  assert.equal(a.risk, 0)
  assert.equal(b.risk, 45)
  assert.equal(c.risk, 45)
  assert.equal(m.snapshot().length, 2)
  assert.equal(m.snapshot()[0].seq, b.seq) // a (oldest) was dropped
  assert.equal(m.snapshot()[1].seq, c.seq) // newest kept
  // Risk >= 30: both b and c qualify (a, at 0, is out and already dropped).
  assert.equal(m.alerts(30).length, 2)
  // Risk >= 60: neither b nor c (45) qualifies, and a (0) is dropped anyway.
  assert.equal(m.alerts(60).length, 0)
})

test('clear wipes ring buffer, sequence and frequency state', () => {
  const m = new NetworkMonitor(100)
  rec(m) // sees host once
  rec(m) // second call, host now seen
  m.clear()
  assert.equal(m.snapshot().length, 0)
  // After clear the sequence restarts at 1 and the host is "new" again.
  const e = rec(m)
  assert.equal(e.seq, 1)
  assert.ok(e.flags.includes('new-host'))
})

// ── _estimateReqBytes — #2 streaming body sizing ──────────────────────────

test('#2: direct bodies size lexically', () => {
  assert.equal(_estimateReqBytes('héllo'), Buffer.byteLength('héllo', 'utf8'))
  assert.equal(_estimateReqBytes(Buffer.from('abc')), 3)
  assert.equal(_estimateReqBytes(new URLSearchParams('a=1&b=2')), 7)
  const ab = new ArrayBuffer(8)
  assert.equal(_estimateReqBytes(ab), 8)
  assert.equal(_estimateReqBytes(new Uint8Array(5)), 5)
})

test('#2: a streamed body with Content-Length reports that length', () => {
  // ReadableStream has no size we can read lexically, so sizing falls back to
  // the caller's Content-Length header — exactly the large-upload blind spot.
  const rs = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])) } })
  assert.equal(_estimateReqBytes(rs), 0) // no header → unknown
  assert.equal(_estimateReqBytes(rs, 2048), 2048) // header present → sized
})

test('#2: streamed body with Content-Length trips large-upload', () => {
  const m = new NetworkMonitor(100)
  // Simulate what the tracer now does: pass the parsed Content-Length through.
  const e = m.record(
    { method: 'POST', url: 'https://upload.example/in', reqBytes: _estimateReqBytes(new ReadableStream(), 4096), resBytes: 100, status: 200, durationMs: 10, tls: true },
    'test',
  )
  assert.equal(e.risk, 70) // 30 unknown + 25 large-upload + 15 new-host
  assert.ok(e.flags.includes('large-upload'))
  assert.notEqual(e.reqBytes, 0)
})

// ── #4 seen-host persistence ───────────────────────────────────────────────

/** Drain any debounced write timer so the file is on disk before we read it. */
function flushStore(s: SeenHostStore) {
  s.flush()
}

test('#4: frequency survives a restart (recreating the store from disk)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-netmon-'))
  try {
    const store = new SeenHostStore(dir)
    store.hit('api.example')
    store.hit('api.example')
    store.hit('api.example')
    flushStore(store)

    // A fresh store over the same dir must see the same stats after re-load.
    const reloaded = new SeenHostStore(dir)
    assert.equal(reloaded.has('api.example'), true)
    assert.equal(reloaded.count('api.example'), 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#4: a host seen before a restart is NOT new-host anymore (via monitor)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-netmon-'))
  try {
    // First "session": host is brand new → 45.
    const m1 = new NetworkMonitor(100, dir)
    assert.equal(m1.record({ method: 'GET', url: 'https://persisted.example/x', reqBytes: 0, resBytes: 10, status: 200, durationMs: 5, tls: true }, 'p').risk, 45)
    m1.flush()

    // Second "session" over the same dir: same host → not new, so 30, not 45.
    const m2 = new NetworkMonitor(100, dir)
    const e = m2.record({ method: 'GET', url: 'https://persisted.example/x', reqBytes: 0, resBytes: 10, status: 200, durationMs: 5, tls: true }, 'p')
    assert.equal(e.risk, 30)
    assert.equal(e.flags.includes('new-host'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#4: clear() wipes the store AND persists the reset to disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-netmon-'))
  try {
    const store = new SeenHostStore(dir)
    store.hit('api.example')
    flushStore(store)
    assert.equal(new SeenHostStore(dir).has('api.example'), true)

    store.clear() // must sync the empty map immediately
    assert.equal(store.has('api.example'), false)
    const reloaded = new SeenHostStore(dir)
    assert.equal(reloaded.has('api.example'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('#4: retention drops hosts not seen within the window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-netmon-'))
  try {
    const store = new SeenHostStore(dir)
    store.hit('stale.example')
    flushStore(store)

    // Backdate the persisted record past the 6-hour retention window, then
    // reload — the store must prune it on load.
    const file = join(dir, 'seen-hosts.json')
    const stale = Date.now() - 12 * 60 * 60 * 1000
    writeFileSync(file, JSON.stringify({ 'stale.example': { count: 1, lastSeen: stale } }))

    const reloaded = new SeenHostStore(dir)
    assert.equal(reloaded.has('stale.example'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── #6 time-based retention ──────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('#6: ring buffer still holds everything when TTL is large', () => {
  const m = new NetworkMonitor(100)
  m.setTtl(3600)
  rec(m)
  rec(m)
  rec(m)
  const snap = m.snapshot()
  assert.equal(snap.length, 3)
})

test('#6: entries past the TTL window are evicted from snapshot', async () => {
  const m = new NetworkMonitor(100)
  m.setTtl(0.08) // 80 ms — evict anything older
  rec(m)
  await sleep(120)
  rec(m) // fresh relative to now
  const snap = m.snapshot()
  // Only the entry recorded after the wait survives.
  assert.equal(snap.length, 1)
})

test('#6: TTL 0 disables time-based eviction (count-only behavior)', async () => {
  const m = new NetworkMonitor(100)
  m.setTtl(0)
  rec(m)
  await sleep(120)
  rec(m)
  assert.equal(m.snapshot().length, 2)
})

test('#6: alerts() also applies the TTL window', async () => {
  const m = new NetworkMonitor(100)
  m.setTtl(0.08)
  rec(m, { method: 'POST', reqBytes: 2048 }) // risk 70, alerts
  await sleep(120)
  const fresh = rec(m, { method: 'POST', reqBytes: 2048 }) // risk 70, alerts
  const al = m.alerts(55)
  assert.equal(al.length, 1)
  assert.equal(al[0].seq, fresh.seq)
})

// ── #3 native http/https tracer ──────────────────────────────────────────
test('#3: installHttpTracer wraps then restores node:http.request', () => {
  const orig = nodeHttp.request
  const disposer = installHttpTracer()
  assert.notEqual(nodeHttp.request, orig, 'request should be patched while installed')
  assert.equal(typeof disposer, 'function')
  disposer()
  assert.equal(nodeHttp.request, orig, 'request should be restored after dispose')
})

test('#3: a real native http request still completes under the tracer', async () => {
  const server = nodeHttp.createServer((_req, res) => {
    res.setHeader('content-length', '5')
    res.end('hello')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  const disposer = installHttpTracer()
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const req = nodeHttp.request({ host: '127.0.0.1', port, path: '/x', method: 'GET' }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(data))
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(body, 'hello')
  } finally {
    disposer()
    await new Promise<void>((r) => server.close(() => r()))
  }
})

// ── #7 AsyncLocalStorage plugin attribution ──────────────────────────────
test('#7: withPluginContext seeds the attribution for a synchronous call', () => {
  const got = withPluginContext('my-plugin', () => resolvePluginId())
  assert.equal(got, 'my-plugin')
})

test('#7: attribution survives await inside the wrapped callback', async () => {
  const got = await withPluginContext('my-plugin', async () => {
    await sleep(10)
    return resolvePluginId()
  })
  assert.equal(got, 'my-plugin')
})

test('#7: nested context wins over an outer one (innermost plugin is caller)', () => {
  const got = withPluginContext('outer', () => withPluginContext('inner', () => resolvePluginId()))
  assert.equal(got, 'inner')
  // Returning to the outer scope restores the outer id.
  assert.equal(withPluginContext('outer', () => {
    withPluginContext('inner', () => resolvePluginId())
    return resolvePluginId()
  }), 'outer')
})

// ── #9 strict host-whitelist canonicalisation ────────────────────────────
const HOST_OK: Array<[string, string]> = [
  ['example.com', 'example.com'],
  ['API.example.COM', 'api.example.com'],          // case → lowercase
  ['sub.example.com', 'sub.example.com'],
  ['https://example.com', 'example.com'],          // scheme prefix stripped
  ['http://example.com', 'example.com'],
  ['example.com:8080', 'example.com:8080'],        // port preserved
  ['example.com:443', 'example.com:443'],
  ['127.0.0.1', '127.0.0.1'],
  ['localhost', 'localhost'],
  ['[::1]', '[::1]'],
  ['a-b.c-d.example.com', 'a-b.c-d.example.com'],
]

const HOST_BAD: string[] = [
  '',
  '   ',
  'example.com/path',         // path
  'https://example.com/foo',  // path + scheme
  'https://example.com?x=1',  // query
  'https://example.com#frag', // fragment
  'user@example.com',         // userinfo
  'user:pass@example.com',    // userinfo
  'ftp://example.com',        // non-http scheme
  'example.com:99999',        // port > 65535
  'example.com:-1',           // negative port
  'example.com:abc',          // non-numeric port
  '-bad.example.com',         // leading hyphen
  'bad-.example.com',         // trailing hyphen
  '.example.com',             // leading dot
  'exa mple.com',             // space
  'exa_mple.com',             // underscore (not a DNS label)
  'http://.example.com',      // empty label / bad hostname
  123,                        // not a string
  null,
]

test('#9: canonicalises valid bare hosts into the scorer\u2019s form', () => {
  for (const [input, expected] of HOST_OK) {
    assert.equal(_canonicalHost(input), expected, `input=${JSON.stringify(input)}`)
  }
})

test('#9: rejects malformed / non-bare-host input outright', () => {
  for (const input of HOST_BAD) {
    assert.equal(_canonicalHost(input), null, `input=${JSON.stringify(input)}`)
  }
})

// The security point: what the scorer trusts must match what was stored, so a
// user's "trust example.com" actually suppresses alerts for the real host.
test('#9: canonical form equals the host the scorer derives from a real URL', () => {
  const canonical = _canonicalHost('https://API.example.com')
  assert.equal(canonical, 'api.example.com')
  assert.equal(new URL('https://API.example.com').host, canonical)
  // With a port, the preserved `:port` must also line up.
  assert.equal(_canonicalHost('https://sub.example.com:8443'), new URL('https://sub.example.com:8443').host)
})

// ── #10 per-instance (ctx-scoped) audit state ────────────────────────────
test('#10: mkRuntime() returns a fresh, independent instance every call', () => {
  const a = mkRuntime()
  const b = mkRuntime()
  assert.notEqual(a, b)
  // Distinct monitor/restorer slots: populating one never leaks into the other
  // (the old module-level singletons shared these across every apply()).
  assert.equal(a.monitor, null)
  assert.equal(b.monitor, null)
  a.monitor = new NetworkMonitor(10)
  assert.ok(a.monitor instanceof NetworkMonitor)
  assert.equal(b.monitor, null, 'a second apply() must not see the first\u2019s monitor')
  a.restoreFetch = () => {}
  a.restoreHttp = () => {}
  a.endpoints = ['api.example.com']
  assert.equal(b.restoreFetch, null)
  assert.equal(b.restoreHttp, null)
  assert.deepEqual(b.endpoints, [])
})

// ── #2 transparent-network-lib stack attribution ─────────────────────────
// The stack string is built with the deepest (throw site) frame first, so the
// caller-most plugin frame appears last — exactly how real V8 stack traces read.
test('#2: transparent libs are skipped; the real plugin frame wins', () => {
  const stack = [
    '    at dispatchReq (/proj/node_modules/undici/lib/dispatcher.js:1:1)',
    '    at NodeHttp2Client (/proj/node_modules/axios/lib/client.js:1:1)',
    '    at spawn (/proj/node_modules/follow-redirects/index.js:1:1)',
    '    at myExport (/proj/node_modules/dsh-plugin-scraper/lib/index.js:1:1)',
  ].join('\n')
  assert.equal(_pluginIdFromStackText(stack), 'dsh-plugin-scraper')
})

test('#2: caller frames right after a transparent lib reduce to the plugin', () => {
  const stack = [
    '    at wrap (/proj/node_modules/undici/lib/fetch/index.js:1:1)',
    '    at invoke (/proj/node_modules/ws/lib/websocket.js:1:1)',
    '    at connect (/proj/node_modules/dsh-plugin-realtime/index.js:1:1)',
  ].join('\n')
  assert.equal(_pluginIdFromStackText(stack), 'dsh-plugin-realtime')
})

test('#2: only transparent libs (no plugin frame) resolve to unknown', () => {
  const stack = [
    '    at dispatchReq (/proj/node_modules/undici/lib/dispatcher.js:1:1)',
    '    at NodeHttp2Client (/proj/node_modules/axios/lib/client.js:1:1)',
  ].join('\n')
  assert.equal(_pluginIdFromStackText(stack), null)
})

test('#2: scoped plugins keep their full @scope/name identity', () => {
  const stack = [
    '    at wrap (/proj/node_modules/undici/lib/fetch/index.js:1:1)',
    '    at handler (/proj/node_modules/@michengai/dsh-archive-manager/lib/index.js:1:1)',
  ].join('\n')
  assert.equal(_pluginIdFromStackText(stack), '@michengai/dsh-archive-manager')
})

test('#2: @types and isolated scope dirs are never treated as callers', () => {
  const stack = [
    '    at wrap (/proj/node_modules/undici/lib/fetch/index.js:1:1)',
    '    at barrel (/proj/node_modules/@types/node/index.d.ts:1:1)',
    '    at action (/proj/node_modules/dsh-plugin-jobs/index.js:1:1)',
  ].join('\n')
  assert.equal(_pluginIdFromStackText(stack), 'dsh-plugin-jobs')
})

test('#2: case of a transparent lib vs plugin is normalized for matching', () => {
  // AXios uppercase on disk is still recognised as the transparent lib.
  const stack = [
    '    at dispatch (/proj/node_modules/AXIOS/lib/client.js:1:1)',
    '    at run (/proj/node_modules/dsh-plugin-x/lib/index.js:1:1)',
  ].join('\n')
  assert.equal(_pluginIdFromStackText(stack), 'dsh-plugin-x')
})
