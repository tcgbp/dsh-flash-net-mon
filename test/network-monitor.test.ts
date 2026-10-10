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
import { NetworkMonitor } from '../dist/index.js'

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

test('unknown host, first contact: baseline 30 + new-host 5 = 35, normal', () => {
  const m = new NetworkMonitor(100)
  const e = rec(m)
  assert.equal(e.risk, 35)
  assert.ok(e.flags.includes('unknown-host'))
  assert.ok(e.flags.includes('new-host'))
})

test('same unknown host on 3rd call gains high-frequency (+15 → 45)', () => {
  const m = new NetworkMonitor(100)
  assert.equal(rec(m).risk, 35) // 1st: new-host
  assert.equal(rec(m).risk, 30) // 2nd: plain unknown
  assert.equal(rec(m).risk, 45) // 3rd: high-frequency
})

test('large upload (+25) alerts on its own with a new host (60)', () => {
  const m = new NetworkMonitor(100)
  const e = rec(m, { method: 'POST', reqBytes: 2048 })
  assert.equal(e.risk, 60)
  assert.ok(e.flags.includes('large-upload'))
})

test('plaintext (+20) alerts with a new host (55)', () => {
  const m = new NetworkMonitor(100)
  const e = rec(m, { url: 'http://unknown-evil.example/', tls: false })
  assert.equal(e.risk, 55)
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
  // a) trusted → 0; b) and c) unknown first contacts → 35 each.
  const a = rec(m, { url: 'https://trusted.example/' })
  const b = rec(m, { url: 'https://one.example/' })
  const c = rec(m, { url: 'https://two.example/' })
  assert.equal(a.risk, 0)
  assert.equal(b.risk, 35)
  assert.equal(c.risk, 35)
  assert.equal(m.snapshot().length, 2)
  assert.equal(m.snapshot()[0].seq, b.seq) // a (oldest) was dropped
  assert.equal(m.snapshot()[1].seq, c.seq) // newest kept
  // Risk >= 30: both b and c qualify (a, at 0, is out and already dropped).
  assert.equal(m.alerts(30).length, 2)
  // Risk >= 40: none does.
  assert.equal(m.alerts(40).length, 0)
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
