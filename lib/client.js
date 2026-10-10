// dsh-flash-net-mon — BROWSER half of the network monitor / outbound audit provider.
//
// Migrated from dock-flash/lib/client.js (subsystem C):
// - createNetworkAlertProvider() (original :4779-4877)
// - createNetworkAuditProvider() (original :4889-4985)
// - NetworkAuditPanel (original :6405-6905)
// - MonitorConfigModal (network-specific, original :7048-7141)
// - renderRiskAlgo() (original :6989-7045)
// - Network monitor toggle entry from _MONITOR_TOGGLES (original :10374)
// - Network monitor entry from _monitorEntries (original :13341)
// - i18n keys for network audit
// - Preference system: loadNetPrefs(), _netPrefs, _ALERT_DEFAULTS
//
// Provider IDs changed:
//   dock-flash:network-alert  → dsh-flash-net-mon:network-alert
//   dock-flash:network-audit  → dsh-flash-net-mon:network-audit
//   dock-flash:monitor-network → dsh-flash-net-mon:monitor-network
//
// Route URLs changed:
//   /plugins/dock-flash/network-log         → /plugins/dsh-flash-net-mon/network-log
//   /plugins/dock-flash/network-alerts      → /plugins/dsh-flash-net-mon/network-alerts
//   /plugins/dock-flash/network-whitelist   → /plugins/dsh-flash-net-mon/network-whitelist
//   /plugins/dock-flash/network-plugin-whitelist → /plugins/dsh-flash-net-mon/network-plugin-whitelist
//
// K6: Heartbeat URL stays as /plugins/dock-flash/health — that route belongs
//     to dock-flash and the net-mon heartbeat provider polls it.
//
// Preferences: reads/writes the 'dsh-flash-net-mon' settings namespace instead of 'dock-flash'.

window.__ModuleLoader__.load({
  id: 'dsh-flash-net-mon',
  factory: (require) => {

    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef
    var Component = React.Component
    var ReactDOMClient = null
    try { ReactDOMClient = require('react-dom/client') } catch (_) {}

    // ═══════════════════════════════════════════════════════════════════════
    //#region i18n ────────────────────────────────────────────────────────────

    var zh = {
      alertNetCluster: '网络监控',
      monitorOn: '已开启',
      monitorOff: '已关闭',
      monitorConfig: '配置',
      alertNetworkSlow: '网络延迟较高 ({d}ms)',
      alertNetworkTimeout: '网络连接超时',
      netSlowThreshold: '慢速阈值',
      netPollBase: '轮询基础间隔',
      netPollMin: '轮询最小间隔',
      netLogCap: '日志容量',
      netSuspectWarn: '可疑阈值',
      netSuspectErr: '危险阈值',
      netWhitelistLabel: '可信域名',
      netAuditEnabled: '启用网络审计',
      // Network audit panel
      netAuditTitle: '网络审计',
      netAuditStream: '请求流',
      netAuditAlerts: '告警',
      netAuditWhitelist: '白名单',
      netAuditEmpty: '暂无出站请求',
      netAuditNoAlerts: '暂无告警',
      netAuditPlugin: '插件',
      netAuditHost: '主机',
      netAuditMethod: '方法',
      netAuditPath: '路径',
      netAuditReqSize: '请求大小',
      netAuditResSize: '响应大小',
      netAuditStatus: '状态',
      netAuditDuration: '耗时',
      netAuditTls: 'TLS',
      netAuditRisk: '风险',
      netAuditFlags: '标记',
      netAuditTimestamp: '时间',
      netAuditFilterPlugin: '筛选插件',
      netAuditFilterRisk: '筛选风险',
      netAuditAllPlugins: '全部插件',
      netAuditRiskNone: '正常',
      netAuditRiskSuspect: '可疑',
      netAuditRiskDanger: '危险',
      netAuditAddHostWhitelist: '加主机白名单',
      netAuditAddPluginWhitelist: '加插件白名单',
      netAuditWhitelistHint: '可信主机将不再触发告警',
      netAuditConfirmWhitelist: '确认将 {host} 加入白名单？',
      netAuditWlViewHosts: '主机',
      netAuditWlViewPlugins: '插件',
      netAuditPluginWhitelistHint: '可信插件发起的请求将不再触发告警（仍会记录日志）',
      netAuditEmptyPlugins: '暂无插件白名单条目',
      netAuditUnknownPlugin: '未知插件',
      // Whitelist helpers: one-click suggestions, the read-only auto-trusted
      // section, and the plugin picker built from the log.
      netAuditSuggestTitle: '常见服务（一键加入）',
      netAuditSuggestHint: '只提供精确主机名，且不含内容托管域名（github.io、*.s3.amazonaws.com 等）——信任那些等于对所有第三方内容放行。',
      netAuditSuggestAdded: '已添加',
      netAuditAutoTitle: '自动信任（只读）',
      netAuditAutoHint: '内置主机与 DSH 已配置的 API 端点始终按可信处理，不触发告警；它们由代码或你的 provider 配置决定，不能在这里移除。',
      netAuditAutoBuiltin: '内置',
      netAuditAutoEndpoint: '已配置端点',
      netAuditAutoNone: '暂时没有自动信任的主机',
      netAuditObservedTitle: '日志中出现过的插件',
      netAuditObservedHint: '点「信任」即加入白名单；该插件发起的请求不再告警（仍会记录日志）。',
      netAuditObservedEmpty: '日志中还没有插件记录',
      netAuditTrustBtn: '信任',
      netAuditTrustedTag: '已信任',
      netAuditPluginManualTitle: '手动添加插件',
      netAuditPluginManualHint: '填 package.json 里的包名，例如 dsh-cost-meter。',
      netAuditAdd: '添加',
      netAuditPluginUnknownNote: 'unknown 表示无法归属到具体插件，不能加入白名单。',
      netAuditFlagUnknownHost: '未知主机',
      netAuditFlagNewHost: '新主机',
      netAuditFlagLargeUpload: '大体积上传',
      netAuditFlagPlaintext: '明文传输',
      netAuditFlagHighFreq: '高频访问',
      netAuditFlagRelativeUrl: '非绝对地址',
      netAuditFlagRedirectedHost: '重定向到不受信主机',
      netAuditRedirectedTo: '重定向目标',
      netAuditPaused: '已暂停',
      netAuditResume: '继续',
      netAuditPause: '暂停',
      netAuditClear: '清空',
      netAuditBadge: '审计',
      netAuditAutoScroll: '自动滚动',
      netAuditDetails: '详情',
      netAuditCollapse: '收起',
      netAuditPagePrev: '上一页',
      netAuditPageNext: '下一页',
      netAuditPageInfo: '第 {cur} / {total} 页（共 {count} 条）',
      // Risk scoring algorithm explanation
      netRiskAlgoTitle: '风险评分算法',
      netRiskAlgoToggle: '查看详情',
      netRiskAlgoHide: '收起',
      netRiskAlgoIntro: '每次出站请求都会获得一个 0–100 的风险分，用于判断它是可信、可疑还是危险。',
      netRiskAlgoBase: '未知主机',
      netRiskAlgoBaseDesc: '请求目标不在可信主机 / 插件白名单中。',
      netRiskAlgoFactorNew: '首次访问该主机（频次表已持久化，重启后见过的主机不再算首次）',
      netRiskAlgoFactorUpload: '大体积上传（POST/PUT/PATCH 且请求体 > 1 KB）',
      netRiskAlgoFactorPlaintext: '明文传输（非 TLS）',
      netRiskAlgoFactorFreq: '高频访问（同一未知主机已出现 ≥3 次）',
      netRiskAlgoCap: '分数上限',
      netRiskAlgoCapDesc: '得分累加后最高为 100。',
      netRiskAlgoTrusted: '可信主机 / 可信插件',
      netRiskAlgoTrustedDesc: '直接判定为「正常」，不产生任何风险标记。',
      netRiskAlgoLevels: '风险分级（由上方两个阈值决定）',
      netRiskAlgoLevelNormal: '正常',
      netRiskAlgoLevelWarn: '可疑',
      netRiskAlgoLevelErr: '危险',
    }

    var en = {
      alertNetCluster: 'Network Monitor',
      monitorOn: 'Enabled',
      monitorOff: 'Disabled',
      monitorConfig: 'Configure',
      alertNetworkSlow: 'Network latency high ({d}ms)',
      alertNetworkTimeout: 'Network connection timeout',
      netSlowThreshold: 'Slow Threshold',
      netPollBase: 'Poll Base Interval',
      netPollMin: 'Poll Min Interval',
      netLogCap: 'Log Capacity',
      netSuspectWarn: 'Suspect Threshold',
      netSuspectErr: 'Danger Threshold',
      netWhitelistLabel: 'Trusted Hosts',
      netAuditEnabled: 'Enable Network Audit',
      // Network audit panel
      netAuditTitle: 'Network Audit',
      netAuditStream: 'Request Stream',
      netAuditAlerts: 'Alerts',
      netAuditWhitelist: 'Whitelist',
      netAuditEmpty: 'No outbound requests yet',
      netAuditNoAlerts: 'No alerts',
      netAuditPlugin: 'Plugin',
      netAuditHost: 'Host',
      netAuditMethod: 'Method',
      netAuditPath: 'Path',
      netAuditReqSize: 'Req Size',
      netAuditResSize: 'Res Size',
      netAuditStatus: 'Status',
      netAuditDuration: 'Duration',
      netAuditTls: 'TLS',
      netAuditRisk: 'Risk',
      netAuditFlags: 'Flags',
      netAuditTimestamp: 'Timestamp',
      netAuditFilterPlugin: 'Filter by plugin',
      netAuditFilterRisk: 'Filter by risk',
      netAuditAllPlugins: 'All plugins',
      netAuditRiskNone: 'Normal',
      netAuditRiskSuspect: 'Suspect',
      netAuditRiskDanger: 'Dangerous',
      netAuditAddHostWhitelist: 'Add host to whitelist',
      netAuditAddPluginWhitelist: 'Add plugin to whitelist',
      netAuditWhitelistHint: 'Trusted hosts will no longer trigger alerts',
      netAuditConfirmWhitelist: 'Add {host} to whitelist?',
      netAuditWlViewHosts: 'Hosts',
      netAuditWlViewPlugins: 'Plugins',
      netAuditPluginWhitelistHint: 'Requests from trusted plugins will no longer trigger alerts (still logged)',
      netAuditEmptyPlugins: 'No plugin whitelist entries',
      netAuditUnknownPlugin: 'Unknown plugin',
      // Whitelist helpers: one-click suggestions, the read-only auto-trusted
      // section, and the plugin picker built from the log.
      netAuditSuggestTitle: 'Common services (one click)',
      netAuditSuggestHint: 'Exact hostnames only, and never a host that serves user content (github.io, *.s3.amazonaws.com, …) — trusting one of those would open the audit to every third-party payload fetched through it.',
      netAuditSuggestAdded: 'Added',
      netAuditAutoTitle: 'Auto-trusted (read-only)',
      netAuditAutoHint: 'Built-in hosts and the API endpoints configured in DSH are always treated as trusted and never alert; they come from code or your provider configuration and cannot be removed here.',
      netAuditAutoBuiltin: 'Built-in',
      netAuditAutoEndpoint: 'Configured endpoint',
      netAuditAutoNone: 'No auto-trusted hosts yet',
      netAuditObservedTitle: 'Plugins seen in the log',
      netAuditObservedHint: 'Click Trust to whitelist a plugin; its requests stop alerting (still logged).',
      netAuditObservedEmpty: 'No plugins in the log yet',
      netAuditTrustBtn: 'Trust',
      netAuditTrustedTag: 'Trusted',
      netAuditPluginManualTitle: 'Add a plugin manually',
      netAuditPluginManualHint: 'Use the package name from package.json, e.g. dsh-cost-meter.',
      netAuditAdd: 'Add',
      netAuditPluginUnknownNote: 'unknown means the caller could not be attributed to a plugin; it cannot be whitelisted.',
      netAuditFlagUnknownHost: 'Unknown host',
      netAuditFlagNewHost: 'New host',
      netAuditFlagLargeUpload: 'Large upload',
      netAuditFlagPlaintext: 'Plaintext',
      netAuditFlagHighFreq: 'High frequency',
      netAuditFlagRelativeUrl: 'Relative URL',
      netAuditFlagRedirectedHost: 'Redirected to untrusted host',
      netAuditRedirectedTo: 'Redirect target',
      netAuditPaused: 'Paused',
      netAuditResume: 'Resume',
      netAuditPause: 'Pause',
      netAuditClear: 'Clear',
      netAuditBadge: 'Audit',
      netAuditAutoScroll: 'Auto-scroll',
      netAuditDetails: 'Details',
      netAuditCollapse: 'Collapse',
      netAuditPagePrev: 'Prev',
      netAuditPageNext: 'Next',
      netAuditPageInfo: 'Page {cur} / {total} ({count} entries)',
      // Risk scoring algorithm explanation
      netRiskAlgoTitle: 'Risk Scoring Algorithm',
      netRiskAlgoToggle: 'View details',
      netRiskAlgoHide: 'Collapse',
      netRiskAlgoIntro: 'Every outbound request receives a 0–100 risk score that decides whether it is trusted, suspicious, or dangerous.',
      netRiskAlgoBase: 'Unknown host',
      netRiskAlgoBaseDesc: 'The request target is not on the trusted-host / trusted-plugin whitelist.',
      netRiskAlgoFactorNew: 'First time hitting this host (frequency is persisted; hosts seen before a restart are not "new" again)',
      netRiskAlgoFactorUpload: 'Large upload (POST/PUT/PATCH with a body > 1 KB)',
      netRiskAlgoFactorPlaintext: 'Plaintext transport (non-TLS)',
      netRiskAlgoFactorFreq: 'High frequency (same unknown host seen ≥3 times)',
      netRiskAlgoCap: 'Score cap',
      netRiskAlgoCapDesc: 'The accumulated score is capped at 100.',
      netRiskAlgoTrusted: 'Trusted host / trusted plugin',
      netRiskAlgoTrustedDesc: 'Rated "Normal" directly, with no risk flags.',
      netRiskAlgoLevels: 'Risk levels (decided by the two thresholds above)',
      netRiskAlgoLevelNormal: 'Normal',
      netRiskAlgoLevelWarn: 'Suspicious',
      netRiskAlgoLevelErr: 'Dangerous',
    }

    var LOCALES = { zh: zh, en: en }

    /** Read the current BCP-47 tag from <html lang> (or navigator fallback). */
    function detectLocaleTag() {
      try {
        var tag = document.documentElement.lang
        if (tag) return tag
      } catch (_) {}
      try { return navigator.language || 'en' } catch (_) { return 'en' }
    }

    /** Map a BCP-47 tag to one of our locale keys ('zh' | 'en'). */
    function resolveLocaleKey(tag) {
      var lower = (tag || '').toLowerCase()
      if (lower.startsWith('zh')) return 'zh'
      return 'en'
    }

    var _currentLocaleKey = resolveLocaleKey(detectLocaleTag())

    /** Observe <html lang> changes so the UI updates on language switch. */
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      try {
        var _langObserver = new MutationObserver(function () {
          var next = resolveLocaleKey(detectLocaleTag())
          if (next !== _currentLocaleKey) _currentLocaleKey = next
        })
        _langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
      } catch (_) {}
    }

    /** i18n lookup — returns the string for the current locale. */
    function t(key) {
      var locale = LOCALES[_currentLocaleKey] || LOCALES.en
      return locale[key] !== undefined ? locale[key] : (LOCALES.en[key] !== undefined ? LOCALES.en[key] : key)
    }

    /** Functional label helper — returns a function that calls t() so the label updates on locale change. */
    function L(key) {
      return function () { return t(key) }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Icon helpers ────────────────────────────────────────────────────

    var _ICON_PATHS = {
      bolt:    ['M9 2 3.5 9H8l-1 5 5.5-7H8l1-5z'],
      signal:  ['M3.2 11.6a6.8 6.8 0 0 1 9.6 0M5.6 9.2a4.2 4.2 0 0 1 4.8 0M8 6.8c.6 0 1.2.2 1.6.5M8 13a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z'],
      shield:  ['M8 2 3 3.8v3.5c0 3.7 2.2 6.1 5 6.7 2.8-.6 5-3 5-6.7V3.8z', 'M6.2 8.1l1.2 1.2 2.4-2.6'],
      plus:    ['M8 3.5v9M3.5 8h9'],
      pause:   ['M5.5 3.5h2.2v9H5.5zM8.3 3.5h2.2v9H8.3z'],
      scroll:  ['M5 3.2h6M5 8h6M5 12.8h4', 'M12.4 3.6l1.4 1.4-1.4 1.4M12.4 8l1.4 1.4-1.4 1.4'],
    }

    function _switchIcon(icon, style) {
      var paths = typeof icon === 'string' ? _ICON_PATHS[icon] : null
      if (!paths) return h('span', { style: style }, icon)
      return h('span', { style: style, 'aria-hidden': 'true' },
        h('svg', {
          width: 12, height: 12, viewBox: '0 0 16 16',
          fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
          style: { display: 'block', margin: 'auto', color: 'currentColor' },
        }, paths.map(function (d, i) {
          return h('path', { key: i, d: d, stroke: 'currentColor', strokeWidth: 1.4,
            strokeLinecap: 'round', strokeLinejoin: 'round' })
        }))
      )
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region ErrorBoundary ──────────────────────────────────────────────────

    class PanelErrorBoundary extends Component {
      constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error: error }
      }
      componentDidCatch(error, info) {
        console.error('[dsh-flash-net-mon] Panel render error (caught by boundary):', error, info)
      }
      render() {
        if (this.state.hasError) {
          return h('div', {
            style: {
              padding: '12px 16px',
              color: 'var(--dsw-alias-label-secondary, #8b949e)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: '12px',
            },
          },
            h('div', { style: { marginBottom: '6px', color: 'var(--dsw-alias-label-warning, #d29922)' } },
              '⚠ net-mon render error'),
            h('div', null, String(this.state.error && this.state.error.message || this.state.error || 'Unknown error')),
            h('button', {
              style: {
                marginTop: '8px',
                padding: '2px 10px',
                fontSize: '11px',
                cursor: 'pointer',
                borderRadius: '4px',
                border: '1px solid var(--dsw-alias-border-l2, #21262d)',
                background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.85))',
                color: 'var(--dsw-alias-label-primary, #c9d1d9)',
              },
              onClick: function () { this.setState({ hasError: false, error: null }) }.bind(this),
            }, 'Retry'),
          )
        }
        return this.props.children
      }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Styles ─────────────────────────────────────────────────────────

    var R = {
      xs: 'var(--dsw-radius-xs, 4px)',
      sm: 'var(--dsw-radius-sm, 8px)',
      md: 'var(--dsw-radius-md, 12px)',
      lg: 'var(--dsw-radius-lg, 16px)',
      xl: 'var(--dsw-radius-xl, 20px)',
      panel: 'var(--dsw-radius-panel, 28px)',
    }
    var E = {
      prominent: 'var(--dsw-elevation-prominent, 0 0 0 0.5px var(--dsw-alias-border-l4, #0003), 0 3px 8px 0 rgba(0,0,0,.04), 0 0 20px 0 rgba(0,0,0,.05))',
    }

    var S = {
      // Switch row / slider (used by MonitorConfigModal)
      switchRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
      },
      switchLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: '120px',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      switchIcon: {
        display: 'inline-flex',
        verticalAlign: '-2px',
        marginRight: '2px',
      },
      sliderRow: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        marginBottom: '8px',
      },
      slider: {
        flex: 1,
        minWidth: 0,
      },
      value: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        minWidth: '42px',
        textAlign: 'right',
      },
      // Monitor config modal
      monitorModalMask: {
        position: 'fixed',
        inset: 0,
        zIndex: 2200,
        background: 'var(--dsw-alias-bg-mask-1, #0000003d)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      monitorModal: {
        background: 'var(--dsw-alias-bg-layer-2, #fff)',
        border: 0,
        borderRadius: R.panel,
        width: '90vw',
        maxWidth: '680px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: E.prominent,
      },
      monitorModalHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l2, #0003)',
      },
      monitorModalTitle: {
        fontWeight: 500,
        fontSize: '16px',
        lineHeight: '24px',
        color: 'var(--dsw-alias-label-primary, #000)',
      },
      monitorModalClose: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        border: 0,
        borderRadius: R.sm,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        cursor: 'pointer',
        fontSize: '14px',
        padding: 0,
      },
      monitorModalBody: {
        flex: 1,
        overflowY: 'auto',
        padding: '10px 14px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--dsw-alias-scrollbar-bg-l1, #ccc) var(--dsw-alias-bg-layer-2, transparent)',
      },
      monitorModalDivider: {
        marginTop: '12px',
        paddingTop: '10px',
        borderTop: '0.5px solid var(--dsw-alias-border-l2, #0003)',
      },
      monitorModalSectionTitle: {
        display: 'block',
        fontWeight: 500,
        fontSize: '14px',
        lineHeight: '22px',
        marginBottom: '8px',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
      },
      monitorFieldsGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        columnGap: '16px',
        rowGap: '12px',
      },
      // Risk scoring algorithm explanation
      netRiskAlgoWrap: {
        marginTop: '12px',
        paddingTop: '10px',
        borderTop: '0.5px solid var(--dsw-alias-border-l2, #0003)',
      },
      netRiskAlgoHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        background: 'transparent',
        border: 0,
        padding: '2px 0',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      netRiskAlgoHeadTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontWeight: 600,
        fontSize: '12px',
      },
      netRiskAlgoToggle: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '11px',
        whiteSpace: 'nowrap',
      },
      netRiskAlgoBody: {
        marginTop: '8px',
        padding: '10px 12px',
        background: 'var(--dsw-alias-bg-layer-1, #f5f5f5)',
        borderRadius: R.md,
        fontSize: '12px',
        lineHeight: '1.6',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      netRiskAlgoIntro: {
        marginBottom: '8px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      netRiskAlgoRow: {
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start',
        marginBottom: '6px',
      },
      netRiskAlgoBullet: {
        flex: 'none',
      },
      netRiskAlgoFactor: {
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontWeight: 600,
      },
      netRiskAlgoSub: {
        display: 'block',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      netRiskAlgoLevelsLine: {
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        marginBottom: '4px',
      },
      netRiskAlgoBadgeNormal: {
        color: 'var(--dsw-alias-label-success, #57ab5a)',
        fontWeight: 600,
      },
      netRiskAlgoBadgeWarn: {
        color: 'var(--dsw-alias-label-warning, #c69026)',
        fontWeight: 600,
      },
      netRiskAlgoBadgeErr: {
        color: 'var(--dsw-alias-label-danger, #e5534b)',
        fontWeight: 600,
      },
      netRiskAlgoGroupTitle: {
        fontWeight: 600,
        marginTop: '8px',
        marginBottom: '4px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      // Network Audit panel
      netAuditPanel: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minHeight: 0,
        flex: 1,
      },
      netAuditToolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
        flexWrap: 'wrap',
      },
      netAuditFilterSelect: {
        height: '28px',
        padding: '0 24px 0 8px',
        fontSize: '12px',
        lineHeight: '18px',
        border: '0.5px solid var(--dsw-alias-border-l4, #0003)',
        borderRadius: R.md,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #000)',
        minWidth: 0,
        maxWidth: '130px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 16 16\' fill=\'none\'%3E%3Cpath d=\'M4 6l4 4 4-4\' stroke=\'%238b949e\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
        backgroundSize: '12px',
      },
      netAuditToolbarBtn: {
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: R.xs,
        border: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
        background: 'var(--dsw-alias-bg-layer-3, #f0f0f0)',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        cursor: 'pointer',
        lineHeight: '18px',
      },
      netAuditToolbarBtnActive: {
        background: 'var(--dsw-alias-bg-accent, #3884ff)',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        // The full shorthand, not `borderColor`: assigning the shorthand in one
        // rule and a longhand in another is what made React warn "a style property
        // during rerender when a conflicting property is set" on every sub-tab
        // switch. Same pixels, no mixed pair.
        border: '1px solid transparent',
      },
      auditIcon: {
        display: 'inline-flex',
        verticalAlign: '-2px',
        marginRight: '4px',
      },
      netAuditStreamWrap: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        borderRadius: R.md,
        border: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
        background: 'var(--dsw-alias-bg-base, #fff)',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--dsw-alias-scrollbar-bg-l1, #ccc) var(--dsw-alias-bg-layer-2, transparent)',
      },
      netAuditStreamInner: {
        fontSize: '11px',
        lineHeight: '1.5',
        fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
      },
      netAuditRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
        cursor: 'pointer',
        transition: 'background .1s ease',
      },
      /** The row whose inline detail is open — the detail sits under it, so the
       *  pair has to read as one unit. */
      netAuditRowActive: {
        background: 'var(--dsw-alias-bg-layer-3, #f0f0f0)',
      },
      netAuditCell: {
        flexShrink: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      netAuditCellGrow: {
        flex: '1 1 0',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      netAuditMethodCell: {
        flexShrink: 0,
        width: '36px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        textAlign: 'center',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      netAuditPluginCell: {
        flexShrink: 0,
        maxWidth: '100px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '10px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        opacity: 0.8,
        borderRight: '1px solid var(--dsw-alias-border-l2, #21262d)',
        paddingRight: '6px',
        marginRight: '2px',
      },
      netAuditStatusCell: {
        flexShrink: 0,
        width: '28px',
        textAlign: 'center',
        fontWeight: 600,
      },
      netAuditRiskNone: { color: 'var(--dsw-alias-label-success, #57ab5a)' },
      netAuditRiskSuspect: { color: 'var(--dsw-alias-label-warning, #c69026)' },
      netAuditRiskDanger: { color: 'var(--dsw-alias-label-danger, #e5534b)' },
      netAuditFlagBadge: {
        display: 'inline-block',
        fontSize: '9px',
        lineHeight: '14px',
        padding: '0 4px',
        borderRadius: R.sm,
        background: 'var(--dsw-alias-bg-layer-3, #f0f0f0)',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        border: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
      },
      netAuditEmpty: {
        padding: '24px 12px',
        textAlign: 'center',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '12px',
      },
      // Inline detail — expands UNDER the clicked row, inside the list, so the
      // stream, the toolbar and the config fields above stay visible. It carries
      // only what the row does not already show (the row has method, plugin,
      // host, path, status, risk and duration), laid out as a two-column grid, so
      // a row grows by about four short lines instead of a full field table.
      //
      // This replaced a `position: absolute; inset: 0` overlay. That element's
      // containing block was NOT the audit panel — nothing between it and the
      // modal mask (position: fixed; inset: 0) is positioned — so `inset: 0`
      // resolved against the whole viewport and an opaque background painted over
      // the entire config modal, header and all.
      netAuditDetailInline: {
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
        padding: '6px 8px 8px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
        background: 'var(--dsw-alias-bg-layer-1, #f6f8fa)',
      },
      netAuditDetailTarget: {
        fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
        fontSize: '11px',
        lineHeight: '1.5',
        wordBreak: 'break-all',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      netAuditDetailGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        columnGap: '12px',
        rowGap: '2px',
      },
      netAuditDetailRow: {
        display: 'flex',
        gap: '6px',
        minWidth: 0,
      },
      netAuditDetailLabel: {
        flexShrink: 0,
        width: '56px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      netAuditDetailValue: {
        flex: 1,
        minWidth: 0,
        wordBreak: 'break-all',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      netAuditDetailActions: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        flexWrap: 'wrap',
      },
      netAuditWhitelistWrap: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '6px 0',
      },
      netAuditWhitelistItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 8px',
        fontSize: '12px',
        borderRadius: R.xs,
        background: 'var(--dsw-alias-bg-layer-3, #f0f0f0)',
        border: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
      },
      netAuditWhitelistHost: {
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
        fontSize: '11px',
      },
      netAuditWhitelistRemove: {
        fontSize: '11px',
        padding: '1px 6px',
        borderRadius: R.sm,
        border: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-danger, #e5534b)',
        cursor: 'pointer',
      },
      netAuditWhitelistHint: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      netAuditSectionTitle: {
        marginTop: '6px',
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      netAuditChipRow: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
      },
      netAuditSuggestChip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 8px',
        fontSize: '11px',
        borderRadius: R.xs,
        border: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
        background: 'var(--dsw-alias-bg-layer-3, #f0f0f0)',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        cursor: 'pointer',
      },
      netAuditSuggestChipDone: {
        opacity: 0.55,
        cursor: 'default',
      },
      netAuditSuggestHost: {
        fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
        fontSize: '10px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      netAuditSuggestTag: {
        fontSize: '10px',
        color: 'var(--dsw-alias-label-success, #57ab5a)',
      },
      netAuditChipBtn: {
        fontSize: '10px',
        padding: '1px 6px',
        borderRadius: R.sm,
        border: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        cursor: 'pointer',
      },
      netAuditManualRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      },
      netAuditManualInput: {
        flex: 1,
        minWidth: 0,
        padding: '3px 6px',
        fontSize: '11px',
        fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
        borderRadius: R.xs,
        border: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      netAuditPager: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '6px 0 2px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
      },
      netAuditPagerBtn: {
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: R.sm,
        border: '1px solid var(--dsw-alias-border-l3, #d0d7de)',
        background: 'var(--dsw-alias-bg-layer-3, #f0f0f0)',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        cursor: 'pointer',
        lineHeight: '18px',
      },
      netAuditPagerBtnDisabled: {
        opacity: 0.4,
        cursor: 'default',
        pointerEvents: 'none',
      },
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Net-mon Preferences ────────────────────────────────────────────
    //
    // Net-mon owns its OWN preference namespace ('dsh-flash-net-mon') — it does NOT
    // read from or write to dock-flash's 'dock-flash' namespace.
    // The preference bridge mirrors dock-flash's pattern but is scoped
    // to the 9 net-mon fields only.

    var _ALERT_DEFAULTS = {
      netSlowThreshold: 5000,
      netPollBase: 60000,
      netPollMin: 10000,
      netLogCap: 300,
      netSuspectWarn: 40,
      netSuspectErr: 70,
      netWhitelist: [],
      netPluginWhitelist: [],
      netAuditEnabled: false,
    }

    /** In-memory preferences — populated by loadNetPrefs(). */
    var _netPrefs = null

    /** The plugin context, set in apply(). */
    var _prefCtx = null

    /** Settings namespace for net-mon. */
    var NET_MON_NS = 'dsh-flash-net-mon'

    var _hostRevision = null
    var _prefWriteTail = Promise.resolve()
    var _pendingRevision = null

    function _fenceRevision() {
      if (_pendingRevision !== null) return _pendingRevision
      return _hostRevision === null ? undefined : _hostRevision
    }

    function _remoteSettings(ctx) {
      try {
        if (ctx && ctx.remote && ctx.remote.settings) return ctx.remote.settings
      } catch (e) {
        console.warn('[dsh-flash-net-mon] ctx.remote.settings threw:', e && e.message)
      }
      try {
        var remote = ctx && ctx.get ? ctx.get('remote') : undefined
        if (remote && remote.settings) return remote.settings
      } catch (e) { console.warn('[dsh-flash-net-mon] ctx.get("remote") threw:', e && e.message) }
      // Diagnostic: which piece is missing?
      console.warn('[dsh-flash-net-mon] _remoteSettings: unavailable — ctx=' + !!ctx +
        ' ctx.remote=' + !!(ctx && ctx.remote) +
        ' ctx.remote.settings=' + !!(ctx && ctx.remote && ctx.remote.settings) +
        ' inject=' + JSON.stringify(ctx && ctx.remote && ctx.remote.constructor ? 'proxy' : 'n/a'))
      return undefined
    }

    /** Normalize a `describe()` result into a promise. NEVER let this throw.
     *
     *  Calling `.then` directly on a `describe()` result is not safe: the SAME
     *  method name has two implementations. The typert WIRE form returns a
     *  Promise, but the DIRECT form — `SettingsController.describe()` in
     *  `@deepseek-ai/dsh-api-settings-controller` — is SYNCHRONOUS and returns the
     *  view object itself; and it can THROW instead ("settings service is absent:
     *  mount @deepseek-ai/dsh-settings …"). So `.then` may not exist at all, and
     *  the TypeError is thrown SYNCHRONOUSLY, ahead of any `.catch`.
     *
     *  WHY THAT IS NOT JUST A LOG LINE: `apply()` here is `async` with no internal
     *  try/catch, so the throw becomes a REJECTED apply — the Cordis fiber goes
     *  FAILED and the plugin never activates. Its switches simply never appear:
     *  the "the plugin was registered and then silently disappeared" symptom,
     *  with `TypeError: settings.describe(...).then is not a function` as the
     *  only clue. Verified in dock-flash's check:overlay section 23. */
    function _describeAsync(settings) {
      try { return Promise.resolve(settings.describe()) }
      catch (err) { return Promise.reject(err) }
    }

var _PREFS_MAX_RETRIES = 8
    var _PREFS_RETRY_DELAY_MS = 750

    /**
     * Load net-mon preferences from the 'dsh-flash-net-mon' settings namespace.
     * Mirrors dock-flash's loadHostPreferences but reads the 'dsh-flash-net-mon' namespace
     * and populates _netPrefs with only the 9 net-mon fields.
     */
    function loadNetPrefs(ctx, _retryCount) {
      if (typeof _retryCount !== 'number') _retryCount = 0
      var settings = _remoteSettings(ctx)
      if (!settings) {
        return Promise.resolve(false)
      }
      if (typeof settings.describe !== 'function') {
        return Promise.resolve(false)
      }
      return _describeAsync(settings).then(function (desc) {
        if (!desc) return false
        var view = desc.value || desc
        var list = view && Array.isArray(view.namespaces)
          ? view.namespaces
          : (Array.isArray(view) ? view : null)
        if (!list) return false
        var ns = list.find(function (n) {
          return (n && (n.ns || n.namespace)) === NET_MON_NS
        })
        if (!ns) {
          if (_retryCount < _PREFS_MAX_RETRIES) {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(loadNetPrefs(ctx, _retryCount + 1))
              }, _PREFS_RETRY_DELAY_MS)
            })
          }
          return false
        }
        var resolved = ns.value || ns.resolved
        if (!resolved) return false
        _netPrefs = {
          netSlowThreshold: resolved.netSlowThreshold,
          netPollBase: resolved.netPollBase,
          netPollMin: resolved.netPollMin,
          netLogCap: resolved.netLogCap,
          netSuspectWarn: resolved.netSuspectWarn,
          netSuspectErr: resolved.netSuspectErr,
          netWhitelist: resolved.netWhitelist,
          netPluginWhitelist: resolved.netPluginWhitelist,
          netAuditEnabled: resolved.netAuditEnabled,
        }
        if (typeof ns.revision === 'number') _hostRevision = ns.revision
        console.log('[dsh-flash-net-mon] preferences loaded from ' + NET_MON_NS + ' namespace')
        return true
      }).catch(function () {
        return false
      })
    }

    /** Read an alert preference from _netPrefs, falling back to the built-in default. */
    function _alertPref(key) {
      var v = _netPrefs && _netPrefs[key]
      if (key === 'netWhitelist' || key === 'netPluginWhitelist') {
        return Array.isArray(v) ? v : _ALERT_DEFAULTS[key]
      }
      if (key === 'netAuditEnabled') {
        return typeof v === 'boolean' ? v : _ALERT_DEFAULTS[key]
      }
      return (typeof v === 'number' && isFinite(v)) ? v : _ALERT_DEFAULTS[key]
    }

    /** Write an alert preference through the preference bridge (host + memory). */
    function _writeAlertPref(ctx, key, value, onError) {
      savePrefs(ctx, Object.fromEntries([[key, value]]), null, onError)
    }

    /**
     * Save preferences: update _netPrefs in memory, then serialize a write to
     * the 'dsh-flash-net-mon' settings namespace.
     */
    function savePrefs(ctx, patch, localWrites, onError) {
      var saved = {}
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) saved[k] = _netPrefs && _netPrefs[k]
      if (_netPrefs) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) _netPrefs[k] = patch[k]
      }
      try { if (localWrites) localWrites() } catch (_) {}
      return _queuePrefWrite(ctx, patch, onError, saved)
    }

    function _queuePrefWrite(ctx, patch, onError, saved) {
      var task = _prefWriteTail.then(function () {
        var settings = _remoteSettings(ctx || _prefCtx)
        if (!settings || typeof settings.update !== 'function') {
          if (onError) onError(patch, function () {
            for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _netPrefs[k] = saved[k]
          })
          return false
        }
        return settings.update(NET_MON_NS, patch, _fenceRevision())
          .then(function (res) {
            try {
              if (res && res.ok === false) {
                _pendingRevision = null
                if (onError) onError(patch, function () {
                  for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _netPrefs[k] = saved[k]
                })
                // Re-sync fence
                try {
                  _describeAsync(settings).then(function (desc) {
                    if (desc && desc.ok !== false) {
                      var view2 = desc.value || desc
                      var list2 = view2 && Array.isArray(view2.namespaces)
                        ? view2.namespaces
                        : (Array.isArray(view2) ? view2 : null)
                      var ns2 = list2 && list2.find(function (n) {
                        return (n && (n.ns || n.namespace)) === NET_MON_NS
                      })
                      if (ns2 && typeof ns2.revision === 'number') _hostRevision = ns2.revision
                    }
                  }).catch(function () {})
                } catch (_) {}
                return false
              }
              var v = res && res.value
              if (v && typeof v.revision === 'number') {
                _pendingRevision = v.revision
                _hostRevision = v.revision
              }
            } catch (_) {}
            return true
          }).catch(function (err) {
            _pendingRevision = null
            if (onError) onError(patch, function () {
              for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _netPrefs[k] = saved[k]
            })
            return false
          })
      })
      _prefWriteTail = task.then(function () {}, function () {})
      return task
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region AlertProviders ─────────────────────────────────────────────────

    /**
     * Network Alert Provider — connectivity heartbeat.
     * Polls /plugins/dock-flash/health (K6: stays on dock-flash).
     * Reports slow/timeout alerts.
     */
    function createNetworkAlertProvider() {
      var timer = null
      var callback = null
      var consecutiveFailures = 0
      var lastLatency = 0

      var HEARTBEAT_URL = '/plugins/dock-flash/health'
      var TIMEOUT_MS = 10000

      function poll() {
        if (!callback) return

        var start = Date.now()
        var timeoutId = null
        try {
          var controller = typeof AbortController !== 'undefined' ? new AbortController() : null
          if (controller) timeoutId = setTimeout(function () { controller.abort() }, TIMEOUT_MS)

          fetch(HEARTBEAT_URL, {
            method: 'GET',
            cache: 'no-store',
            signal: controller ? controller.signal : undefined,
          }).then(function (r) {
            if (timeoutId) clearTimeout(timeoutId)
            lastLatency = Date.now() - start
            consecutiveFailures = 0
            var alerts = []
            var delayRatio = lastLatency / TIMEOUT_MS
            var slowThreshold = _alertPref('netSlowThreshold')
            if (lastLatency > TIMEOUT_MS * 0.9) {
              alerts.push({
                id: 'net-timeout',
                severity: 'error',
                title: function () { return t('alertNetworkTimeout') },
                message: function () { return t('alertNetworkTimeout') },
                icon: '🔴',
                timestamp: Date.now(),
                dismissible: true,
              })
            } else if (lastLatency > slowThreshold) {
              alerts.push({
                id: 'net-slow',
                severity: 'warning',
                title: function () { return t('alertNetworkSlow').replace('{d}', lastLatency) },
                message: function () { return t('alertNetworkSlow').replace('{d}', lastLatency) },
                icon: '🟡',
                timestamp: Date.now(),
                dismissible: true,
              })
            }
            try { callback(alerts) } catch (_) {}
            scheduleNext(delayRatio)
          }).catch(function () {
            if (timeoutId) clearTimeout(timeoutId)
            consecutiveFailures++
            var alerts = []
            if (consecutiveFailures >= 3) {
              alerts.push({
                id: 'net-timeout',
                severity: 'error',
                title: function () { return t('alertNetworkTimeout') },
                message: function () { return t('alertNetworkTimeout') },
                icon: '🔴',
                timestamp: Date.now(),
                dismissible: true,
              })
            }
            try { callback(alerts) } catch (_) {}
            scheduleNext(1)
          })
        } catch (_) {
          consecutiveFailures++
          scheduleNext(1)
        }
      }

      function scheduleNext(delayRatio) {
        var pollBase = _alertPref('netPollBase')
        var pollMin  = _alertPref('netPollMin')
        var r = Math.min(Math.max(delayRatio || 0, 0), 1)
        var nextInterval = Math.max(pollMin, Math.round(pollBase * Math.pow(1 - r, 1.5) + pollMin))
        timer = setTimeout(poll, nextInterval)
      }

      return {
        id: 'dsh-flash-net-mon:network-alert',
        start: function (cb) {
          callback = cb
          poll()
        },
        stop: function () {
          callback = null
          if (timer) { clearTimeout(timer); timer = null }
          consecutiveFailures = 0
        },
      }
    }

    /**
     * Network Audit alert provider.
     * Polls /plugins/dsh-flash-net-mon/network-alerts for entries whose risk
     * score exceeds thresholds and feeds them to the AlertRegistry.
     * Metadata-only: never logs request/response bodies or header values.
     */
    function createNetworkAuditProvider() {
      var timer = null
      var callback = null
      var lastAlertIds = {}

      function _riskSeverity(risk) {
        if (risk >= _alertPref('netSuspectErr')) return 'error'
        if (risk >= _alertPref('netSuspectWarn')) return 'warning'
        return 'info'
      }

      function _flagLabel(flag) {
        var map = {
          'unknown-host': function () { return t('netAuditFlagUnknownHost') },
          'unknownHost':  function () { return t('netAuditFlagUnknownHost') },
          'new-host':     function () { return t('netAuditFlagNewHost') },
          'newHost':      function () { return t('netAuditFlagNewHost') },
          'large-upload': function () { return t('netAuditFlagLargeUpload') },
          'largeUpload':  function () { return t('netAuditFlagLargeUpload') },
          'plaintext':    function () { return t('netAuditFlagPlaintext') },
          'high-frequency': function () { return t('netAuditFlagHighFreq') },
          'highFreq':     function () { return t('netAuditFlagHighFreq') },
          'relative-url': function () { return t('netAuditFlagRelativeUrl') },
          'relativeUrl':  function () { return t('netAuditFlagRelativeUrl') },
          'redirected-host': function () { return t('netAuditFlagRedirectedHost') },
        }
        return (map[flag] || function () { return flag })()
      }

      function poll() {
        if (!callback) return
        try {
          fetch('/plugins/dsh-flash-net-mon/network-alerts', { cache: 'no-store' })
            .then(function (r) { return r.json() })
            .then(function (data) {
              if (!callback) return
              var entries = (data && data.alerts) || []
              var whitelist = (_netPrefs && Array.isArray(_netPrefs.netWhitelist))
                ? _netPrefs.netWhitelist : _ALERT_DEFAULTS.netWhitelist
              var pluginWhitelist = (_netPrefs && Array.isArray(_netPrefs.netPluginWhitelist))
                ? _netPrefs.netPluginWhitelist : []
              var suspectWarn = _alertPref('netSuspectWarn')
              var alerts = []
              var currentIds = {}
              for (var i = 0; i < entries.length; i++) {
                var e = entries[i]
                if (!e || e.risk < suspectWarn) continue
                if (whitelist.indexOf(e.host) !== -1) continue
                if (e.pluginId && pluginWhitelist.indexOf(e.pluginId) !== -1) continue
                var aid = 'net-audit-' + e.seq
                currentIds[aid] = true
                if (lastAlertIds[aid]) continue
                var flags = Array.isArray(e.flags) ? e.flags : []
                var flagText = flags.length
                  ? flags.map(_flagLabel).join(', ')
                  : ''
                alerts.push({
                  id: aid,
                  severity: _riskSeverity(e.risk),
                  title: function () { return t('netAuditTitle') },
                  message: function () {
                    var m = ''
                    var pid = e.pluginId || ''
                    if (pid && pid !== 'unknown') m += '[' + pid + '] '
                    m += (e.method || '?') + ' ' + (e.host || '') + (e.pathname || '')
                    if (flagText) m += ' — ' + flagText
                    return m
                  },
                  icon: e.risk >= _alertPref('netSuspectErr') ? '🔴' : '🟡',
                  timestamp: e.timestamp || Date.now(),
                  dismissible: true,
                  _netAuditEntry: e,
                })
              }
              lastAlertIds = currentIds
              try { callback(alerts) } catch (_) {}
            })
            .catch(function () {
              // Silent — next poll will retry
            })
        } catch (_) {}
        var pollBase = _alertPref('netPollBase')
        var pollMin  = _alertPref('netPollMin')
        timer = setTimeout(poll, Math.max(pollMin, pollBase))
      }

      return {
        id: 'dsh-flash-net-mon:network-audit',
        start: function (cb) {
          callback = cb
          lastAlertIds = {}
          poll()
        },
        stop: function () {
          callback = null
          if (timer) { clearTimeout(timer); timer = null }
          lastAlertIds = {}
        },
      }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region NetworkAuditPanel ──────────────────────────────────────────────

    /** Plugin id the host half uses when it cannot attribute the caller. */
    var UNKNOWN_PLUGIN = 'unknown'

    /**
     * One-click whitelist suggestions: services a DSH user plausibly talks to.
     *
     * Rules that keep this a help rather than a hole:
     *   · EXACT hostnames only — never an apex domain. A user entry on an apex
     *     covers subdomains, so `amazonaws.com` would trust every bucket there.
     *   · No host that serves user-generated content (github.io,
     *     raw.githubusercontent.com, *.s3.amazonaws.com, *.cloudfront.net):
     *     trusting one hands the audit blind to arbitrary third-party payloads.
     *   · Nothing is applied on its own — every entry costs one deliberate click.
     * Brand names are locale-neutral on purpose, so this data needs no i18n.
     */
    var NET_KNOWN_SERVICES = [
      { host: 'api.openai.com', label: 'OpenAI' },
      { host: 'api.anthropic.com', label: 'Anthropic' },
      { host: 'generativelanguage.googleapis.com', label: 'Google Gemini' },
      { host: 'api.deepseek.com', label: 'DeepSeek' },
      { host: 'api.moonshot.cn', label: 'Moonshot / Kimi' },
      { host: 'dashscope.aliyuncs.com', label: 'Aliyun DashScope' },
      { host: 'open.bigmodel.cn', label: 'Zhipu GLM' },
      { host: 'api.siliconflow.cn', label: 'SiliconFlow' },
      { host: 'api.github.com', label: 'GitHub API' },
      { host: 'registry.npmjs.org', label: 'npm registry' },
      { host: 'pypi.org', label: 'PyPI' },
      { host: 'files.pythonhosted.org', label: 'PyPI files' },
      { host: 'huggingface.co', label: 'Hugging Face' },
      { host: 'api.telegram.org', label: 'Telegram Bot API' },
      { host: 'api.notion.com', label: 'Notion API' },
    ]

    function NetworkAuditPanel() {
      var _s = useState([])
      var entries = _s[0], setEntries = _s[1]
      var _as = useState(false)
      var autoScroll = _as[0], setAutoScroll = _as[1]
      var _ps = useState(false)
      var paused = _ps[0], setPaused = _ps[1]
      var _ds = useState(null)
      var detail = _ds[0], setDetail = _ds[1]
      var _fs = useState('')
      var filterPlugin = _fs[0], setFilterPlugin = _fs[1]
      var _fr = useState('')
      var filterRisk = _fr[0], setFilterRisk = _fr[1]
      var _ws = useState([])
      var whitelist = _ws[0], setWhitelist = _ws[1]
      var _pws = useState([])
      var pluginWhitelist = _pws[0], setPluginWhitelist = _pws[1]
      var _tab = useState('stream')
      var subTab = _tab[0], setSubTab = _tab[1]
      var _wlv = useState('hosts')
      var wlView = _wlv[0], setWlView = _wlv[1]
      var _pg = useState(0)
      var page = _pg[0], setPage = _pg[1]
      var PAGE_SIZE = 10
      var _tr = useState({ builtin: [], endpoints: [] })
      var autoTrusted = _tr[0], setAutoTrusted = _tr[1]
      var _pm = useState('')
      var manualPlugin = _pm[0], setManualPlugin = _pm[1]

      /**
       * The read-only half of the trust picture: built-in hosts and the API
       * endpoints DSH is configured to call. It is read back from the host (not
       * from our own settings prefs), so the panel shows what is really enforced.
       */
      function fetchTrusted() {
        try {
          fetch('/plugins/dsh-flash-net-mon/network-whitelist', { cache: 'no-store' })
            .then(function (r) { return r.json() })
            .then(function (data) {
              setAutoTrusted({
                builtin: (data && Array.isArray(data.builtin)) ? data.builtin : [],
                endpoints: (data && Array.isArray(data.endpoints)) ? data.endpoints : [],
              })
            })
            .catch(function () {})
        } catch (_) {}
      }

      /** 'added' | 'builtin' | 'endpoint' when a host is already covered, else null. */
      function wlCovered(host) {
        var h = String(host || '').toLowerCase()
        if (!h) return null
        for (var k = 0; k < whitelist.length; k++) {
          if (String(whitelist[k]).toLowerCase() === h) return 'added'
        }
        var isBuiltin = autoTrusted.builtin.some(function (b) { return String(b).toLowerCase() === h })
        if (isBuiltin) return 'builtin'
        var isEndpoint = autoTrusted.endpoints.some(function (e) { return String(e).toLowerCase() === h })
        if (isEndpoint) return 'endpoint'
        // A user entry on an apex domain covers subdomains, exactly as the scorer does.
        for (var j = 0; j < whitelist.length; j++) {
          var apex = String(whitelist[j]).toLowerCase()
          if (h.length > apex.length && h.slice(-(apex.length + 1)) === '.' + apex) return 'added'
        }
        return null
      }

      function submitManualPlugin() {
        var pid = String(manualPlugin || '').trim().toLowerCase()
        if (!pid) return
        setManualPlugin('')
        addPluginWhitelist(pid)
      }

      var scrollRef = useRef(null)
      var timerRef = useRef(null)
      /** The expanded inline detail, so it can be scrolled into view when it opens. */
      var detailRef = useRef(null)

      function fetchLog() {
        try {
          fetch('/plugins/dsh-flash-net-mon/network-log', { cache: 'no-store' })
            .then(function (r) { return r.json() })
            .then(function (data) {
              var list = (data && data.entries) || []
              setEntries(list)
            })
            .catch(function () {})
        } catch (_) {}
      }

      function fetchWhitelist() {
        var wl = (_netPrefs && Array.isArray(_netPrefs.netWhitelist))
          ? _netPrefs.netWhitelist : _ALERT_DEFAULTS.netWhitelist
        setWhitelist(wl.slice())
        var pwl = (_netPrefs && Array.isArray(_netPrefs.netPluginWhitelist))
          ? _netPrefs.netPluginWhitelist : []
        setPluginWhitelist(pwl.slice())
      }

      function postWhitelist(hosts) {
        try {
          fetch('/plugins/dsh-flash-net-mon/network-whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hosts: hosts }),
          }).catch(function () {})
        } catch (_) {}
        if (_netPrefs) _netPrefs.netWhitelist = hosts
        savePrefs(null, Object.fromEntries([['netWhitelist', hosts]]))
        setWhitelist(hosts.slice())
      }

      function postPluginWhitelist(plugins) {
        try {
          fetch('/plugins/dsh-flash-net-mon/network-plugin-whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plugins: plugins }),
          }).catch(function () {})
        } catch (_) {}
        if (_netPrefs) _netPrefs.netPluginWhitelist = plugins
        savePrefs(null, Object.fromEntries([['netPluginWhitelist', plugins]]))
        setPluginWhitelist(plugins.slice())
      }

      function addWhitelist(host) {
        if (!host || whitelist.indexOf(host) !== -1) return
        var next = whitelist.concat([host])
        postWhitelist(next)
      }

      function removeWhitelist(host) {
        var next = whitelist.filter(function (h) { return h !== host })
        postWhitelist(next)
      }

      function addPluginWhitelist(pid) {
        if (!pid || pluginWhitelist.indexOf(pid) !== -1) return
        var next = pluginWhitelist.concat([pid])
        postPluginWhitelist(next)
      }

      function removePluginWhitelist(pid) {
        var next = pluginWhitelist.filter(function (p) { return p !== pid })
        postPluginWhitelist(next)
      }

      var suspectWarn = _alertPref('netSuspectWarn')
      var suspectErr  = _alertPref('netSuspectErr')
      var filtered = entries.filter(function (e) {
        if (filterPlugin && e.pluginId !== filterPlugin) return false
        if (filterRisk === 'suspect' && e.risk < suspectWarn) return false
        if (filterRisk === 'danger' && e.risk < suspectErr) return false
        return true
      })

      useEffect(function () {
        // While a detail is expanded the list must not jump to the newest page:
        // the open row would slide off the page being read. Pausing auto-scroll
        // here is what lets the inline detail stay put while entries keep arriving.
        if (autoScroll && !paused && !detail && filtered.length) {
          var lastPage = Math.ceil(filtered.length / PAGE_SIZE) - 1
          if (page !== lastPage) setPage(lastPage)
        }
      }, [entries, autoScroll, paused, detail])

      // Escape collapses an open detail — and must NOT reach the config modal's own
      // document listener, which closes the whole modal: that is how Escape used to
      // dismiss the panel out from under the detail. A capture-phase listener on
      // document runs before the modal's bubble-phase one, and stopping propagation
      // there keeps the event from ever reaching it. With no detail open this
      // listener is not installed, so Escape still closes the modal as before.
      useEffect(function () {
        if (!detail) return
        function onKey(ev) {
          if (ev.key !== 'Escape') return
          ev.stopPropagation()
          setDetail(null)
        }
        document.addEventListener('keydown', onKey, true)
        return function () { document.removeEventListener('keydown', onKey, true) }
      }, [detail])

      // Bring the expanded block into view. The row it belongs to is already on
      // screen — it was just clicked — so scrolling the detail with 'nearest' moves
      // as little as possible instead of yanking the list to the top.
      useEffect(function () {
        var node = detailRef.current
        if (!detail || !node || !node.scrollIntoView) return
        node.scrollIntoView({ block: 'nearest' })
      }, [detail])

      useEffect(function () {
        fetchLog()
        fetchWhitelist()
        fetchTrusted()
        if (!paused) {
          var pollBase = _alertPref('netPollBase')
          var pollMin  = _alertPref('netPollMin')
          timerRef.current = setInterval(fetchLog, Math.max(pollMin, pollBase))
        }
        return function () {
          if (timerRef.current) clearInterval(timerRef.current)
        }
      }, [paused])

      // A filter or sub-tab change replaces what the list shows, so an open detail
      // (and the target it belonged to) is dropped rather than left pointing at a
      // row that is no longer rendered.
      useEffect(function () { setPage(0); setDetail(null) }, [filterPlugin, filterRisk, subTab])

      // The auto-trusted list lives on the host and can change under us (a
      // provider endpoint was reconfigured), so re-read it on every entry into
      // the whitelist tab rather than trusting the first fetch.
      useEffect(function () {
        if (subTab === 'whitelist') fetchTrusted()
      }, [subTab])
      useEffect(function () {
        var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
        if (page >= totalPages) setPage(totalPages - 1)
      }, [filtered.length])

      var pluginIds = []
      var seen = {}
      for (var i = 0; i < entries.length; i++) {
        var pid = entries[i].pluginId || ''
        if (pid && !seen[pid]) { seen[pid] = true; pluginIds.push(pid) }
      }

      function riskStyle(risk) {
        if (risk >= suspectErr) return S.netAuditRiskDanger
        if (risk >= suspectWarn) return S.netAuditRiskSuspect
        return S.netAuditRiskNone
      }

      function flagLabels(flags) {
        if (!Array.isArray(flags) || !flags.length) return null
        var map = {
          'unknown-host': function () { return t('netAuditFlagUnknownHost') },
          'unknownHost':  function () { return t('netAuditFlagUnknownHost') },
          'new-host':     function () { return t('netAuditFlagNewHost') },
          'newHost':      function () { return t('netAuditFlagNewHost') },
          'large-upload': function () { return t('netAuditFlagLargeUpload') },
          'largeUpload':  function () { return t('netAuditFlagLargeUpload') },
          'plaintext':    function () { return t('netAuditFlagPlaintext') },
          'high-frequency': function () { return t('netAuditFlagHighFreq') },
          'highFreq':     function () { return t('netAuditFlagHighFreq') },
          'relative-url': function () { return t('netAuditFlagRelativeUrl') },
          'relativeUrl':  function () { return t('netAuditFlagRelativeUrl') },
          'redirected-host': function () { return t('netAuditFlagRedirectedHost') },
        }
        return flags.map(function (f, fi) {
          var label = (map[f] || function () { return f })()
          return h('span', { key: fi, style: S.netAuditFlagBadge }, label)
        })
      }

      function statusColor(s) {
        if (s >= 200 && s < 300) return 'var(--dsw-alias-label-success, #57ab5a)'
        if (s >= 400 && s < 500) return 'var(--dsw-alias-label-warning, #c69026)'
        if (s >= 500) return 'var(--dsw-alias-label-danger, #e5534b)'
        return 'var(--dsw-alias-label-secondary, #8b949e)'
      }

      function fmtBytes(b) {
        if (b == null) return '—'
        if (b < 1024) return b + 'B'
        if (b < 1048576) return (b / 1024).toFixed(1) + 'K'
        return (b / 1048576).toFixed(1) + 'M'
      }

      function fmtDuration(ms) {
        if (ms == null) return '—'
        return ms + 'ms'
      }

      function subTabBtn(id, icon, labelKey) {
        var active = subTab === id
        return h('button', {
          key: id,
          type: 'button',
          style: Object.assign({}, S.netAuditToolbarBtn, active ? S.netAuditToolbarBtnActive : {}),
          onClick: function () { setSubTab(id) },
        }, _switchIcon(icon, S.auditIcon), ' ', t(labelKey))
      }

      /** Opening a row's detail, or closing it when that same row is clicked again. */
      function toggleDetail(e) {
        setDetail(function (cur) {
          return cur && cur.seq === e.seq ? null : e
        })
      }

      /**
       * The inline detail, rendered directly under the row it belongs to.
       *
       * It deliberately does NOT repeat what the row already carries (method,
       * plugin, host, path, status, risk, duration): the row is still on screen
       * one line above, and repeating seven fields is what made the old overlay a
       * full page. What it adds is the untruncated target plus request/response
       * size, status colour, duration, TLS, timestamp and flags.
       */
      function renderEntryDetail(e) {
        var cells = [
          [t('netAuditReqSize'), fmtBytes(e.reqBytes), null, null],
          [t('netAuditResSize'), fmtBytes(e.resBytes), null, null],
          [t('netAuditStatus'), e.status != null ? String(e.status) : '—', { color: statusColor(e.status) }, null],
          [t('netAuditDuration'), fmtDuration(e.durationMs), null, null],
          [t('netAuditTls'), e.tls != null ? (e.tls ? 'TLS' : 'HTTP') : '—', null, null],
          [t('netAuditTimestamp'), e.timestamp ? new Date(e.timestamp).toLocaleString() : '—', null, null],
          [t('netAuditFlags'), Array.isArray(e.flags) && e.flags.length ? e.flags.join(', ') : '—', null, '1 / -1'],
        ]
        // When the response redirected to a different host, surface where the
        // data actually went — the row only shows the initial target.
        if (e.finalHost && e.finalHost !== e.host) {
          cells.push([t('netAuditRedirectedTo'), e.finalHost, { color: 'var(--dsw-alias-label-warning, #c69026)' }, null])
        }
        return h('div', { ref: detailRef, style: S.netAuditDetailInline },
          h('div', { style: S.netAuditDetailTarget, title: (e.host || '') + (e.pathname || '') },
            (e.method || '?') + ' ' + (e.host || '—') + (e.pathname || '')),
          h('div', { style: S.netAuditDetailGrid },
            cells.map(function (c, ci) {
              return h('div', {
                key: ci,
                style: c[3] ? Object.assign({}, S.netAuditDetailRow, { gridColumn: c[3] }) : S.netAuditDetailRow,
              },
                h('span', { style: S.netAuditDetailLabel }, c[0]),
                h('span', { style: c[2] ? Object.assign({}, S.netAuditDetailValue, c[2]) : S.netAuditDetailValue }, c[1])
              )
            })
          ),
          h('div', { style: S.netAuditDetailActions },
            whitelist.indexOf(e.host) === -1
              ? h('button', {
                  type: 'button',
                  style: S.netAuditToolbarBtn,
                  onClick: function () { addWhitelist(e.host) },
                }, _switchIcon('plus', S.auditIcon), ' ', t('netAuditAddHostWhitelist'))
              : null,
            e.pluginId && e.pluginId !== 'unknown' && pluginWhitelist.indexOf(e.pluginId) === -1
              ? h('button', {
                  type: 'button',
                  style: S.netAuditToolbarBtn,
                  onClick: function () { addPluginWhitelist(e.pluginId) },
                }, _switchIcon('plus', S.auditIcon), ' ', t('netAuditAddPluginWhitelist'))
              : null,
            // Collapse lives in the block itself: with no overlay there is nothing
            // to dismiss, only a row to fold back up.
            h('button', {
              type: 'button',
              style: Object.assign({}, S.netAuditToolbarBtn, { marginLeft: 'auto' }),
              title: t('netAuditCollapse'),
              onClick: function () { setDetail(null) },
            }, t('netAuditCollapse'))
          )
        )
      }

      /**
       * A list row plus its inline detail when it is the open one. Both tabs
       * render through here so their rows cannot drift apart — and the key stays
       * on the Fragment so React keeps the pair together across re-renders.
       */
      function renderEntry(e, i, cells) {
        var open = !!detail && detail.seq === e.seq
        return h(React.Fragment, { key: e.seq || i },
          h('div', {
            key: 'row',
            style: open ? Object.assign({}, S.netAuditRow, S.netAuditRowActive) : S.netAuditRow,
            onClick: function () { toggleDetail(e) },
          }, cells),
          open ? renderEntryDetail(e) : null
        )
      }

      function renderPager(totalCount) {
        var totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
        var safePage = Math.min(page, totalPages - 1)
        var info = t('netAuditPageInfo')
          .replace('{cur}', String(safePage + 1))
          .replace('{total}', String(totalPages))
          .replace('{count}', String(totalCount))
        return h('div', { style: S.netAuditPager },
          h('button', {
            type: 'button',
            style: Object.assign({}, S.netAuditPagerBtn, safePage <= 0 ? S.netAuditPagerBtnDisabled : {}),
            onClick: function () { if (safePage > 0) setPage(safePage - 1) },
          }, t('netAuditPagePrev')),
          h('span', null, info),
          h('button', {
            type: 'button',
            style: Object.assign({}, S.netAuditPagerBtn, safePage >= totalPages - 1 ? S.netAuditPagerBtnDisabled : {}),
            onClick: function () { if (safePage < totalPages - 1) setPage(safePage + 1) },
          }, t('netAuditPageNext')),
        )
      }

      // ── Sub-tab renders ──
      function renderStream() {
        if (!filtered.length) {
          return h('div', { style: S.netAuditStreamWrap },
            h('div', { style: S.netAuditEmpty }, t('netAuditEmpty'))
          )
        }
        var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
        var safePage = Math.min(page, totalPages - 1)
        var pageEntries = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
        return h('div', null,
          h('div', {
            style: S.netAuditStreamWrap,
            ref: scrollRef,
          },
            h('div', { style: S.netAuditStreamInner },
              pageEntries.map(function (e, i) {
                return renderEntry(e, i, [
                  h('span', { key: 'm', style: S.netAuditMethodCell }, e.method || '?'),
                  h('span', { key: 'p', style: S.netAuditPluginCell, title: e.pluginId || '' }, e.pluginId && e.pluginId !== 'unknown' ? e.pluginId : '—'),
                  h('span', { key: 'h', style: S.netAuditCell, title: e.host || '' }, e.host || '—'),
                  h('span', { key: 'pa', style: S.netAuditCellGrow, title: e.pathname || '' }, e.pathname || ''),
                  h('span', { key: 's', style: Object.assign({}, S.netAuditStatusCell, { color: statusColor(e.status) }) }, e.status != null ? e.status : '—'),
                  h('span', { key: 'r', style: Object.assign({}, S.netAuditCell, riskStyle(e.risk)) }, e.risk != null ? e.risk : ''),
                  h('span', { key: 'd', style: S.netAuditCell }, fmtDuration(e.durationMs)),
                ])
              })
            )
          ),
          renderPager(filtered.length),
        )
      }

      function renderAlerts() {
        var alertEntries = filtered.filter(function (e) { return e.risk >= suspectWarn })
        if (!alertEntries.length) {
          return h('div', { style: S.netAuditStreamWrap },
            h('div', { style: S.netAuditEmpty }, t('netAuditNoAlerts'))
          )
        }
        return h('div', { style: S.netAuditStreamWrap },
          h('div', { style: S.netAuditStreamInner },
            alertEntries.map(function (e, i) {
              return renderEntry(e, i, [
                h('span', { key: 'm', style: Object.assign({}, S.netAuditMethodCell, riskStyle(e.risk)) }, e.method || '?'),
                h('span', { key: 'p', style: S.netAuditPluginCell, title: e.pluginId || '' }, e.pluginId && e.pluginId !== 'unknown' ? e.pluginId : '—'),
                h('span', { key: 't', style: S.netAuditCellGrow, title: (e.host || '') + (e.pathname || '') }, (e.host || '') + (e.pathname || '')),
                h('span', { key: 'r', style: Object.assign({}, S.netAuditCell, riskStyle(e.risk)) }, e.risk),
                h('span', { key: 'f', style: S.netAuditCell }, flagLabels(e.flags)),
              ])
            })
          )
        )
      }

      function renderWhitelist() {
        if (wlView === 'hosts') {
          var suggestionChips = NET_KNOWN_SERVICES.map(function (svc) {
            var covered = wlCovered(svc.host)
            return h('button', {
              key: svc.host,
              type: 'button',
              disabled: !!covered,
              title: svc.host,
              style: Object.assign({}, S.netAuditSuggestChip, covered ? S.netAuditSuggestChipDone : {}),
              onClick: function () { if (!covered) addWhitelist(svc.host) },
            }, svc.label, ' ',
              h('span', { style: S.netAuditSuggestHost }, svc.host),
              covered
                ? h('span', { style: S.netAuditSuggestTag },
                    covered === 'added' ? t('netAuditSuggestAdded')
                      : covered === 'builtin' ? t('netAuditAutoBuiltin')
                        : t('netAuditAutoEndpoint'))
                : null)
          })
          var autoChips = autoTrusted.builtin.map(function (host, i) {
            return h('span', { key: 'b' + i, style: Object.assign({}, S.netAuditSuggestChip, S.netAuditSuggestChipDone) },
              h('span', { style: S.netAuditSuggestHost }, host),
              h('span', { style: S.netAuditSuggestTag }, t('netAuditAutoBuiltin')))
          }).concat(autoTrusted.endpoints.map(function (host, i) {
            return h('span', { key: 'e' + i, style: Object.assign({}, S.netAuditSuggestChip, S.netAuditSuggestChipDone) },
              h('span', { style: S.netAuditSuggestHost }, host),
              h('span', { style: S.netAuditSuggestTag }, t('netAuditAutoEndpoint')))
          }))
          return h('div', { style: S.netAuditWhitelistWrap },
            h('div', { style: S.netAuditWhitelistHint }, t('netAuditWhitelistHint')),
            whitelist.length
              ? whitelist.map(function (host, i) {
                  return h('div', { key: i, style: S.netAuditWhitelistItem },
                    h('span', { style: S.netAuditWhitelistHost }, host),
                    h('button', {
                      style: S.netAuditWhitelistRemove,
                      onClick: function () { removeWhitelist(host) },
                    }, '✕')
                  )
                })
              : h('div', { style: S.netAuditEmpty }, t('netAuditEmpty')),
            // Offered, never applied: each chip costs one deliberate click, and the
            // list holds exact hostnames only (see NET_KNOWN_SERVICES).
            h('div', { style: S.netAuditSectionTitle }, t('netAuditSuggestTitle')),
            h('div', { style: S.netAuditWhitelistHint }, t('netAuditSuggestHint')),
            h('div', { style: S.netAuditChipRow }, suggestionChips),
            h('div', { style: S.netAuditSectionTitle }, t('netAuditAutoTitle')),
            h('div', { style: S.netAuditWhitelistHint }, t('netAuditAutoHint')),
            autoChips.length
              ? h('div', { style: S.netAuditChipRow }, autoChips)
              : h('div', { style: S.netAuditEmpty }, t('netAuditAutoNone'))
          )
        }
        // Plugin view: the picker is built from the plugins actually seen in the
        // log, so trusting one never requires finding its row first.
        var observedChips = pluginIds.filter(function (pid) {
          return pid && pid !== UNKNOWN_PLUGIN
        }).map(function (pid) {
          var trusted = pluginWhitelist.indexOf(pid) !== -1
          return h('span', { key: pid, style: Object.assign({}, S.netAuditSuggestChip, trusted ? S.netAuditSuggestChipDone : {}) },
            h('span', { style: S.netAuditSuggestHost }, pid),
            trusted
              ? h('span', { style: S.netAuditSuggestTag }, t('netAuditTrustedTag'))
              : h('button', {
                  type: 'button',
                  style: S.netAuditChipBtn,
                  onClick: function () { addPluginWhitelist(pid) },
                }, t('netAuditTrustBtn')))
        })
        return h('div', { style: S.netAuditWhitelistWrap },
          h('div', { style: S.netAuditWhitelistHint }, t('netAuditPluginWhitelistHint')),
          pluginWhitelist.length
            ? pluginWhitelist.map(function (pid, i) {
                return h('div', { key: i, style: S.netAuditWhitelistItem },
                  h('span', { style: S.netAuditWhitelistHost }, pid),
                  h('button', {
                    style: S.netAuditWhitelistRemove,
                    onClick: function () { removePluginWhitelist(pid) },
                  }, '✕')
                )
              })
            : h('div', { style: S.netAuditEmpty }, t('netAuditEmptyPlugins')),
          h('div', { style: S.netAuditSectionTitle }, t('netAuditObservedTitle')),
          h('div', { style: S.netAuditWhitelistHint }, t('netAuditObservedHint')),
          observedChips.length
            ? h('div', { style: S.netAuditChipRow }, observedChips)
            : h('div', { style: S.netAuditEmpty }, t('netAuditObservedEmpty')),
          pluginIds.indexOf(UNKNOWN_PLUGIN) !== -1
            ? h('div', { style: S.netAuditWhitelistHint }, t('netAuditPluginUnknownNote'))
            : null,
          h('div', { style: S.netAuditSectionTitle }, t('netAuditPluginManualTitle')),
          h('div', { style: S.netAuditWhitelistHint }, t('netAuditPluginManualHint')),
          h('div', { style: S.netAuditManualRow },
            h('input', {
              type: 'text',
              value: manualPlugin,
              placeholder: 'dsh-cost-meter',
              style: S.netAuditManualInput,
              onChange: function (e) { setManualPlugin(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') submitManualPlugin() },
            }),
            h('button', {
              type: 'button',
              style: S.netAuditChipBtn,
              onClick: submitManualPlugin,
            }, t('netAuditAdd')))
        )
      }

      return h('div', { style: S.netAuditPanel },
        // Toolbar: sub-tabs + filter + pause/clear
        h('div', { style: S.netAuditToolbar },
          subTabBtn('stream', 'signal', 'netAuditStream'),
          subTabBtn('alerts', 'shield', 'netAuditAlerts'),
          subTabBtn('whitelist', 'shield', 'netAuditWhitelist'),
          // Filter by plugin (stream/alerts tabs)
          subTab !== 'whitelist'
            ? h('select', {
                value: filterPlugin,
                onChange: function (e) { setFilterPlugin(e.target.value) },
                style: S.netAuditFilterSelect,
              },
                h('option', { value: '' }, t('netAuditAllPlugins')),
                pluginIds.map(function (pid) {
                  return h('option', { key: pid, value: pid }, pid)
                })
              )
            : null,
          // Filter by risk (stream/alerts tabs)
          subTab !== 'whitelist'
            ? h('select', {
                value: filterRisk,
                onChange: function (e) { setFilterRisk(e.target.value) },
                style: S.netAuditFilterSelect,
              },
                h('option', { value: '' }, t('netAuditRiskNone')),
                h('option', { value: 'suspect' }, t('netAuditRiskSuspect')),
                h('option', { value: 'danger' }, t('netAuditRiskDanger'))
              )
            : null,
          // Whitelist view toggle
          subTab === 'whitelist'
            ? h('select', {
                value: wlView,
                onChange: function (e) { setWlView(e.target.value) },
                style: S.netAuditFilterSelect,
              },
                h('option', { value: 'hosts' }, t('netAuditWlViewHosts')),
                h('option', { value: 'plugins' }, t('netAuditWlViewPlugins'))
              )
            : null,
          // Pause/Resume + Clear (stream/alerts tabs)
          subTab !== 'whitelist'
            ? h('button', {
                type: 'button',
                style: S.netAuditToolbarBtn,
                onClick: function () { setPaused(function (p) { return !p }) },
              }, _switchIcon(paused ? 'scroll' : 'pause', S.auditIcon), ' ', paused ? t('netAuditResume') : t('netAuditPause'))
            : null,
          subTab === 'stream'
            ? h('button', {
                type: 'button',
                style: S.netAuditToolbarBtn,
                onClick: function () {
                  try {
                    fetch('/plugins/dsh-flash-net-mon/network-log', { method: 'DELETE', cache: 'no-store' })
                      .then(function () { fetchLog() })
                      .catch(function () {})
                  } catch (_) {}
                },
              }, t('netAuditClear'))
            : null,
        ),
        // Sub-tab content. The detail is NOT rendered here any more: it belongs to
        // the row that opened it and is emitted underneath it by renderEntry(), so
        // there is no overlay to position and nothing that can cover the modal.
        subTab === 'stream' ? renderStream() :
        subTab === 'alerts' ? renderAlerts() :
        renderWhitelist(),
      )
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region MonitorConfigModal (network only) ──────────────────────────────

    var MONITOR_SLIDER_FIELDS = {
      network: [
        { key: 'netSlowThreshold', labelKey: 'netSlowThreshold', min: 1000,  max: 15000,  step: 500,  format: function (v) { return v + 'ms' } },
        { key: 'netPollBase',      labelKey: 'netPollBase',      min: 10000, max: 120000, step: 5000, format: function (v) { return v + 'ms' } },
        { key: 'netPollMin',       labelKey: 'netPollMin',       min: 5000,  max: 30000,  step: 1000, format: function (v) { return v + 'ms' } },
        { key: 'netLogCap',        labelKey: 'netLogCap',        min: 50,    max: 1000,   step: 50,   format: function (v) { return '' + v } },
        { key: 'netSuspectWarn',   labelKey: 'netSuspectWarn',   min: 10,    max: 90,     step: 5,    format: function (v) { return '' + v } },
        { key: 'netSuspectErr',    labelKey: 'netSuspectErr',    min: 20,    max: 100,    step: 5,    format: function (v) { return '' + v } },
      ],
    }

    var MONITOR_TITLE_KEY = {
      network: 'alertNetCluster',
    }

    var _monitorConfigRoot = null
    var _monitorConfigHost = null

    function closeMonitorConfig() {
      if (_monitorConfigRoot) { try { _monitorConfigRoot.unmount() } catch (_) {} _monitorConfigRoot = null }
      if (_monitorConfigHost) { try { _monitorConfigHost.remove() } catch (_) {} _monitorConfigHost = null }
    }

    function openMonitorConfig(monitor) {
      if (!ReactDOMClient || !ReactDOMClient.createRoot) return
      closeMonitorConfig()
      var host = document.createElement('div')
      host.style.cssText = 'position:fixed;inset:0;z-index:2200;'
      document.body.appendChild(host)
      _monitorConfigHost = host
      try {
        _monitorConfigRoot = ReactDOMClient.createRoot(host)
        _monitorConfigRoot.render(h(MonitorConfigModal, {
          monitor: monitor,
          onClose: closeMonitorConfig,
        }))
      } catch (e) {
        console.error('[dsh-flash-net-mon] failed to open monitor config:', e)
        closeMonitorConfig()
      }
    }

    function renderRiskAlgo() {
      function factor(labelKey, add) {
        return h('div', { key: add + labelKey, style: S.netRiskAlgoRow },
          h('span', { style: S.netRiskAlgoBullet }, '·'),
          h('span', null,
            h('span', { style: S.netRiskAlgoFactor }, t(labelKey)),
            h('span', null, '  +' + add),
          ),
        )
      }
      return h('div', { style: S.netRiskAlgoBody },
        h('div', { style: S.netRiskAlgoIntro }, t('netRiskAlgoIntro')),
        h('div', { style: S.netRiskAlgoGroupTitle }, t('netRiskAlgoTrusted')),
        h('div', { style: S.netRiskAlgoRow },
          h('span', { style: S.netRiskAlgoBullet }, '·'),
          h('span', null,
            h('span', { style: S.netRiskAlgoFactor }, '0'),
            h('span', { style: S.netRiskAlgoSub }, t('netRiskAlgoTrustedDesc')),
          ),
        ),
        h('div', { style: S.netRiskAlgoGroupTitle }, t('netRiskAlgoBase')),
        h('div', { style: S.netRiskAlgoRow },
          h('span', { style: S.netRiskAlgoBullet }, '·'),
          h('span', null,
            h('span', { style: S.netRiskAlgoFactor }, t('netRiskAlgoBase')),
            h('span', null, '  +30'),
            h('span', { style: S.netRiskAlgoSub }, t('netRiskAlgoBaseDesc')),
          ),
        ),
        factor('netRiskAlgoFactorNew', 5),
        factor('netRiskAlgoFactorUpload', 25),
        factor('netRiskAlgoFactorPlaintext', 20),
        factor('netRiskAlgoFactorFreq', 15),
        h('div', { style: S.netRiskAlgoRow },
          h('span', { style: S.netRiskAlgoBullet }, '·'),
          h('span', null,
            h('span', { style: S.netRiskAlgoFactor }, t('netRiskAlgoCap')),
            h('span', { style: S.netRiskAlgoSub }, t('netRiskAlgoCapDesc')),
          ),
        ),
        h('div', { style: S.netRiskAlgoGroupTitle }, t('netRiskAlgoLevels')),
        h('div', { style: S.netRiskAlgoLevelsLine },
          h('span', { style: S.netRiskAlgoBadgeNormal }, t('netRiskAlgoLevelNormal')),
          h('span', null, '< ' + String(Number(_alertPref('netSuspectWarn')) || 40)),
        ),
        h('div', { style: S.netRiskAlgoLevelsLine },
          h('span', { style: S.netRiskAlgoBadgeWarn }, t('netRiskAlgoLevelWarn')),
          h('span', null,
            String(Number(_alertPref('netSuspectWarn')) || 40) + ' – ' +
            String((Number(_alertPref('netSuspectErr')) || 70) - 1)),
        ),
        h('div', { style: S.netRiskAlgoLevelsLine },
          h('span', { style: S.netRiskAlgoBadgeErr }, t('netRiskAlgoLevelErr')),
          h('span', null, '≥ ' + String(Number(_alertPref('netSuspectErr')) || 70)),
        ),
      )
    }

    function MonitorConfigModal(props) {
      var monitor = props.monitor
      var onClose = props.onClose
      var fields = MONITOR_SLIDER_FIELDS[monitor] || []
      var _tick = useState(0)
      var tick = _tick[0], setTick = _tick[1]
      var _algo = useState(false)
      var algoOpen = _algo[0], setAlgoOpen = _algo[1]

      useEffect(function () {
        function onKey(e) { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return function () { document.removeEventListener('keydown', onKey) }
      }, [onClose])

      var useGrid = monitor === 'network'
      var rowStyle  = useGrid ? Object.assign({}, S.switchRow, { marginBottom: 0 }) : S.switchRow
      var slideSty  = useGrid ? Object.assign({}, S.sliderRow, { marginBottom: 0 }) : S.sliderRow
      var modalSty  = useGrid ? Object.assign({}, S.monitorModal, { maxWidth: '760px' }) : S.monitorModal

      var fieldEls = fields.map(function (f) {
        var val = Number(_alertPref(f.key)) || 0
        return h('div', { key: f.key, style: rowStyle },
          h('span', { style: S.switchLabel },
            h('span', { style: S.switchIcon }, '⚙'),
            h('span', null, t(f.labelKey)),
          ),
          h('div', { style: slideSty },
            h('input', {
              type: 'range',
              min: f.min, max: f.max, step: f.step,
              value: val,
              style: S.slider,
              onChange: function (e) {
                var next = Number(e.target.value)
                _writeAlertPref(_prefCtx, f.key, next, function (patch, rollback) { rollback() })
                setTick(function (v) { return v + 1 })
              },
            }),
            h('span', { style: S.value }, f.format(val)),
          ),
        )
      })

      return h('div', {
        style: S.monitorModalMask,
        onMouseDown: function (e) { if (e.target === e.currentTarget) onClose() },
      },
        h('div', { style: modalSty },
          h('div', { style: S.monitorModalHead },
            h('span', { style: S.monitorModalTitle },
              t(MONITOR_TITLE_KEY[monitor] || 'alertNetCluster') + ' — ' + t('monitorConfig')),
            h('button', {
              type: 'button',
              'data-dock-flash-focus': '',
              style: S.monitorModalClose,
              onClick: onClose,
            }, '✕'),
          ),
          h('div', { style: S.monitorModalBody },
            useGrid ? h('div', { style: S.monitorFieldsGrid }, fieldEls) : fieldEls,
            monitor === 'network'
              ? h(PanelErrorBoundary, null,
                  h('div', { style: S.netRiskAlgoWrap },
                    h('button', {
                      type: 'button',
                      style: S.netRiskAlgoHead,
                      onClick: function () { setAlgoOpen(function (v) { return !v }) },
                      title: algoOpen ? t('netRiskAlgoHide') : t('netRiskAlgoToggle'),
                    },
                      h('span', { style: S.netRiskAlgoHeadTitle },
                        h('span', { style: { flex: 'none' } }, algoOpen ? '▾' : '▸'),
                        h('span', null, t('netRiskAlgoTitle')),
                      ),
                      h('span', { style: S.netRiskAlgoToggle },
                        algoOpen ? t('netRiskAlgoHide') : t('netRiskAlgoToggle')),
                    ),
                    algoOpen ? renderRiskAlgo() : null,
                  ),
                  h('div', { style: S.monitorModalDivider },
                    h('span', { style: S.monitorModalSectionTitle }, t('netAuditTitle')),
                    h(NetworkAuditPanel),
                  ),
                )
              : null,
          ),
        ),
      )
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Monitor toggle helpers ──────────────────────────────────────────
    //
    // Mirrors dock-flash's _MONITOR_TOGGLES / _getMonitorOn / _setMonitorOn
    // pattern (original lines 10429–10449), scoped to the single 'network'
    // monitor owned by this plugin.

    /** Check whether dock-flash's system-alerts master toggle is ON.
     *  The net-mon toggle is only meaningful while the alert registry is
     *  active, so its visibility follows dock-flash's master switch. */
    function _getAlertsOn() {
      try { return localStorage.getItem('dock-flash:system-alerts') !== '0' } catch (_) { return true }
    }

    var _MONITOR_TOGGLES = {
      network: {
        providers: ['dsh-flash-net-mon:network-alert', 'dsh-flash-net-mon:network-audit'],
      },
    }
    var _MONITOR_DEFAULT = { network: false }

    function _getMonitorOn(monitor) {
      // Single authority: the host-side `netAuditEnabled` setting, which the
      // settings service persists across DSH restarts (the same durable
      // mechanism that keeps the host whitelist). It is NOT `volatile()` in the
      // "resets on restart" sense — that modifier only makes the field
      // live-editable without remounting. `_setMonitorOn` writes it through the
      // settings bridge below, so the toggle always reflects what the host
      // actually stored. localStorage is abandoned as an authority: it is
      // per-origin, can be cleared, and silently forks from the host.
      if (monitor !== 'network') return _MONITOR_DEFAULT[monitor] !== false
      return _alertPref('netAuditEnabled')
    }

    function _setMonitorOn(monitor, on, alertRegistry) {
      var providers = _MONITOR_TOGGLES[monitor].providers
      for (var i = 0; i < providers.length; i++) {
        try { alertRegistry.setProviderEnabled(providers[i], on) } catch (_) {}
      }
      // Persist the toggle through the host settings bridge. This is the one
      // writer for the switch state — localStorage is no longer involved — and
      // it survives restart because `settings.update` is durable. The host's
      // reconfigureAudit() sees the change via `loader/volatile-update` and
      // starts/stops the fetch tracer accordingly.
      if (monitor === 'network') {
        _writeAlertPref(_prefCtx, 'netAuditEnabled', on, function () {
          console.warn('[dsh-flash-net-mon] failed to sync netAuditEnabled to host')
        })
      }
    }

    function _monitorSubtitle(m) {
      return function () {
        return _getMonitorOn(m) ? t('monitorOn') : t('monitorOff')
      }
    }

    //#endregion ───────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region Client factory ─────────────────────────────────────────────────

    var client = {
      // Cordis' guard proxy blocks access to namespace services not declared
      // here — ctx.remote.settings returns undefined without "remote.settings",
      // and every host-backed preference write silently fails.  The package-
      // level dsh.client.inject names @deepseek-ai/dsh-api-remotes for load
      // order; THIS inject declares the namespaces the factory actually uses.
      inject: ['remote', 'remote.settings'],
      async apply(ctx) {
        // A throw anywhere inside the real apply used to REJECT this async
        // apply — and a failed apply FAILS the plugin's Cordis fiber, so the
        // plugin never activates and its switch silently never appears. That
        // is not hypothetical: a `settings.describe().then(...)` TypeError did
        // exactly this. Registration failures are REPORTED here, never fatal.
        try {
          await client._applyInner(ctx)
        } catch (err) {
          console.error('[dsh-flash-net-mon] apply failed (non-fatal):', err)
        }
      },

      async _applyInner(ctx) {
        _prefCtx = ctx

        // 1. Load net-mon preferences from the 'dsh-flash-net-mon' settings namespace
        //    Fire-and-forget: preferences may take time (with retries),
        //    but provider/switch registration must not be blocked.
        loadNetPrefs(ctx).then(function (ok) {
          // Single authority: `netAuditEnabled` persisted on the host (via the
          // settings namespace) is the truth. There is no localStorage to
          // reconcile against, so no write-back and no split-brain — we only
          // need to sync the alert providers to whatever the host reports.
          var on = _getMonitorOn('network')
          // Notify the monitor toggle so its subtitle re-renders.
          try {
            var reg = ctx.get && ctx.get('quickControl')
            if (reg && typeof reg.notifyChange === 'function') {
              reg.notifyChange('dsh-flash-net-mon:monitor-network')
            }
          } catch (_) {}
          // Sync alert providers with the host-backed state.
          var alertReg = ctx.get && ctx.get('dockFlashAlerts')
          if (alertReg) {
            var providers = _MONITOR_TOGGLES.network.providers
            for (var i = 0; i < providers.length; i++) {
              try { alertReg.setProviderEnabled(providers[i], on) } catch (_) {}
            }
          }
        })

        // 2. Register with dock-flash's quickControl and dockFlashAlerts services.
        //    Cordis service resolution is asynchronous — ctx.get() may return
        //    undefined in the same synchronous call stack even after provide().
        //    Use the dual-discovery pattern: listen for the ready event (covers
        //    case where dock-flash loads after us) + active ctx.get() check
        //    (covers case where dock-flash loaded before us).
        var _registered = false

        function _registerServices(registry, alertRegistry) {
          if (_registered) return
          if (!registry || !alertRegistry) {
            console.warn('[dsh-flash-net-mon] _registerServices: missing service — quickControl=' + !!registry + ', alerts=' + !!alertRegistry)
            return
          }
          _registered = true
          console.log('[dsh-flash-net-mon] registering providers and switch')

          // 3. Register network alert + audit providers
          var netAlertProvider = createNetworkAlertProvider()
          var netAuditProvider = createNetworkAuditProvider()
          alertRegistry.registerProvider(netAlertProvider)
          alertRegistry.registerProvider(netAuditProvider)

          // 4. Register network monitor toggle switch
          ctx.effect(function () {
            var dispose = registry.registerSwitch({
              id: 'dsh-flash-net-mon:monitor-network',
              label: L('alertNetCluster'),
              icon: 'signal',
              type: 'toggle',
              group: 'system',
              cluster: 'system-alerts',
              order: 60,
              visible: function () {
                return _getAlertsOn()
              },
              config: function () { openMonitorConfig('network') },
              getValue: function () { return _getMonitorOn('network') },
              setValue: function (v) {
                _setMonitorOn('network', v, alertRegistry)
                registry.notifyChange('dsh-flash-net-mon:monitor-network')
                try { alertRegistry.notify() } catch (_) {}
              },
            })
            return dispose
          }, 'dsh-flash-net-mon: monitor-network switch')

          // 5. Apply persisted toggle gates — before the alert registry auto-starts
          //    so a monitor that is off on the host stays off on load. With a single
          //    host authority there is nothing to write back; we only gate the
          //    alert providers to match the persisted state.
          Object.keys(_MONITOR_TOGGLES).forEach(function (m) {
            if (!_getMonitorOn(m)) {
              var _provs = _MONITOR_TOGGLES[m].providers
              for (var j = 0; j < _provs.length; j++) {
                try { alertRegistry.setProviderEnabled(_provs[j], false) } catch (_) {}
              }
            }
          })
        }

        // Passive: listen for dock-flash:ready event (covers case where we load first)
        // The event payload is { quickControl, alerts }.
        try {
          ctx.on('dock-flash:ready', function (payload) {
            console.log('[dsh-flash-net-mon] dock-flash:ready event received — quickControl=' + !!(payload && payload.quickControl) + ', alerts=' + !!(payload && payload.alerts))
            _registerServices(payload.quickControl, payload.alerts)
          })
        } catch (e) {
          console.warn('[dsh-flash-net-mon] ctx.on("dock-flash:ready") failed:', e)
        }

        // Active: check if dock-flash already loaded (covers case where it loaded before us)
        var registry = ctx.get('quickControl')
        var alertRegistry = ctx.get('dockFlashAlerts')
        console.log('[dsh-flash-net-mon] active check — quickControl=' + !!registry + ', alerts=' + !!alertRegistry)
        if (registry && alertRegistry) _registerServices(registry, alertRegistry)

        // Fallback: if neither fired yet, poll briefly (Cordis async resolution).
        if (!_registered) {
          var _retryCount = 0
          function _retryGet() {
            if (_registered) return
            var r = ctx.get('quickControl')
            var a = ctx.get('dockFlashAlerts')
            if (r && a) { _registerServices(r, a); return }
            if (++_retryCount < 15) setTimeout(_retryGet, 200)
          }
          setTimeout(_retryGet, 0)
        }
      },

      dispose() {
        closeMonitorConfig()
      },
    }
    return client
  },
})
