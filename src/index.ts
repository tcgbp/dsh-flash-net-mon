// dsh-flash-net-mon — HOST half of the network monitor / outbound audit provider.
//
// This package will carry subsystem C (network audit: fetch tracer, NetworkMonitor,
// resolvePluginId, reconfigureAudit, /network-log, /network-alerts,
// /network-whitelist, /network-plugin-whitelist, netAuditEnabled master switch)
// plus the network-heartbeat alert provider (createNetworkAlertProvider) and the
// /net-* configuration modal in Task 2.
//
// This task scaffolds an empty, loadable skeleton only: it registers the 'net-mon'
// settings namespace (the network-audit field group) and lays down the settings
// wiring. No audit logic ships yet.
//
// This half is ESM (`"type": "module"`, and DSH's own entry is ESM too), so
// `require` does not exist here — every host dependency is a static import
// declared in package.json.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-flash-net-mon'
export const inject: string[] = []

/** Network Monitor defaults — mirrored from dock-flash src/index.ts. */
const DEFAULT_NET_SLOW_THRESHOLD = 5000
const DEFAULT_NET_POLL_BASE = 60000
const DEFAULT_NET_POLL_MIN = 10000
const DEFAULT_NET_LOG_CAP = 300
const DEFAULT_NET_SUSPECT_WARN = 40
const DEFAULT_NET_SUSPECT_ERR = 70
const DEFAULT_NET_AUDIT_ENABLED = false

/** Resolved volatile config — each field is a live reference read with .get(). */
export interface NetMonConfig {
  netAuditEnabled: Volatile<boolean>
  netLogCap: Volatile<number>
  netSuspectWarn: Volatile<number>
  netSuspectErr: Volatile<number>
  netWhitelist: Volatile<string[]>
  netPluginWhitelist: Volatile<string[]>
  netSlowThreshold: Volatile<number>
  netPollBase: Volatile<number>
  netPollMin: Volatile<number>
}

export const Config = Schema.object({
  netAuditEnabled: Schema.boolean().default(DEFAULT_NET_AUDIT_ENABLED).volatile(),
  netLogCap: Schema.number().default(DEFAULT_NET_LOG_CAP).volatile(),
  netSuspectWarn: Schema.number().default(DEFAULT_NET_SUSPECT_WARN).volatile(),
  netSuspectErr: Schema.number().default(DEFAULT_NET_SUSPECT_ERR).volatile(),
  netWhitelist: Schema.array(String).default([] as string[]).volatile(),
  netPluginWhitelist: Schema.array(String).default([] as string[]).volatile(),
  netSlowThreshold: Schema.number().default(DEFAULT_NET_SLOW_THRESHOLD).volatile(),
  netPollBase: Schema.number().default(DEFAULT_NET_POLL_BASE).volatile(),
  netPollMin: Schema.number().default(DEFAULT_NET_POLL_MIN).volatile(),
})

export function apply(ctx: Context, config: NetMonConfig) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
