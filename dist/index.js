import Schema from '@deepseek-ai/schemastery';
export const name = 'dsh-flash-net-mon';
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
export function apply(ctx, config) {
    ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
    });
}
