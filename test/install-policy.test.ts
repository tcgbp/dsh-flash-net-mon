// Guard the install policy, not the plugin's logic.
//
// `dsh-flash` is an OPTIONAL peer on purpose: the fetcher tracer must not pull a
// panel dependency it never imports (CHANGELOG 0.1.0). pnpm 12 quietly reverses
// that — it runs an install before EVERY command, and once a pnpm-workspace.yaml
// exists it stops reading `auto-install-peers` from `.npmrc`, so the lockfile gets
// rewritten to `autoInstallPeers: true` with dsh-flash resolved as a real peer.
// That is a silent dependency change hiding inside `pnpm typecheck`.
//
// These assertions fail on that drift, whichever file regresses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(at(rel), 'utf8')

test('the lockfile keeps peers out of the install', () => {
  const lock = read('../pnpm-lock.yaml')
  const setting = lock.match(/^\s{2}autoInstallPeers:\s*(\S+)\s*$/m)
  assert.ok(setting, 'pnpm-lock.yaml declares no autoInstallPeers setting')
  assert.equal(
    setting[1],
    'false',
    'pnpm rewrote autoInstallPeers to true — a peer got installed. Restore the ' +
      'setting in pnpm-workspace.yaml (and .npmrc), then `git checkout pnpm-lock.yaml`.',
  )
})

test('dsh-flash is not resolved into the lockfile as an installed peer', () => {
  const lock = read('../pnpm-lock.yaml')
  // `specifier` + `version` under importers means pnpm resolved and installed it.
  assert.doesNotMatch(
    lock,
    /^\s{6}dsh-flash:\s*$/m,
    'dsh-flash was resolved into the lockfile — the optional peer is being installed',
  )
})

test('the peer settings agree across both config files', () => {
  const npmrc = read('../.npmrc')
  const workspace = read('../pnpm-workspace.yaml')
  // pnpm <= 10 reads .npmrc; pnpm 12 reads pnpm-workspace.yaml. Both must say no.
  assert.match(npmrc, /^auto-install-peers=false\s*$/m, '.npmrc lost auto-install-peers=false')
  assert.match(workspace, /^autoInstallPeers:\s*false\s*$/m, 'pnpm-workspace.yaml lost autoInstallPeers: false')
})

test('dsh-flash stays declared as an OPTIONAL peer', () => {
  const pkg = JSON.parse(read('../package.json'))
  assert.ok(pkg.peerDependencies?.['dsh-flash'], 'dsh-flash must stay a peer dependency')
  assert.equal(
    pkg.peerDependenciesMeta?.['dsh-flash']?.optional,
    true,
    'dsh-flash must stay optional — the tracer must not depend on the panel',
  )
})
